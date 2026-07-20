#!/usr/bin/env python3
"""Reconfigura GEO y HORARIO de la campana (autorizado por Alejandro 2026-07-20):
  - GEO: quita el radio de 11km (proximidad) y apunta al GRAN SANTIAGO URBANO:
      Santiago ciudad (1003325) + Puente Alto (9198364) + San Bernardo (9197675).
      Se mantiene PRESENCE (gente fisicamente ahi). Cubre ~34 comunas urbanas, sin rural lejano.
  - HORARIO: quita el ad_schedule 8-20 -> 24/7 (sin restriccion horaria).

Motivo: la campana es para el cliente y debe capturar TODO el trafico servible de la RM
urbana, pensada para escalar. NO cambia presupuesto ni puja.

    python3 geo-gran-santiago.py --dry-run
    python3 geo-gran-santiago.py
"""
import json, os, sys, urllib.request, urllib.parse, urllib.error

API_VERSION = "v22"
CUSTOMER_ID = "8655524315"
CAMPAIGN_ID = "24035598684"
LOCATIONS = ["1003325", "9198364", "9197675"]  # Santiago, Puente Alto, San Bernardo
HERE = os.path.dirname(os.path.abspath(__file__))
DRY = "--dry-run" in sys.argv


def load_env(p):
    e = {}
    for ln in open(p, encoding="utf-8"):
        ln = ln.strip()
        if ln and not ln.startswith("#") and "=" in ln:
            k, _, v = ln.partition("=")
            e[k.strip()] = v.strip().strip('"').strip("'")
    return e


def http(url, data=None, headers=None):
    body = json.dumps(data).encode() if isinstance(data, dict) else data
    req = urllib.request.Request(url, data=body, method="POST" if body else "GET")
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh) geo-gran-santiago")
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
    d = urllib.parse.urlencode({"client_id": env["GOOGLE_ADS_CLIENT_ID"], "client_secret": env["GOOGLE_ADS_CLIENT_SECRET"],
                                "refresh_token": env["GOOGLE_ADS_REFRESH_TOKEN"], "grant_type": "refresh_token"}).encode()
    return http("https://oauth2.googleapis.com/token", data=d, headers={"Content-Type": "application/x-www-form-urlencoded"})["access_token"]


def hdr(env, tk):
    return {"Authorization": "Bearer " + tk, "developer-token": env["GOOGLE_ADS_DEVELOPER_TOKEN"],
            "login-customer-id": env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "").replace("-", "")}


def gaql(env, tk, q):
    url = f"https://googleads.googleapis.com/{API_VERSION}/customers/{CUSTOMER_ID}/googleAds:searchStream"
    r = []
    for b in (http(url, {"query": q}, hdr(env, tk)) or []):
        r += b.get("results", [])
    return r


def main():
    env = load_env(os.path.join(HERE, ".env.local"))
    tk = token(env)

    # criterios actuales a quitar: proximidad + ad_schedule + cualquier location vieja
    rows = gaql(env, tk, "SELECT campaign_criterion.resource_name, campaign_criterion.type "
                         f"FROM campaign_criterion WHERE campaign.id={CAMPAIGN_ID} "
                         "AND campaign_criterion.type IN ('PROXIMITY','AD_SCHEDULE','LOCATION')")
    quitar = [(r["campaignCriterion"]["resourceName"], r["campaignCriterion"]["type"]) for r in rows]
    print("A QUITAR:")
    for rn, t in quitar:
        print(f"  - {t}")
    print(f"A AGREGAR (LOCATION, PRESENCE): {LOCATIONS}  (Santiago ciudad + Puente Alto + San Bernardo)")
    print("HORARIO: sin ad_schedule = 24/7")

    ops = [{"remove": rn} for rn, _ in quitar]
    ops += [{"create": {"campaign": f"customers/{CUSTOMER_ID}/campaigns/{CAMPAIGN_ID}",
                        "location": {"geoTargetConstant": f"geoTargetConstants/{gid}"}}} for gid in LOCATIONS]

    if DRY:
        print(f"\n[dry-run] {len(ops)} operaciones. NO aplicado."); return

    url = f"https://googleads.googleapis.com/{API_VERSION}/customers/{CUSTOMER_ID}/campaignCriteria:mutate"
    res = http(url, {"operations": ops}, hdr(env, tk))
    print(f"\n✅ Aplicado: {len(res.get('results', []))} operaciones (quitadas {len(quitar)}, agregadas {len(LOCATIONS)} ubicaciones, horario 24/7).")


if __name__ == "__main__":
    main()
