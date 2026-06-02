#!/usr/bin/env python3
"""Crawl public Shopify products.json for the cohesive clean-beauty brand set.
Saves full raw product objects per brand to crawl/raw/<brand>.json.
Polite: paginated, throttled, single UA. Public endpoint only, read-only."""
import json, time, os, ssl, urllib.request, urllib.error

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")

BRANDS = {
    "kosas": "kosas.com",
    "ilia": "iliabeauty.com",
    "saie": "saiehello.com",
    "tower28": "tower28beauty.com",
    "westman": "westman-atelier.com",
}

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (research catalog crawl)"})
    with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
        return json.loads(r.read())

def crawl_brand(slug, domain):
    out, page = [], 1
    while True:
        url = f"https://{domain}/products.json?limit=250&page={page}"
        try:
            data = fetch(url)
        except urllib.error.HTTPError as e:
            print(f"  {slug} page {page}: HTTP {e.code} (stop)"); break
        prods = data.get("products", [])
        if not prods:
            break
        out.extend(prods)
        print(f"  {slug} page {page}: +{len(prods)} (total {len(out)})")
        page += 1
        time.sleep(1.0)
    with open(os.path.join(RAW, f"{slug}.json"), "w") as f:
        json.dump(out, f)
    return len(out)

if __name__ == "__main__":
    summary = {}
    for slug, domain in BRANDS.items():
        print(f"{slug} ({domain})")
        summary[slug] = crawl_brand(slug, domain)
    print("\n=== RAW COUNTS ===")
    for k, v in summary.items():
        print(f"  {k}: {v}")
    print(f"  TOTAL: {sum(summary.values())}")
