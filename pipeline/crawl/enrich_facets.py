#!/usr/bin/env python3
"""Derive facets, key ingredients, Shopify taxonomy path, and select ~6 images.
Also emit collection definitions. Outputs data/enriched.json + data/collections.json.
Facet inference is keyword-based off the cleaned title+description."""
import json, os, re

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
CAT = json.load(open(os.path.join(DATA, "catalog_clean.json")))
METRICS = json.load(open(os.path.join(DATA, "synth", "product_metrics.json")))

FINISH = [("matte", r"matte"), ("dewy", r"dewy|glow|luminous|radiant"),
          ("satin", r"satin|natural finish|soft focus"), ("sheer", r"sheer|tint|translucent")]
COVERAGE = [("full", r"full coverage|full-coverage"), ("medium", r"medium|buildable"),
            ("sheer", r"sheer|light coverage")]
SKIN = [("sensitive", r"sensitive|fragrance-free|gentle|non-irritat"),
        ("dry", r"dry skin|hydrat|nourish"), ("oily", r"oily|mattif|oil-control|shine"),
        ("combination", r"combination")]
CONCERN = [("dark-circles", r"dark circle|under-eye|undereye"), ("redness", r"redness|rosacea|calm"),
           ("dullness", r"dull|brighten|radiance|glow"), ("dryness", r"dry|hydrat|moistur"),
           ("texture", r"texture|smooth|pore|blur"), ("fine-lines", r"fine line|aging|firm|plump"),
           ("uneven-tone", r"even tone|uneven|discolor|dark spot")]
INGREDIENTS = ["hyaluronic acid","niacinamide","vitamin c","squalane","peptide","ceramide",
               "shea butter","jojoba","vitamin e","spf","retinol","aloe","green tea","caffeine"]

def first(rules, hay, default=None):
    for label, pat in rules:
        if re.search(pat, hay): return label
    return default

def price_band(price):
    if price < 20: return "entry"
    if price < 35: return "core"
    if price < 55: return "premium"
    return "luxe"

# Shopify standard taxonomy paths (GIDs resolved at load via taxonomy query)
TAX = {
    "Foundation": "Health & Beauty > Personal Care > Cosmetics > Makeup > Face Makeup > Foundations & Concealers",
    "Concealer": "Health & Beauty > Personal Care > Cosmetics > Makeup > Face Makeup > Foundations & Concealers",
    "Powder": "Health & Beauty > Personal Care > Cosmetics > Makeup > Face Makeup > Face Powder",
    "Primer": "Health & Beauty > Personal Care > Cosmetics > Makeup > Face Makeup > Face Primer",
    "Blush": "Health & Beauty > Personal Care > Cosmetics > Makeup > Face Makeup > Blushes & Bronzers",
    "Bronzer": "Health & Beauty > Personal Care > Cosmetics > Makeup > Face Makeup > Blushes & Bronzers",
    "Contour": "Health & Beauty > Personal Care > Cosmetics > Makeup > Face Makeup > Blushes & Bronzers",
    "Highlighter": "Health & Beauty > Personal Care > Cosmetics > Makeup > Face Makeup > Highlighter & Luminizer",
    "Lipstick": "Health & Beauty > Personal Care > Cosmetics > Makeup > Lip Makeup > Lipstick",
    "Lip Balm & Oil": "Health & Beauty > Personal Care > Cosmetics > Makeup > Lip Makeup > Lip Gloss",
    "Lip Liner": "Health & Beauty > Personal Care > Cosmetics > Makeup > Lip Makeup > Lip Liner",
    "Mascara": "Health & Beauty > Personal Care > Cosmetics > Makeup > Eye Makeup > Mascara",
    "Eyeliner": "Health & Beauty > Personal Care > Cosmetics > Makeup > Eye Makeup > Eyeliner",
    "Brow": "Health & Beauty > Personal Care > Cosmetics > Makeup > Eye Makeup > Eyebrow Enhancers",
    "Eyeshadow": "Health & Beauty > Personal Care > Cosmetics > Makeup > Eye Makeup > Eye Shadow",
    "SPF & Sun": "Health & Beauty > Personal Care > Cosmetics > Sun Care > Sunscreen",
    "Serum & Treatment": "Health & Beauty > Personal Care > Cosmetics > Skin Care > Anti-Aging Skin Care Kits",
    "Mist & Spray": "Health & Beauty > Personal Care > Cosmetics > Skin Care > Toners & Astringents",
    "Tool": "Health & Beauty > Personal Care > Cosmetics > Cosmetic Tools > Makeup Tools",
    "Other": "Health & Beauty > Personal Care > Cosmetics > Makeup",
}

