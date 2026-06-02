#!/usr/bin/env python3
"""Add per-product content metafields to already-loaded products:
  reviews.items (json, capped list of individual reviews)
  content.faqs  (json, list of {question,answer,category})
Matches store products to data by title. Run after products are loaded."""
import json, os, time
from client import Shopify

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
def load(p): return json.load(open(os.path.join(D, p)))
CAT = load("catalog_clean.json")
DESC = load("content/descriptions.json")
FAQS = load("content/faqs.json")
REV = {r["display_title"]: r for r in load("synth/reviews.json").values()}

SET = """
mutation($mfs:[MetafieldsSetInput!]!){
  metafieldsSet(metafields:$mfs){ userErrors{field message} }
}"""

def main():
    s = Shopify()
    # title -> product gid
    gid, cursor = {}, None
    while True:
        d = s.gql('query($c:String){products(first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{id title}}}', {"c": cursor})["products"]
        for n in d["nodes"]: gid[n["title"]] = n["id"]
        if not d["pageInfo"]["hasNextPage"]: break
        cursor = d["pageInfo"]["endCursor"]
    print(f"matched {len(gid)} store products")

    batch, ok, miss = [], 0, 0
    for p in CAT:
        title = DESC.get(p["src_handle"], {}).get("title") or p["display_title"]
        pid = gid.get(title)
        if not pid: miss += 1; continue
        reviews = REV.get(p["display_title"], {}).get("reviews", [])[:10]
        faqs = FAQS.get(p["src_handle"], [])
        if reviews:
            batch.append({"ownerId": pid, "namespace": "reviews", "key": "items",
                          "type": "json", "value": json.dumps(reviews)})
        if faqs:
            batch.append({"ownerId": pid, "namespace": "content", "key": "faqs",
                          "type": "json", "value": json.dumps(faqs)})
        ok += 1
        if len(batch) >= 24:
            r = s.gql(SET, {"mfs": batch})["metafieldsSet"]
            if r.get("userErrors"): print("  errs:", r["userErrors"][:2])
            batch = []; time.sleep(0.3)
    if batch:
        r = s.gql(SET, {"mfs": batch})["metafieldsSet"]
        if r.get("userErrors"): print("  errs:", r["userErrors"][:2])
    print(f"content metafields set on {ok} products (missed {miss})")

if __name__ == "__main__":
    main()
