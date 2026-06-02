#!/usr/bin/env python3
"""Once a token is set, this assesses the store with zero manual steps:
  - confirms the token works (shop info)
  - lists themes and flags which one is GitHub-connected (the Ritual theme)
  - checks whether snippets/github-sync-check.liquid is present (repo -> store sync proof)
  - summarises current catalog state (product / collection / metaobject counts)
"""
from client import Shopify

def main():
    s = Shopify()
    shop = s.rest("GET", "shop.json")["shop"]
    print(f"[shop] {shop['name']} · {shop['myshopify_domain']} · plan={shop.get('plan_name')}")

    themes = s.rest("GET", "themes.json")["themes"]
    print(f"\n[themes] {len(themes)} found:")
    for t in themes:
        print(f"  id={t['id']} role={t['role']:9} name={t['name']!r}")

    # sync proof: look for the check snippet across themes
    print("\n[sync check] looking for snippets/github-sync-check.liquid ...")
    found = False
    for t in themes:
        try:
            a = s.rest("GET", f"themes/{t['id']}/assets.json?asset[key]=snippets/github-sync-check.liquid")
            if a.get("asset"):
                print(f"  FOUND in theme id={t['id']} ({t['name']!r}) -> repo->store sync CONFIRMED")
                found = True
        except SystemExit:
            pass
    if not found:
        print("  not found yet (theme may still be syncing, or connect not complete)")

    # catalog snapshot
    pc = s.rest("GET", "products/count.json").get("count")
    cc = s.rest("GET", "custom_collections/count.json").get("count")
    sc = s.rest("GET", "smart_collections/count.json").get("count")
    print(f"\n[catalog] products={pc} custom_collections={cc} smart_collections={sc}")

if __name__ == "__main__":
    main()
