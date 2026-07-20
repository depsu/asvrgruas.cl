#!/usr/bin/env python3
"""Arregla las METAS DE CONVERSIÓN de la campaña de Ads (asvrgruas).

Problema detectado (2026-07-19): la campaña estaba contando como "conversión"
la meta *Vista de una página* (rota) en vez de los leads reales. Por eso el panel
mostraba 0 conversiones aunque WhatsApp/Llamada sí disparaban (salían solo en
"todas las conversiones").

Este script deja como metas que SÍ cuentan en la columna "Conversiones":
  - CONTACT (WhatsApp clic)            → biddable = true
  - PHONE_CALL_LEAD (Llamada web)      → biddable = true
  - PHONE_CALL_LEAD (Calls from ads)   → biddable = true
  - SUBMIT_LEAD_FORM (Formulario)      → biddable = true
Y saca de la cuenta de conversiones la basura:
  - PAGE_VIEW (Vista de página)        → biddable = false

NO toca plata ni borra nada. No afecta la puja (Maximizar clics no usa
conversiones); solo hace que los leads se VEAN en el panel.

Uso:
    python3 arreglar-metas.py --dry-run   # muestra el plan, no toca nada
    python3 arreglar-metas.py             # aplica
"""
import json
import os
import sys
import urllib.request
import urllib.parse
import urllib.error

API_VERSION = "v22"
CUSTOMER_ID = "8655524315"
CAMPAIGN_ID = "24035598684"
HERE = os.path.dirname(os.path.abspath(__file__))
DRY = "--dry-run" in sys.argv

# category~origin → biddable deseado
OBJETIVO = {
    "CONTACT~WEBSITE": True,
    "PHONE_CALL_LEAD~WEBSITE": True,
    "PHONE_CALL_LEAD~CALL_FROM_ADS": True,
    "SUBMIT_LEAD_FORM~WEBSITE": True,
    "PAGE_VIEW~WEBSITE": False,
}


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
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh) arreglar-metas")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if isinstance(data, dict):
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} {url.split('?')[0]}: {e.read().decode()[:400]}") from e


def get_access_token(env):
    data = urllib.parse.urlencode({
        "client_id": env["GOOGLE_ADS_CLIENT_ID"], "client_secret": env["GOOGLE_ADS_CLIENT_SECRET"],
        "refresh_token": env["GOOGLE_ADS_REFRESH_TOKEN"], "grant_type": "refresh_token"}).encode()
    return http("https://oauth2.googleapis.com/token", data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"})["access_token"]


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
    return http(url, {"operations": operations}, ads_headers(env, token))


def estado_actual(env, token):
    rows = gaql(env, token,
                "SELECT campaign_conversion_goal.category, campaign_conversion_goal.origin, "
                "campaign_conversion_goal.biddable FROM campaign_conversion_goal "
                f"WHERE campaign.id = {CAMPAIGN_ID}")
    out = {}
    for r in rows:
        g = r["campaignConversionGoal"]
        out[f"{g['category']}~{g['origin']}"] = bool(g.get("biddable", False))
    return out


def main():
    env = load_env(os.path.join(HERE, ".env.local"))
    token = get_access_token(env)

    antes = estado_actual(env, token)
    print("Estado ACTUAL de las metas de la campaña:")
    for k, v in sorted(antes.items()):
        print(f"  {'✅ cuenta' if v else '⬜ no cuenta'}  {k}")

    ops = []
    plan = []
    for clave, biddable in OBJETIVO.items():
        actual = antes.get(clave)
        if actual is None:
            plan.append(f"  ⚠️  {clave}: no existe en la campaña (se omite)")
            continue
        if actual == biddable:
            plan.append(f"  ➖ {clave}: ya está {'✅' if biddable else '⬜'} (sin cambio)")
            continue
        plan.append(f"  {'✅' if biddable else '⬜'} {clave}: {actual} → {biddable}")
        ops.append({
            "update": {
                "resourceName": f"customers/{CUSTOMER_ID}/campaignConversionGoals/{CAMPAIGN_ID}~{clave}",
                "biddable": biddable,
            },
            "updateMask": "biddable",
        })

    print("\nPlan:")
    print("\n".join(plan))

    if not ops:
        print("\nNada que cambiar. ✅")
        return

    if DRY:
        print(f"\n[dry-run] {len(ops)} cambio(s) — NO se aplicó nada.")
        return

    mutate(env, token, "campaignConversionGoals", ops)
    print(f"\n✅ Aplicado ({len(ops)} cambio(s)). Verificando…")
    despues = estado_actual(env, token)
    for k in sorted(OBJETIVO):
        if k in despues:
            print(f"  {'✅ cuenta' if despues[k] else '⬜ no cuenta'}  {k}")


if __name__ == "__main__":
    main()
