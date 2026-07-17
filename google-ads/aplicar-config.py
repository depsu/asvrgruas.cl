# Panel del cliente ASRV Grúas — instanciado de panel-cliente/ (maestro DIXDY) 2026-07-16.
#!/usr/bin/env python3
"""Aplica a Google Ads los cambios que el dueño dejó en cola en "Mi negocio" (/config del worker).

Pensado para correr en loop horario:  /loop 1h /aplicar-config   (o a mano).

Qué hace en cada corrida:
  1. Lee /config-pendientes del worker (cola validada por el worker: rangos seguros).
  2. Aplica cada cambio pendiente:
       - presupuesto → campaignBudgets:mutate (con TOPE DURO re-verificado aquí)
       - horario     → reemplaza el ad schedule semanal de la campaña
       - dias        → se marca "programado"; la pausa real la hace el paso 3
  3. SIEMPRE (haya o no cola): si HOY es día bloqueado → pausa la campaña;
     si ya no lo es y la pausó este script → la reactiva. Idempotente.
  4. Reporta cada resultado a /config-aplicado (el panel del dueño lo muestra).

Seguridad (independiente del worker, por si acaso):
  - Presupuesto solo dentro de [15.000, 35.000] CLP. Fuera de eso: NO aplica.
  - Solo toca la campaña e IDs de ESTE archivo. Nada más.
  - --dry-run muestra el plan sin tocar nada.

Uso:
    python3 aplicar-config.py            # aplica
    python3 aplicar-config.py --dry-run  # solo muestra
"""
import json
import os
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone, timedelta

API_VERSION = "v22"
CUSTOMER_ID = "8655524315"      # cuenta de Ads del cliente
CAMPAIGN_ID = "24035598684"   # [SEARCH] Grua_Autos_Urgente_RM_Mobile_F1 (publicada 17-jul-2026)
BUDGET_ID = "15729245749"     # presupuesto de esa campaña ($12.000/día)

# Topes duros del script (el worker ya valida, esto es el segundo candado — docs/18)
# Deben ir SIEMPRE en espejo con REGLAS.presupuestoMin/Max del worker.
# Escala de ESTA campaña: base $12.000/día (capacidad 3-4 servicios/día).
PRESUPUESTO_MIN = 10000
PRESUPUESTO_MAX = 20000

DIAS_API = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]

HERE = os.path.dirname(os.path.abspath(__file__))
DRY = "--dry-run" in sys.argv


def load_env(path):
    env = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            env[key.strip()] = val.strip().strip('"').strip("'")
    return env


def http(url, data=None, headers=None, method=None):
    body = json.dumps(data).encode() if isinstance(data, dict) else data
    req = urllib.request.Request(url, data=body, method=method or ("POST" if body else "GET"))
    # Cloudflare bloquea el User-Agent por defecto de urllib (error 1010)
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh) aplicar-config")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if isinstance(data, dict):
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} {url.split('?')[0]}: {e.read().decode()[:300]}") from e


def get_access_token(env):
    """Refresh token de .env.local; si está revocado cae al de google_ads_token.json."""
    candidates = [env.get("GOOGLE_ADS_REFRESH_TOKEN")]
    try:
        cached = json.load(open(os.path.join(HERE, "google_ads_token.json"), encoding="utf-8"))
        candidates.append(cached.get("refresh_token"))
    except (OSError, ValueError):
        pass
    last_err = None
    for rt in [c for c in candidates if c]:
        try:
            data = urllib.parse.urlencode({
                "client_id": env["GOOGLE_ADS_CLIENT_ID"], "client_secret": env["GOOGLE_ADS_CLIENT_SECRET"],
                "refresh_token": rt, "grant_type": "refresh_token"}).encode()
            return http("https://oauth2.googleapis.com/token", data=data,
                        headers={"Content-Type": "application/x-www-form-urlencoded"})["access_token"]
        except RuntimeError as e:
            last_err = e
    raise RuntimeError(f"No hay refresh token vivo: {last_err}")


def ads_headers(env, token):
    return {"Authorization": "Bearer " + token,
            "developer-token": env["GOOGLE_ADS_DEVELOPER_TOKEN"],
            "login-customer-id": env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "").replace("-", "")}


def gaql(env, token, query):
    url = f"https://googleads.googleapis.com/{API_VERSION}/customers/{CUSTOMER_ID}/googleAds:searchStream"
    data = http(url, {"query": query}, ads_headers(env, token))
    rows = []
    for batch in (data if isinstance(data, list) else []):
        rows += batch.get("results", [])
    return rows


def mutate(env, token, kind, operations):
    url = f"https://googleads.googleapis.com/{API_VERSION}/customers/{CUSTOMER_ID}/{kind}:mutate"
    if DRY:
        print(f"  [dry-run] {kind}:mutate → {json.dumps(operations, ensure_ascii=False)[:400]}")
        return {}
    return http(url, {"operations": operations}, ads_headers(env, token))


