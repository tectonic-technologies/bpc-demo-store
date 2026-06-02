#!/usr/bin/env python3
"""Post-curation cleanup: recategorize 'Other', drop broken/collab products,
dedupe cross-brand near-identical items. Produces data/catalog_clean.json."""
import json, os, re
from collections import Counter, defaultdict

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")

RECAT = [
    ("Blush", r"multistick|multi-stick|multi stick|wet stick|cheek"),
    ("Eyeshadow", r"palette|eyeshadow|eye paint|shadow"),
    ("Lip Balm & Oil", r"lip jelly|lip gloss|gloss|lip oil|glossybounce|lip balm"),
    ("Powder", r"airset|setting|powder|blot"),
    ("Highlighter", r"glow|illuminiz|luminiz"),
    ("Foundation", r"skin tint|foundation|complexion"),
]

def recategorize(p):
    if p["category"] != "Other":
        return p["category"]
    hay = (p["display_title"] + " " + p.get("clean_description", "")).lower()
    for cat, pat in RECAT:
        if re.search(pat, hay):
            return cat
    return "Other"

def usable_price(p):
    return any((v.get("price") or "") not in ("", "0", "0.00") for v in p["variants"])

def score(p):
    s = min(len(p.get("images", [])), 8)
    s += 3 if len(p.get("clean_description", "") or "") >= 120 else 0
    s += 4 if p.get("shade_count", 0) > 1 else 0
    return s

def main():
    d = json.load(open(os.path.join(DATA, "catalog_maren.json")))
    n0 = len(d)

    # 1. drop broken / collab products
    kept = []
    dropped = defaultdict(list)
    for p in d:
        desc = p.get("clean_description", "") or ""
        title = p["display_title"]
        if ":" in title and re.match(r"^[A-Z][a-zA-Z]+ ?[A-Z]?[a-z]*:", title):
            dropped["collab"].append(title); continue
        if len(desc) < 30:
            dropped["empty_desc"].append(title); continue
        if not usable_price(p):
            dropped["no_price"].append(title); continue
        if len(p.get("images", [])) < 2:
            dropped["thin_images"].append(title); continue
        p["category"] = recategorize(p)
        kept.append(p)

    # 2. dedupe cross-brand near-identical (same normalized display_title)
    groups = defaultdict(list)
    for p in kept:
        key = re.sub(r"\bmini\b", "", p["display_title"].lower()).strip()
        key = re.sub(r"\s{2,}", " ", key)
        groups[key].append(p)
    deduped, removed_dups = [], []
    for key, items in groups.items():
        if len(items) == 1:
            deduped.append(items[0]); continue
        items.sort(key=score, reverse=True)
        deduped.append(items[0])
        for x in items[1:]:
            removed_dups.append(x["display_title"])

    json.dump(deduped, open(os.path.join(DATA, "catalog_clean.json"), "w"), indent=1)

    print(f"in: {n0}  ->  clean: {len(deduped)}")
    for k, v in dropped.items():
        print(f"  dropped {k}: {len(v)}  e.g. {v[:3]}")
    print(f"  removed cross-brand dups: {len(removed_dups)}  e.g. {removed_dups[:5]}")
    cat = Counter(p["category"] for p in deduped)
    print("\nfinal categories:")
    for k, v in cat.most_common():
        print(f"  {v:3} {k}")
    print(f"  Other remaining: {cat.get('Other',0)}")
    print(f"\nshade-range products: {sum(1 for p in deduped if p['shade_count']>1)}")

if __name__ == "__main__":
    main()
