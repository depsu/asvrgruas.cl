#!/usr/bin/env python3
"""Engancha a la campana los sitelinks + callouts que YA existen en la cuenta pero
estaban sueltos (no se mostraban). Hace el anuncio mas grande y llamable = mas clics/llamadas.
El boton CALL ya esta enganchado a nivel cuenta (no se toca). Idempotente.

    python3 enganchar-extensiones.py --dry-run
    python3 enganchar-extensiones.py
"""
import json, os, sys, urllib.request, urllib.parse, urllib.error

API_VERSION = "v22"
CUSTOMER_ID = "8655524315"
CAMPAIGN_ID = "24035598684"
SITELINKS = ["394375591445", "394375591448", "394375591451", "394375591454", "394375591457", "394375591460"]
CALLOUTS = ["394555820520", "394555820523", "394555820526", "394555820529", "394555820532",
            "394555820535", "394555820538", "394555820541", "394555820544"]
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
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh) enganchar-ext")
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
    # ya enganchados a la campana (evitar duplicar)
    ya = gaql(env, tk, "SELECT campaign.id, asset.id, campaign_asset.field_type FROM campaign_asset "
                       f"WHERE campaign.id={CAMPAIGN_ID}")
    ya_ids = {r["asset"]["id"] for r in ya}
    ops = []
    for aid in SITELINKS:
        if aid not in ya_ids:
            ops.append({"create": {"campaign": f"customers/{CUSTOMER_ID}/campaigns/{CAMPAIGN_ID}",
                                   "asset": f"customers/{CUSTOMER_ID}/assets/{aid}", "fieldType": "SITELINK"}})
    for aid in CALLOUTS:
        if aid not in ya_ids:
            ops.append({"create": {"campaign": f"customers/{CUSTOMER_ID}/campaigns/{CAMPAIGN_ID}",
                                   "asset": f"customers/{CUSTOMER_ID}/assets/{aid}", "fieldType": "CALLOUT"}})
    print(f"Ya enganchados: {len(ya_ids)} · a enganchar: {len(ops)} (sitelinks+callouts)")
    if not ops:
        print("Nada que hacer. ✅"); return
    if DRY:
        print("[dry-run] NO aplicado."); return
    res = http(f"https://googleads.googleapis.com/{API_VERSION}/customers/{CUSTOMER_ID}/campaignAssets:mutate",
               {"operations": ops}, hdr(env, tk))
    print(f"✅ Enganchados {len(res.get('results', []))} recursos a la campaña.")


if __name__ == "__main__":
    main()
