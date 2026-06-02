#!/usr/bin/env python3
"""Thin Shopify Admin API client (REST + GraphQL) for the MAREN store build.
Credentials come from env vars or pipeline/shopify/secrets.env (gitignored):
  SHOPIFY_STORE=spectrum-test-2-2          (the *.myshopify.com handle)
  SHOPIFY_TOKEN=shpat_xxx                   (Admin API access token)
  SHOPIFY_API_VERSION=2025-07               (optional; default below)
"""
import os, json, ssl, urllib.request, urllib.error

ctx = ssl.create_default_context()
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_VERSION = "2025-07"

def _load_secrets():
    p = os.path.join(HERE, "secrets.env")
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

_load_secrets()

class Shopify:
    def __init__(self):
        store = os.environ.get("SHOPIFY_STORE", "").replace(".myshopify.com", "")
        self.token = os.environ.get("SHOPIFY_TOKEN", "")
        self.version = os.environ.get("SHOPIFY_API_VERSION", DEFAULT_VERSION)
        if not store or not self.token:
            raise SystemExit("Missing SHOPIFY_STORE / SHOPIFY_TOKEN (env or secrets.env).")
        self.base = f"https://{store}.myshopify.com/admin/api/{self.version}"

    def _req(self, method, url, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "X-Shopify-Access-Token": self.token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
                txt = r.read().decode()
                return json.loads(txt) if txt else {}
        except urllib.error.HTTPError as e:
            raise SystemExit(f"HTTP {e.code} {method} {url}\n{e.read().decode()[:500]}")

    def rest(self, method, path, body=None):
        return self._req(method, f"{self.base}/{path.lstrip('/')}", body)

    def gql(self, query, variables=None):
        out = self._req("POST", f"{self.base}/graphql.json",
                        {"query": query, "variables": variables or {}})
        if "errors" in out:
            raise SystemExit("GraphQL errors:\n" + json.dumps(out["errors"], indent=2))
        return out["data"]

if __name__ == "__main__":
    s = Shopify()
    shop = s.rest("GET", "shop.json")["shop"]
    print(f"OK connected: {shop['name']} ({shop['myshopify_domain']}) plan={shop.get('plan_name')}")