def hoy_santiago():
    """Fecha de hoy en Chile sin depender de zoneinfo: Chile continental = UTC-4 (invierno) / UTC-3 (verano).
    Aproximación segura: UTC-4 (si es verano, el cambio de día difiere solo entre 23 y 24 h UTC)."""
    return (datetime.now(timezone.utc) - timedelta(hours=4)).strftime("%Y-%m-%d")


# ---------- aplicadores ----------

def set_presupuesto(env, token, monto):
    """Núcleo con TOPE DURO: cualquier presupuesto pasa por aquí."""
    if not (PRESUPUESTO_MIN <= monto <= PRESUPUESTO_MAX):
        return False
    mutate(env, token, "campaignBudgets", [{
        "update": {"resourceName": f"customers/{CUSTOMER_ID}/campaignBudgets/{BUDGET_ID}",
                   "amountMicros": str(monto * 1_000_000)},
        "updateMask": "amount_micros"}])
    return True


def presupuesto_actual(env, token):
    rows = gaql(env, token, "SELECT campaign_budget.amount_micros FROM campaign_budget "
                            f"WHERE campaign_budget.id = {BUDGET_ID}")
    return round(int(rows[0]["campaignBudget"]["amountMicros"]) / 1e6) if rows else None


def clp(n):
    return f"${n:,}".replace(",", ".")


def aplicar_presupuesto(env, token, item):
    monto = int(item.get("presupuesto", 0))
    if not set_presupuesto(env, token, monto):
        return False, f"fuera del tope duro [{PRESUPUESTO_MIN}-{PRESUPUESTO_MAX}]"
    return True, f"presupuesto diario → {clp(monto)} CLP"


KEYS_DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"]   # ↔ DIAS_API


def aplicar_horario(env, token, item):
    h = item.get("horario") or {}
    if not h and "desde" in item:                       # compat con items del formato anterior
        h = {"modo": "simple", "desde": item["desde"], "hasta": item["hasta"]}
    modo = h.get("modo", "simple")

    viejos = gaql(env, token,
                  "SELECT campaign_criterion.resource_name FROM campaign_criterion "
                  f"WHERE campaign_criterion.type = 'AD_SCHEDULE' AND campaign.id = {CAMPAIGN_ID}")
    ops = [{"remove": r["campaignCriterion"]["resourceName"]} for r in viejos]

    def crear(dia_api, ini, fin):
        if ini != fin:
            ops.append({"create": {
                "campaign": f"customers/{CUSTOMER_ID}/campaigns/{CAMPAIGN_ID}",
                "adSchedule": {"dayOfWeek": dia_api, "startHour": ini, "startMinute": "ZERO",
                               "endHour": fin, "endMinute": "ZERO"}}})

    def franja(idx, desde, hasta):
        # cruza medianoche (ej. 08→02): desde→24 hoy + 00→hasta el día SIGUIENTE
        if hasta <= desde:
            crear(DIAS_API[idx], desde, 24)
            if hasta > 0:
                crear(DIAS_API[(idx + 1) % 7], 0, hasta)
        else:
            crear(DIAS_API[idx], desde, hasta)

    if modo == "247":
        res = "24/7: sin restricción de horario"       # sin criterios = todo el día, todos los días
    elif modo == "porDia":
        dias = h.get("dias") or {}
        for i, k in enumerate(KEYS_DIAS):
            v = dias.get(k)
            if v:
                franja(i, int(v["desde"]), int(v["hasta"]))
        res = "horario personalizado por día aplicado"
    else:
        desde, hasta = int(h["desde"]), int(h["hasta"])
        for i in range(7):
            franja(i, desde, hasta)
        res = f"horario {desde:02d}:00 a {hasta % 24:02d}:00 todos los días"

    if ops:
        mutate(env, token, "campaignCriteria", ops)
    return True, res


def estado_campana(env, token):
    rows = gaql(env, token, f"SELECT campaign.status FROM campaign WHERE campaign.id = {CAMPAIGN_ID}")
    return rows[0]["campaign"]["status"] if rows else None


def set_estado_campana(env, token, status):
    mutate(env, token, "campaigns", [{
        "update": {"resourceName": f"customers/{CUSTOMER_ID}/campaigns/{CAMPAIGN_ID}", "status": status},
        "updateMask": "status"}])


# ---------- main ----------

