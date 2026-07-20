#!/usr/bin/env python3
"""Fija el horario de la campana de Ads a 8:00-20:00 los 7 dias (horario real del cliente).
Ads = enfocado a lo que el cliente cubre; SEO va aparte (24h). Idempotente: reemplaza el schedule.

    python3 horario-8-20.py --dry-run
    python3 horario-8-20.py
"""
import json, os, sys, urllib.request, urllib.parse, urllib.error

API_VERSION = "v22"
CUSTOMER_ID = "8655524315"
CAMPAIGN_ID = "24035598684"
DIAS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
START, END = 8, 20
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
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh) horario")
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
    viejos = gaql(env, tk, "SELECT campaign_criterion.resource_name FROM campaign_criterion "
                           f"WHERE campaign.id={CAMPAIGN_ID} AND campaign_criterion.type='AD_SCHEDULE'")
    ops = [{"remove": r["campaignCriterion"]["resourceName"]} for r in viejos]
    for d in DIAS:
        ops.append({"create": {"campaign": f"customers/{CUSTOMER_ID}/campaigns/{CAMPAIGN_ID}",
                               "adSchedule": {"dayOfWeek": d, "startHour": START, "startMinute": "ZERO",
                                              "endHour": END, "endMinute": "ZERO"}}})
    print(f"Quita {len(viejos)} schedule viejo(s) · agrega 7 dias {START:02d}:00-{END:02d}:00")
    if DRY:
        print("[dry-run] NO aplicado."); return
    http(f"https://googleads.googleapis.com/{API_VERSION}/customers/{CUSTOMER_ID}/campaignCriteria:mutate",
         {"operations": ops}, hdr(env, tk))
    print("✅ Horario 8:00-20:00 los 7 dias aplicado.")


if __name__ == "__main__":
    main()
