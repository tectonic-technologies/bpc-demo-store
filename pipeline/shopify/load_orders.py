#!/usr/bin/env python3
"""Load synthetic customers + orders. Idempotent-ish: skips if customers exist.
Orders backdated via processed_at; line items mapped to real store variants.
Run after products are loaded."""
import json, os, time
from client import Shopify

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
def load(p): return json.load(open(os.path.join(D, p)))
CAT = load("catalog_clean.json")
DESC = load("content/descriptions.json")
CUST = load("synth/customers.json")
ORD = load("synth/orders.json")

def main():
    s = Shopify()
    if s.rest("GET", "customers/count.json").get("count", 0) > 0:
        print("customers already exist; skipping customer + order load to avoid dupes.")
        return

    # variant map: content title -> numeric variant id
    vmap, cursor = {}, None
    while True:
        d = s.gql('query($c:String){products(first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{title variants(first:1){nodes{legacyResourceId}}}}}', {"c": cursor})["products"]
        for n in d["nodes"]:
            vs = n["variants"]["nodes"]
            if vs: vmap[n["title"]] = vs[0]["legacyResourceId"]
        if not d["pageInfo"]["hasNextPage"]: break
        cursor = d["pageInfo"]["endCursor"]
    # product index -> variant id
    idx_variant = {}
    for i, p in enumerate(CAT):
        title = DESC.get(p["src_handle"], {}).get("title") or p["display_title"]
        if title in vmap: idx_variant[i] = vmap[title]
    print(f"variant map: {len(idx_variant)}/{len(CAT)} products")

    # customers
    cid = {}
    for c in CUST:
        body = {"customer": {"first_name": c["first_name"], "last_name": c["last_name"],
                "email": c["email"], "tags": ",".join(c["tags"]),
                "addresses": [{"city": c["city"], "province": c["province"], "country_code": c["country_code"]}]}}
        try:
            r = s.rest("POST", "customers.json", body)
            cid[c["ref"]] = r["customer"]["id"]
        except SystemExit:
            pass
        time.sleep(0.5)
    print(f"customers created: {len(cid)}")

    # orders
    ok = 0
    for o in ORD:
        items = [{"variant_id": idx_variant[li["product_i"]], "quantity": li["qty"]}
                 for li in o["line_items"] if li["product_i"] in idx_variant]
        if not items: continue
        body = {"order": {
            "line_items": items,
            "financial_status": "paid",
            "processed_at": o["created_at"] + "T12:00:00Z",
            "send_receipt": False, "send_fulfillment_receipt": False,
            "inventory_behaviour": "bypass",
        }}
        if o["customer_ref"] in cid:
            body["order"]["customer"] = {"id": cid[o["customer_ref"]]}
        try:
            s.rest("POST", "orders.json", body); ok += 1
        except SystemExit:
            pass
        if ok % 100 == 0: print(f"  orders: {ok}")
        time.sleep(0.5)
    print(f"\norders created: {ok}")

if __name__ == "__main__":
    main()