def select_images(imgs, cap=6):
    if len(imgs) <= cap: return imgs
    out = [imgs[0]]
    rest = imgs[1:]
    step = max(1, len(rest)//(cap-1))
    out += rest[::step][:cap-1]
    return out[:cap]

def main():
    enriched = []
    for p in CAT:
        hay = (p["display_title"] + " " + p.get("clean_description","")).lower()
        m = METRICS[str(p["_i"])] if str(p.get("_i")) in METRICS else None
        # _i may not be on catalog_clean; match by display_title fallback
        price = p.get("_price") or 0
        if m is None:
            m = next((mm for mm in METRICS.values() if mm["display_title"]==p["display_title"]), {})
        price = m.get("price", price) or 0
        enriched.append({
            "src_handle": p["src_handle"],
            "display_title": p["display_title"],
            "category": p["category"],
            "taxonomy_path": TAX.get(p["category"], TAX["Other"]),
            "facets": {
                "finish": first(FINISH, hay),
                "coverage": first(COVERAGE, hay),
                "skin_type": first(SKIN, hay, "all"),
                "concern": [c for c,_ in CONCERN if re.search(_, hay)],
                "price_band": price_band(price),
                "has_shades": p.get("shade_count",0) > 1,
                "shade_count": p.get("shade_count",0),
            },
            "ingredients_key": [ing for ing in INGREDIENTS if ing in hay],
            "images": select_images(p.get("images", [])),
        })
    json.dump(enriched, open(os.path.join(DATA,"enriched.json"),"w"), indent=1)

    # ---- collection definitions ----
    cats = sorted({p["category"] for p in CAT})
    collections = []
    for c in cats:
        collections.append({"handle": "cat-"+re.sub(r"[^a-z0-9]+","-",c.lower()).strip("-"),
                            "title": c, "type": "smart", "rule": {"field":"category","value":c}})
    for concern,_ in CONCERN:
        collections.append({"handle":"concern-"+concern,"title":concern.replace("-"," ").title(),
                            "type":"smart","rule":{"field":"concern","value":concern}})
    collections += [
        {"handle":"best-sellers","title":"Best Sellers","type":"manual","rule":{"field":"best_seller"}},
        {"handle":"new","title":"New","type":"manual","rule":{"field":"is_new"}},
        {"handle":"clearance","title":"Last Chance","type":"manual","rule":{"field":"is_clearance"}},
        {"handle":"sensitive-skin","title":"For Sensitive Skin","type":"smart","rule":{"field":"skin_type","value":"sensitive"}},
        {"handle":"the-edit","title":"The Edit","type":"manual","rule":{"field":"editorial"}},
    ]
    json.dump(collections, open(os.path.join(DATA,"collections.json"),"w"), indent=1)

    # report
    img_total = sum(len(e["images"]) for e in enriched)
    from collections import Counter
    fin = Counter(e["facets"]["finish"] for e in enriched)
    print(f"enriched {len(enriched)} products")
    print(f"images after ~6 cap: {img_total} (avg {img_total/len(enriched):.1f}/product)")
    print(f"finish facet coverage: {dict(fin)}")
    print(f"with concern tags: {sum(1 for e in enriched if e['facets']['concern'])}")
    print(f"with key ingredients: {sum(1 for e in enriched if e['ingredients_key'])}")
    print(f"collections defined: {len(collections)}")

if __name__ == "__main__":
    main()
