#!/usr/bin/env python3
"""Agrega NEGATIVAS a la campana de Ads (asvrgruas) — fugas geograficas fuera de zona.

Detectadas 17-19 jul 2026: el anuncio aparecia en busquedas de otras regiones/rutas
(Los Angeles region VIII, La Ligua region V, Curacavi rural, rutas interurbanas), que
nunca son cliente del radio de 11km de Pudahuel. Solo se agregan las INEQUIVOCAS.
NO toca plata. Idempotente: no re-agrega las que ya existen.

Uso:
    python3 agregar-negativas.py --dry-run
    python3 agregar-negativas.py
"""
import json, os, sys, urllib.request, urllib.parse, urllib.error

API_VERSION = "v22"
CUSTOMER_ID = "8655524315"
CAMPAIGN_ID = "24035598684"
HERE = os.path.dirname(os.path.abspath(__file__))
DRY = "--dry-run" in sys.argv

# Solo fugas INEQUIVOCAS fuera del area de servicio (frase). Las comunas de RM
# limitrofes (puente alto, la pintana, etc.) NO se tocan: son decision de Alejandro.
NEGATIVAS = [
    "los angeles",       # Region VIII, 500km
    "la ligua",          # Region V
    "curacavi",          # RM rural, ~40km
    "ruta 5",            # interurbana
    "autopista del sol",  # interurbana
    # 2a tanda (2026-07-20) — fuera de zona INEQUIVOCO (ronda ultracode):
    "calera de tango",   # RM SO ~20km
    "lampa",             # RM norte rural ~20km
    "carretera 5",       # interurbana
    "gruas de carretera",  # servicio interurbano (no es lo nuestro)
    # 3a tanda — VEHICULOS que la grua liviana NO puede: camiones/grandes/izaje.
    # OJO: "camion" en frase NO bloquea "camioneta" (token distinto) — camionetas SI se atienden.
    "camion",            # camiones (muy pesados)
    "camión",
    "bus",
    "buses",
    "maquinaria pesada",
    "retroexcavadora",
    "excavadora",
    "container",
    "contenedor",
    "izaje",             # grua de izaje/pluma industrial (no es lo nuestro)
    "grua torre",        # grua de construccion
    "grua horquilla",    # montacargas
    "tractocamion",
]
MATCH = "PHRASE"


def load_env(path):
    env = {}
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def http(url, data=None, headers=None):
    body = json.dumps(data).encode() if isinstance(data, dict) else data
    req = urllib.request.Request(url, data=body, method="POST" if body else "GET")
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh) agregar-negativas")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if isinstance(data, dict):
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode()[:400]}") from e


def token(env):
    data = urllib.parse.urlencode({
        "client_id": env["GOOGLE_ADS_CLIENT_ID"], "client_secret": env["GOOGLE_ADS_CLIENT_SECRET"],
        "refresh_token": env["GOOGLE_ADS_REFRESH_TOKEN"], "grant_type": "refresh_token"}).encode()
    return http("https://oauth2.googleapis.com/token", data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"})["access_token"]


def headers(env, tk):
    return {"Authorization": "Bearer " + tk, "developer-token": env["GOOGLE_ADS_DEVELOPER_TOKEN"],
            "login-customer-id": env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "").replace("-", "")}


def gaql(env, tk, q):
    url = f"https://googleads.googleapis.com/{API_VERSION}/customers/{CUSTOMER_ID}/googleAds:searchStream"
    rows = []
    for b in (http(url, {"query": q}, headers(env, tk)) or []):
        rows += b.get("results", [])
    return rows


def main():
    env = load_env(os.path.join(HERE, ".env.local"))
    tk = token(env)
    # negativas existentes
    ex = gaql(env, tk, "SELECT campaign_criterion.keyword.text FROM campaign_criterion "
                       f"WHERE campaign.id={CAMPAIGN_ID} AND campaign_criterion.negative=true "
                       "AND campaign_criterion.type='KEYWORD'")
    existentes = {r["campaignCriterion"]["keyword"]["text"].lower() for r in ex}
    nuevas = [n for n in NEGATIVAS if n.lower() not in existentes]
    print(f"Negativas existentes: {len(existentes)}")
    print(f"A agregar ({len(nuevas)}): {nuevas or 'ninguna (ya estaban)'}")
    if not nuevas:
        return
    ops = [{"create": {"campaign": f"customers/{CUSTOMER_ID}/campaigns/{CAMPAIGN_ID}",
                       "negative": True,
                       "keyword": {"text": n, "matchType": MATCH}}} for n in nuevas]
    if DRY:
        print(f"[dry-run] {len(ops)} op(s), NO se aplico.")
        return
    url = f"https://googleads.googleapis.com/{API_VERSION}/customers/{CUSTOMER_ID}/campaignCriteria:mutate"
    res = http(url, {"operations": ops}, headers(env, tk))
    print(f"✅ Agregadas {len(res.get('results', []))} negativas (frase).")


if __name__ == "__main__":
    main()
