#!/usr/bin/env python3
"""Load MAREN products into the store via GraphQL productSet:
title, description (MAREN voice), variants/options, ~6 images (by URL),
metafields (reviews, merch, inv, spec facets, ingredients), SEO, tags.
Usage: python3 load_products.py [limit]   (no limit = all)"""
import json, os, sys, time
from client import Shopify

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
def load(p): return json.load(open(os.path.join(D, p)))

CAT = load("catalog_clean.json")
DESC = load("content/descriptions.json")
ENR = {e["src_handle"]: e for e in load("enriched.json")}
MET = {m["display_title"]: m for m in load("synth/product_metrics.json").values()}
REV = {r["display_title"]: r for r in load("synth/reviews.json").values()}

MUT = """
mutation($input: ProductSetInput!, $sync: Boolean) {
  productSet(input: $input, synchronous: $sync) {
    product { id handle title }
    userErrors { field message }
  }
}"""

def mf(ns, key, typ, val):
    if val is None or val == "" or val == []: return None
    if typ == "boolean": v = "true" if val else "false"
    elif typ == "json": v = json.dumps(val)
    elif typ in ("number_integer",): v = str(int(val))
    elif typ in ("number_decimal",): v = str(val)
    else: v = str(val)
    return {"namespace": ns, "key": key, "type": typ, "value": v}

def build_input(p):
    h = p["src_handle"]; dt = p["display_title"]
    c = DESC.get(h, {}); e = ENR.get(h, {}); m = MET.get(dt, {}); r = REV.get(dt, {})
    f = (e.get("facets") or {})
    real_opts = [o for o in p["options"] if o["name"] and o["name"].lower() not in ("title", "default title")]
    inp = {
        "title": c.get("title") or dt,
        "descriptionHtml": c.get("description", ""),
        "vendor": "MAREN",
        "productType": p["category"],
        "status": "ACTIVE",
        "tags": list(filter(None, [
            p["category"], f.get("finish"), f.get("skin_type"), f.get("price_band"),
            "best-seller" if m.get("best_seller") else None,
            "new" if m.get("is_new") else None,
            "clearance" if m.get("is_clearance") else None, "MAREN",
        ])),
        "seo": {"title": c.get("seo_title"), "description": c.get("seo_description")},
        "files": [{"originalSource": u, "contentType": "IMAGE"} for u in (e.get("images") or [])[:6]],
    }
    # options + variants: derive option values from variants so nothing is null
    price0 = m.get("price") or 24.0
    valid = []
    for v in p["variants"]:
        ovals, full = [], True
        for i, o in enumerate(real_opts):
            val = v["option_values"][i] if i < len(v["option_values"]) else None
            if not val: full = False; break
            ovals.append({"optionName": o["name"], "name": str(val)})
        if real_opts and full and ovals:
            valid.append((v, ovals))
    if real_opts and valid:
        opt_vals = {o["name"]: [] for o in real_opts}
        for v, ovals in valid:
            for ov in ovals:
                if ov["name"] not in opt_vals[ov["optionName"]]:
                    opt_vals[ov["optionName"]].append(ov["name"])
        inp["productOptions"] = [{"name": o["name"], "values": [{"name": x} for x in opt_vals[o["name"]]]} for o in real_opts]
        inp["variants"] = [{
            "optionValues": ovals,
            "price": v.get("price") or price0,
            "inventoryPolicy": "CONTINUE",
            "inventoryItem": {"sku": v.get("sku") or "", "tracked": False},
        } for v, ovals in valid]
    else:
        # single-variant product still needs the default option + optionValue
        inp["productOptions"] = [{"name": "Title", "values": [{"name": "Default Title"}]}]
        inp["variants"] = [{"optionValues": [{"optionName": "Title", "name": "Default Title"}],
                            "price": price0, "inventoryPolicy": "CONTINUE",
                            "inventoryItem": {"tracked": False}}]
    # metafields
    mfs = [
        mf("reviews","rating","number_decimal", r.get("rating")),
        mf("reviews","count","number_integer", r.get("count")),
        mf("reviews","distribution","json", r.get("distribution")),
        mf("reviews","sentiment_themes","json", r.get("sentiment_themes")),
        mf("merch","units_sold_30d","number_integer", m.get("units_sold_30d")),
        mf("merch","margin","number_decimal", m.get("margin")),
        mf("merch","is_new","boolean", m.get("is_new")),
        mf("merch","is_clearance","boolean", m.get("is_clearance")),
        mf("merch","best_seller","boolean", m.get("best_seller")),
        mf("merch","fbt","json", m.get("fbt")),
        mf("merch","live_viewers_base","number_integer", m.get("live_viewers_base")),
        mf("inv","tier","single_line_text_field", m.get("inv_tier")),
        mf("inv","on_hand","number_integer", m.get("on_hand")),
        mf("spec","finish","single_line_text_field", f.get("finish")),
        mf("spec","coverage","single_line_text_field", f.get("coverage")),
        mf("spec","skin_type","single_line_text_field", f.get("skin_type")),
        mf("spec","concern","json", f.get("concern")),
        mf("spec","price_band","single_line_text_field", f.get("price_band")),
        mf("spec","has_shades","boolean", f.get("has_shades")),
        mf("spec","shade_count","number_integer", f.get("shade_count")),
        mf("spec","ingredients_key","json", e.get("ingredients_key")),
    ]
    inp["metafields"] = [x for x in mfs if x]
    return inp

def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else len(CAT)
    s = Shopify()
    # idempotency: skip products already in the store (match by title)
    existing, cursor = set(), None
    while True:
        d = s.gql('query($c:String){products(first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{title}}}', {"c": cursor})["products"]
        existing.update(n["title"] for n in d["nodes"])
        if not d["pageInfo"]["hasNextPage"]: break
        cursor = d["pageInfo"]["endCursor"]
    print(f"already in store: {len(existing)} products (will skip these)")
    ok, fail, skip = 0, 0, 0
    for i, p in enumerate(CAT[:limit]):
        title = DESC.get(p["src_handle"], {}).get("title") or p["display_title"]
        if title in existing:
            skip += 1; continue
        inp = build_input(p)
        if not inp.get("variants"):
            print(f"  skip (no variants): {p['display_title']}"); continue
        try:
            data = s.gql(MUT, {"input": inp, "sync": True})
        except BaseException as ex:
            fail += 1
            print(f"  ERR(gql) {p['display_title']}: {str(ex)[:160]}")
            time.sleep(0.6); continue
        res = data["productSet"]
        errs = res.get("userErrors") or []
        if errs:
            fail += 1
            print(f"  ERR {p['display_title']}: {errs[:2]}")
        else:
            ok += 1
            if ok <= 3 or ok % 25 == 0:
                print(f"  [{ok}] {res['product']['title']} -> {res['product']['handle']}")
        time.sleep(0.6)
    print(f"\nLOADED ok={ok} fail={fail} skipped={skip} (of {min(limit,len(CAT))})")

if __name__ == "__main__":
    main()
