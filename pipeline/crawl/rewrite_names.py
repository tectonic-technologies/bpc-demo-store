#!/usr/bin/env python3
"""Apply MAREN functional/minimal naming to curated products.
Deterministic de-brand of titles: strip symbols, drop proprietary marketing
prefixes, keep functional descriptor. Also strips symbols from descriptions.
Outputs data/catalog_maren.json with display_title + clean_description added.
Full voice rewrite of description bodies happens in the enrichment/synth step."""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")

# descriptive words we always keep (finish / format / category / benefit)
KEEP = set("""serum concealer foundation tint skin powder matte cream creamy liquid
stick balm oil gloss lipstick lip color colour blush bronzer contour highlighter
illuminizer mascara liner eyeliner brow eyeshadow shadow primer spf sunscreen
mineral hydrating plumping setting sheer luminous dewy weightless soft focus
brush sponge blender mist spray essence treatment glow nourishing tinted velvet
satin radiant blurring buildable medium full coverage sun""".split())

# proprietary / marketing tokens to drop when they lead the name
DROP_LEAD = re.compile(r"^(swipe|getset|shineon|vibeplump|sunnydays|sunny days|"
                       r"super|the|wonder|magic|miracle|revealer|cloud|baby|"
                       r"daily|everyday|clean)\b", re.I)

def smartcaps(w):
    return w if (w.isupper() and len(w) <= 3) else w.capitalize()

def rewrite_title(t):
    if not t: return t
    t = t.replace("®", "").replace("™", "").replace("™", "")
    t = re.sub(r"\s{2,}", " ", t).strip(" -–—|")
    # drop a leading proprietary token (once)
    prev = None
    while prev != t:
        prev = t
        t = DROP_LEAD.sub("", t).strip(" -–—|")
    # collapse: keep words; if result too short, fall back to original-stripped
    words = [w for w in re.split(r"\s+", t) if w]
    if len(words) < 2:
        words = [w for w in re.split(r"\s+", prev) if w]
    title = " ".join(smartcaps(w) for w in words)
    title = re.sub(r"\bSpf\b", "SPF", title)
    return title.strip()

def clean_desc(d):
    if not d: return d
    d = d.replace("®", "").replace("™", "").replace("™", "")
    # strip proprietary CamelCase tech names like VibePlump, ColorClone
    d = re.sub(r"\b([A-Z][a-z]+[A-Z][a-z]+)\b", lambda m: m.group(1), d)
    return re.sub(r"\s{2,}", " ", d).strip()

def main():
    cat = json.load(open(os.path.join(DATA, "curated.json")))
    samples = []
    for p in cat:
        orig = p["title"]
        p["display_title"] = rewrite_title(orig)
        p["clean_description"] = clean_desc(p["description"])
        if len(samples) < 14 and orig != p["display_title"]:
            samples.append((p["src_brand"], orig, p["display_title"]))
    json.dump(cat, open(os.path.join(DATA, "catalog_maren.json"), "w"), indent=1)
    print(f"rewrote {len(cat)} products -> data/catalog_maren.json\n")
    print("sample renames (orig -> MAREN):")
    for b, o, n in samples:
        print(f"  [{b}] {o!r} -> {n!r}")

if __name__ == "__main__":
    main()
