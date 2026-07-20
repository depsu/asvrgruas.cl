#!/usr/bin/env python3
"""Archiva (status REMOVED) una accion de conversion basura de Google Ads.

Uso 2026-07-20: archivar "Vista de una pagina" (PAGE_VIEW, ID 7687264490), que da
"Configuracion erronea" y no aporta (destapando.cl no la tiene). NO afecta la puja
(ya estaba biddable=false). Solo limpia el panel.

    python3 archivar-conversion.py --id 7687264490 --dry-run
    python3 archivar-conversion.py --id 7687264490
"""
import json, os, sys, urllib.request, urllib.parse, urllib.error

API_VERSION = "v22"
CUSTOMER_ID = "8655524315"
HERE = os.path.dirname(os.path.abspath(__file__))
DRY = "--dry-run" in sys.argv
CID = None
if "--id" in sys.argv:
    CID = sys.argv[sys.argv.index("--id") + 1]


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
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh) archivar-conversion")
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


def main():
    if not CID:
        print("Falta --id <conversion_action_id>"); return
    env = load_env(os.path.join(HERE, ".env.local"))
    tk = token(env)
    rn = f"customers/{CUSTOMER_ID}/conversionActions/{CID}"
    # estado actual
    rows = []
    url = f"https://googleads.googleapis.com/{API_VERSION}/customers/{CUSTOMER_ID}/googleAds:searchStream"
    for b in (http(url, {"query": f"SELECT conversion_action.name, conversion_action.status FROM conversion_action WHERE conversion_action.id = {CID}"}, headers(env, tk)) or []):
        rows += b.get("results", [])
    if not rows:
        print(f"No existe la conversion {CID}"); return
    ca = rows[0]["conversionAction"]
    print(f"Actual: {ca['name']} → {ca['status']}")
    if ca["status"] == "REMOVED":
        print("Ya estaba archivada. ✅"); return
    op = [{"remove": rn}]
    if DRY:
        print(f"[dry-run] remove {ca['name']}. NO aplicado."); return
    http(f"https://googleads.googleapis.com/{API_VERSION}/customers/{CUSTOMER_ID}/conversionActions:mutate",
         {"operations": op}, headers(env, tk))
    print(f"✅ Archivada: {ca['name']} → REMOVED")


if __name__ == "__main__":
    main()