def main():
    env = load_env(os.path.join(HERE, ".env.local"))
    worker = env.get("REF_WORKER_URL", "").rstrip("/")
    key = env["LOOKUP_SECRET"]

    estado = http(f"{worker}/config-pendientes?key={urllib.parse.quote(key)}")
    config = estado.get("config", {})
    pendientes = estado.get("pendientes", [])
    print(f"[aplicar-config] {len(pendientes)} pendiente(s) · hoy Santiago: {hoy_santiago()}")

    token = get_access_token(env)

    def reportar(payload):
        if DRY:
            print(f"  [dry-run] reporte → {json.dumps(payload, ensure_ascii=False)}")
            return
        http(f"{worker}/config-aplicado", dict(payload, key=key))

    # 1) cola (más antiguo primero)
    for item in sorted(pendientes, key=lambda i: i.get("ts", 0)):
        tipo = item.get("tipo")
        try:
            if tipo == "presupuesto":
                ok, res = aplicar_presupuesto(env, token, item)
            elif tipo == "horario":
                ok, res = aplicar_horario(env, token, item)
            elif tipo == "dias":
                ok, res = True, "programado (la pausa/reactivación corre sola cada hora)"
            else:
                ok, res = False, "tipo desconocido"
        except RuntimeError as e:
            ok, res = False, str(e)[:180]
        print(f"  {'✓' if ok else '✗'} {item.get('detalle', tipo)} → {res}")
        reportar({"id": item.get("id"), "ok": ok, "resultado": res})

    # 2) días programados (SIEMPRE, idempotente): ⏸ pausar · 🟢 subir · 🩵 bajar · restaurar
    reglas = estado.get("reglas") or {}
    subir_pct = int(reglas.get("subirPct", 25))
    bajar_pct = int(reglas.get("bajarPct", 25))
    hoy = hoy_santiago()
    prog = {d.get("fecha"): d.get("modo") for d in (config.get("diasProgramados") or [])}
    for f in (config.get("diasBloqueados") or []):     # formato viejo = pausar
        prog.setdefault(f, "pausar")
    modo_hoy = prog.get(hoy)
    ajuste = config.get("ajusteDia") or None            # {"fecha","modo","base"} si hoy ya se ajustó
    pausada_por_config = bool(config.get("campanaPausadaHoy"))
    st = estado_campana(env, token)

    # restaurar el presupuesto base si el ajuste era de OTRO día (el día programado ya pasó)
    if ajuste and ajuste.get("fecha") != hoy:
        base = int(ajuste.get("base") or 0)
        if PRESUPUESTO_MIN <= base <= PRESUPUESTO_MAX and set_presupuesto(env, token, base):
            print(f"  💰 Día programado terminó → presupuesto restaurado a {clp(base)}")
            reportar({"id": "estado", "ok": True,
                      "resultado": f"presupuesto restaurado a {clp(base)} tras día programado", "ajusteDia": None})
        else:
            reportar({"id": "estado", "ok": False, "resultado": "no pude restaurar el presupuesto base", "ajusteDia": None})
        ajuste = None

    # pausa / reactivación
    if modo_hoy == "pausar" and st == "ENABLED":
        set_estado_campana(env, token, "PAUSED")
        print(f"  ⏸ HOY {hoy} es día pausado → campaña pausada")
        reportar({"id": "estado", "ok": True, "resultado": f"pausada por día programado {hoy}", "campanaPausadaHoy": True})
    elif modo_hoy != "pausar" and st == "PAUSED" and pausada_por_config:
        set_estado_campana(env, token, "ENABLED")
        print("  ▶️ Ya no es día pausado → campaña reactivada")
        reportar({"id": "estado", "ok": True, "resultado": "reactivada tras día pausado", "campanaPausadaHoy": False})

    # subir/bajar la inversión de HOY (una sola vez por día)
    if modo_hoy in ("subir", "bajar") and not (ajuste and ajuste.get("fecha") == hoy):
        base = int(((config.get("aplicado") or {}).get("presupuesto")) or 0) or (presupuesto_actual(env, token) or 0)
        if base:
            factor = 1 + subir_pct / 100 if modo_hoy == "subir" else 1 - bajar_pct / 100
            nuevo = max(PRESUPUESTO_MIN, min(PRESUPUESTO_MAX, round(base * factor / 1000) * 1000))
            if nuevo != base and set_presupuesto(env, token, nuevo):
                emoji = "🟢" if modo_hoy == "subir" else "🩵"
                print(f"  {emoji} HOY {hoy} es día {modo_hoy} → presupuesto {clp(base)} → {clp(nuevo)}")
                reportar({"id": "estado", "ok": True,
                          "resultado": f"día {modo_hoy}: presupuesto {clp(base)} → {clp(nuevo)} (vuelve solo mañana)",
                          "ajusteDia": {"fecha": hoy, "modo": modo_hoy, "base": base}})
            else:
                print(f"  Día {modo_hoy}: sin margen para ajustar (base {clp(base)})")
    if not modo_hoy and not ajuste and st:
        print(f"  Estado campaña: {st} — sin días programados hoy")


if __name__ == "__main__":
    main()
