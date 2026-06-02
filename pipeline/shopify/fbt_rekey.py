#!/usr/bin/env python3
"""Re-key merch.fbt from product display-titles to store handles, so the
Frequently-Bought-Together theme block can resolve products via all_products[handle]."""
import json, os, time
from client import Shopify

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
def load(p): return json.load(open(os.path.join(D, p)))
CAT = load("catalog_clean.json")
DESC = load("content/descriptions.json")
MET = {m["display_title"]: m for m in load("synth/product_metrics.json").values()}

SET = """
mutation($mfs:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$mfs){ userErrors{message} } }"""

def main():
    s = Shopify()
    # store product: content-title -> {id, handle}
    store, cursor = {}, None
    while True:
        d = s.gql('query($c:String){products(first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{id title handle}}}', {"c": cursor})["products"]
        for n in d["nodes"]: store[n["title"]] = n
        if not d["pageInfo"]["hasNextPage"]: break
        cursor = d["pageInfo"]["endCursor"]

    dt2src = {p["display_title"]: p["src_handle"] for p in CAT}
    def dt_to_handle(dt):
        src = dt2src.get(dt)
        if not src: return None
        ct = (DESC.get(src) or {}).get("title")
        return (store.get(ct) or {}).get("handle")

    batch, updated = [], 0
    for p in CAT:
        ct = (DESC.get(p["src_handle"]) or {}).get("title") or p["display_title"]
        node = store.get(ct)
        if not node: continue
        fbt_titles = (MET.get(p["display_title"]) or {}).get("fbt", [])
        handles = [h for h in (dt_to_handle(t) for t in fbt_titles) if h]
        if not handles: continue
        batch.append({"ownerId": node["id"], "namespace": "merch", "key": "fbt",
                      "type": "json", "value": json.dumps(handles)})
        updated += 1
        if len(batch) >= 24:
            r = s.gql(SET, {"mfs": batch})["metafieldsSet"]
            if r.get("userErrors"): print("  errs:", r["userErrors"][:2])
            batch = []; time.sleep(0.3)
    if batch:
        r = s.gql(SET, {"mfs": batch})["metafieldsSet"]
        if r.get("userErrors"): print("  errs:", r["userErrors"][:2])
    print(f"re-keyed merch.fbt to handles on {updated} products")

if __name__ == "__main__":
    main()
