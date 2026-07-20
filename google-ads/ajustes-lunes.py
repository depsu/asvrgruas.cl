#!/usr/bin/env python3
"""Ajustes 2026-07-20 (autorizados por Alejandro) para dejar la campana lista el lunes:
  1) Techo de CPC $1.500 -> $2.000 (mismo presupuesto): ganar mas subastas, sobre todo el finde.
  2) Quitar la negativa 'lo barnechea' (es comuna urbana de Santiago; ASVR atiende todo Santiago urbano).

NO cambia el presupuesto. Solo esta campana. Tope de seguridad del techo: [500, 5000] CLP.

    python3 ajustes-lunes.py --dry-run
    python3 ajustes-lunes.py
"""
import json, os, sys, urllib.request, urllib.parse, urllib.error

API_VERSION = "v22"
CUSTOMER_ID = "8655524315"
CAMPAIGN_ID = "24035598684"
NUEVO_TECHO_CLP = 2000
TECHO_MIN, TECHO_MAX = 500, 5000
QUITAR_NEGATIVAS = ["lo barnechea"]
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
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh) ajustes-lunes")
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


def mutate(env, tk, kind, ops):
    return http(f"https://googleads.googleapis.com/{API_VERSION}/customers/{CUSTOMER_ID}/{kind}:mutate",
                {"operations": ops}, hdr(env, tk))


def main():
    env = load_env(os.path.join(HERE, ".env.local"))
    tk = token(env)

    # --- 1) Techo de CPC ---
    if not (TECHO_MIN <= NUEVO_TECHO_CLP <= TECHO_MAX):
        print("Techo fuera de rango seguro."); return
    actual = gaql(env, tk, f"SELECT campaign.target_spend.cpc_bid_ceiling_micros FROM campaign WHERE campaign.id={CAMPAIGN_ID}")
    hoy = int(actual[0]["campaign"].get("targetSpend", {}).get("cpcBidCeilingMicros", 0)) // 1_000_000 if actual else 0
    print(f"Techo CPC actual: ${hoy:,}".replace(",", ".") + f"  →  nuevo: ${NUEVO_TECHO_CLP:,}".replace(",", "."))
    op_techo = [{"update": {"resourceName": f"customers/{CUSTOMER_ID}/campaigns/{CAMPAIGN_ID}",
                            "targetSpend": {"cpcBidCeilingMicros": str(NUEVO_TECHO_CLP * 1_000_000)}},
                 "updateMask": "target_spend.cpc_bid_ceiling_micros"}]

    # --- 2) Quitar negativas ---
    rows = gaql(env, tk, "SELECT campaign_criterion.resource_name, campaign_criterion.keyword.text FROM campaign_criterion "
                         f"WHERE campaign.id={CAMPAIGN_ID} AND campaign_criterion.negative=true AND campaign_criterion.type='KEYWORD'")
    quitar = [r["campaignCriterion"]["resourceName"] for r in rows
              if r["campaignCriterion"].get("keyword", {}).get("text", "").lower() in [q.lower() for q in QUITAR_NEGATIVAS]]
    print(f"Negativas a quitar: {QUITAR_NEGATIVAS} → {len(quitar)} encontrada(s)")

    if DRY:
        print("[dry-run] NO se aplico nada."); return

    mutate(env, tk, "campaigns", op_techo)
    print("✅ Techo de CPC actualizado.")
    if quitar:
        mutate(env, tk, "campaignCriteria", [{"remove": rn} for rn in quitar])
        print(f"✅ Quitada(s) {len(quitar)} negativa(s).")


if __name__ == "__main__":
    main()
