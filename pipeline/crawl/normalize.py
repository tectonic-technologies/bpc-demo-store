#!/usr/bin/env python3
"""Normalize + de-brand + curate the raw crawl into ~300 cohesive products.
Output: data/curated.json (normalized) and data/curation_report.txt.
De-branding here is conservative (strip vendor + brand tokens from titles/desc);
full house-brand voice rewrite is a later step once brand identity is set."""
import json, os, glob, re, html
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")

BRAND_TOKENS = ["kosas", "ilia", "saie", "tower 28", "tower28", "tower-28",
                "westman atelier", "westman-atelier", "westman"]

JUNK = re.compile(r"gift card|e-gift|sample|merch|tote|sticker|tee|hat|book|collateral|test kit|swatch", re.I)
SETLIKE = re.compile(r"\b(set|kit|bundle|duo|trio|collection|edit|pack|wardrobe)\b", re.I)

# category inference from product_type + title
CATMAP = [
    ("Foundation", r"foundation|skin tint|tint|complexion|bb |cc cream"),
    ("Concealer", r"concealer|corrector"),
    ("Powder", r"powder|setting|blot"),
    ("Primer", r"primer|prep|base"),
    ("Blush", r"blush"),
    ("Bronzer", r"bronz"),
    ("Contour", r"contour|sculpt"),
    ("Highlighter", r"highlight|illuminiz|glow|luminiz"),
    ("Lipstick", r"lipstick|lip color|lip colour"),
    ("Lip Balm & Oil", r"lip balm|lip oil|lip gloss|lip treatment|lip mask"),
    ("Lip Liner", r"lip liner|lip pencil"),
    ("Mascara", r"mascara|lash"),
    ("Eyeliner", r"liner|kohl|kajal"),
    ("Brow", r"brow"),
    ("Eyeshadow", r"eyeshadow|eye shadow|eye color|shadow stick|eye paint"),
    ("SPF & Sun", r"spf|sunscreen|sun "),
    ("Serum & Treatment", r"serum|treatment|essence|moistur|cream|oil(?!\s*lip)"),
    ("Mist & Spray", r"mist|spray|sos"),
    ("Tool", r"brush|applicator|blender|sponge|curler|tool"),
]

def strip_brands(text):
    if not text: return text
    for t in BRAND_TOKENS:
        text = re.sub(re.escape(t), "", text, flags=re.I)
    return re.sub(r"\s{2,}", " ", text).strip(" -–—|")

def clean_html(s):
    if not s: return ""
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    return re.sub(r"\s{2,}", " ", s).strip()

def categorize(p):
    hay = (p.get("product_type", "") + " " + p.get("title", "")).lower()
    for cat, pat in CATMAP:
        if re.search(pat, hay): return cat
    return "Other"

def norm_tags(p):
    tags = p.get("tags", [])
    if isinstance(tags, str): tags = [t.strip() for t in tags.split(",")]
    clean = []
    for t in tags:
        tl = t.lower()
        if tl.startswith("clean-promise:"):
            clean.append("clean:" + tl.split(":", 1)[1].strip())
        elif tl in ("new", "best-sellers", "bestseller", "best seller", "vegan", "face", "complexion", "makeup"):
            clean.append(tl)
    return sorted(set(clean))

def load_all():
    out = []
    for f in glob.glob(os.path.join(HERE, "raw", "*.json")):
        slug = os.path.basename(f)[:-5]
        for p in json.load(open(f)):
            p["_brand"] = slug; out.append(p)
    return out

def score(p):
    s = 0
    s += min(len(p.get("images", [])), 8)
    s += 3 if len(clean_html(p.get("body_html"))) >= 120 else 0
    opts = [o.get("name", "").lower() for o in p.get("options", [])]
    if "shade" in opts or "color" in opts: s += 4   # shade depth = demo gold
    if p.get("_brand") == "westman": s -= 1          # cap luxury over-representation slightly
    return s

def main():
    allp = load_all()
    cands = []
    for p in allp:
        title = p.get("title", "")
        if JUNK.search(title + " " + p.get("product_type", "")): continue
        if SETLIKE.search(title) or p.get("product_type", "") in ("Bundle", "Duo", "set", "Set"): continue
        if not p.get("images"): continue
        cands.append(p)

    # curate per category to keep a balanced, cohesive assortment
    by_cat = {}
    for p in cands: by_cat.setdefault(categorize(p), []).append(p)
    TARGET = 300
    # sensible caps per category, plus per-source-brand caps for a balanced blend
    caps = {"Tool": 15, "Other": 10}
    brand_caps = {"westman": 95, "ilia": 82, "kosas": 66, "tower28": 52, "saie": 52}
    brand_used = Counter()
    curated = []
    # rank within category by score
    for cat, items in by_cat.items():
        items.sort(key=score, reverse=True)
    # round-robin fill to TARGET respecting category and brand caps
    order = sorted(by_cat, key=lambda c: -len(by_cat[c]))
    idx = {c: 0 for c in by_cat}
    cat_added = Counter()
    progressed = True
    while len(curated) < TARGET and progressed:
        progressed = False
        for c in order:
            if len(curated) >= TARGET: break
            if cat_added[c] >= caps.get(c, 9999): continue
            # advance to next item in this category whose brand is under cap
            while idx[c] < len(by_cat[c]):
                p = by_cat[c][idx[c]]; idx[c] += 1
                b = p["_brand"]
                if brand_used[b] < brand_caps.get(b, 9999):
                    curated.append(p); brand_used[b] += 1; cat_added[c] += 1
                    progressed = True
                    break

    # normalize curated
    norm = []
    for p in curated:
        opts = [{"name": o.get("name"), "values": o.get("values", [])} for o in p.get("options", [])]
        variants = [{
            "sku": v.get("sku"), "title": strip_brands(v.get("title")),
            "price": v.get("price"), "option_values": [v.get("option1"), v.get("option2"), v.get("option3")],
            "available": v.get("available"),
        } for v in p.get("variants", [])]
        norm.append({
            "src_brand": p["_brand"],
            "src_handle": p.get("handle"),
            "title": strip_brands(p.get("title")),
            "category": categorize(p),
            "description": strip_brands(clean_html(p.get("body_html"))),
            "options": opts,
            "variants": variants,
            "images": [img.get("src") for img in p.get("images", [])],
            "tags": norm_tags(p),
            "shade_count": len(next((o["values"] for o in opts if o["name"] and o["name"].lower() in ("shade", "color")), [])),
        })

    os.makedirs(DATA, exist_ok=True)
    json.dump(norm, open(os.path.join(DATA, "curated.json"), "w"), indent=1)

    # report
    catc = Counter(p["category"] for p in norm)
    srcc = Counter(p["src_brand"] for p in norm)
    shaded = sum(1 for p in norm if p["shade_count"] > 1)
    rep = ["CURATED CATALOG REPORT", f"count: {len(norm)}", "",
           "by category:"] + [f"  {v:3} {k}" for k, v in catc.most_common()] + \
          ["", "by source brand:"] + [f"  {v:3} {k}" for k, v in srcc.most_common()] + \
          ["", f"products with shade ranges (>1): {shaded}",
           f"total variants: {sum(len(p['variants']) for p in norm)}",
           f"total images: {sum(len(p['images']) for p in norm)}"]
    open(os.path.join(DATA, "curation_report.txt"), "w").write("\n".join(rep))
    print("\n".join(rep))

if __name__ == "__main__":
    main()
