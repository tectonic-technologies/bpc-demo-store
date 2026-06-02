#!/usr/bin/env python3
"""Generate the MAREN copy/content layer (authored, store-independent):
  - polished MAREN-voice titles + descriptions + SEO
  - FAQs per product (category-tagged)
  - A+ blocks for hero products
  - routines (Shop-the-Look) and product groups (shade/finish families)
Outputs to data/content/. Content rules: no em-dash, no hype superlatives."""
import json, os, re, random
from collections import defaultdict

random.seed(7)
DATA = os.path.dirname(os.path.abspath(__file__)) + "/../data"
OUT = os.path.join(DATA, "content"); os.makedirs(OUT, exist_ok=True)
CAT = json.load(open(os.path.join(DATA, "catalog_clean.json")))
ENR = {e["display_title"]: e for e in json.load(open(os.path.join(DATA, "enriched.json")))}
MET = {m["display_title"]: m for m in json.load(open(os.path.join(DATA, "synth/product_metrics.json"))).values()}

# --- title polish: kill residual proprietary tokens ---
PROP_FIX = {
    "lipsoftie": "", "makewaves": "Lengthening", "supersuede": "Soft Matte",
    "glow sculpt": "Cream Contour", "glossybounce": "Glossy", "airset": "Setting",
    "impressionist": "", "vibeplump": "Plumping", "findation": "",
}
NOUN = {"Foundation":"Foundation","Concealer":"Concealer","Powder":"Powder","Primer":"Primer",
        "Blush":"Blush","Bronzer":"Bronzer","Contour":"Contour Stick","Highlighter":"Highlighter",
        "Lipstick":"Lipstick","Lip Balm & Oil":"Lip Oil","Lip Liner":"Lip Liner","Mascara":"Mascara",
        "Eyeliner":"Eyeliner","Brow":"Brow Pencil","Eyeshadow":"Eyeshadow","SPF & Sun":"Mineral SPF",
        "Serum & Treatment":"Serum","Mist & Spray":"Face Mist","Tool":"Brush","Other":"Multi-Stick"}

NOUN_WORDS = set("foundation concealer powder primer blush bronzer contour highlighter lipstick lip oil gloss liner mascara eyeliner brow pencil eyeshadow shadow spf serum mist brush balm stick cream tint multistick multi-stick".split())

def polish_title(t, cat):
    for bad, repl in PROP_FIX.items():
        if bad in t.lower():
            t = re.sub(bad, repl, t, flags=re.I)
    t = re.sub(r"\s{2,}", " ", t).strip(" -")
    words = [w for w in t.split() if w]
    # append a functional noun only if no recognised product noun is present
    if len(words) < 2 or not any(w.lower() in NOUN_WORDS for w in words):
        t = (t + " " + NOUN[cat]).strip()
    return re.sub(r"\bSpf\b","SPF"," ".join(w if w.isupper() else w[:1].upper()+w[1:] for w in t.split())).strip()

# --- description rewrite in MAREN voice ---
LEAD = {
    "Foundation":"Skin, only more even.","Concealer":"Quiet coverage where you want it.",
    "Powder":"A soft-focus finish, nothing cakey.","Blush":"A worn-in flush.",
    "Lipstick":"Comfortable colour that stays put.","Lip Balm & Oil":"Glassy shine, real care.",
    "Mascara":"Definition without the drama.","Serum & Treatment":"Daily care that earns its place.",
    "Highlighter":"Light, placed with intention.","Bronzer":"Warmth that reads natural.",
    "Contour":"Structure, softly.","SPF & Sun":"Protection that disappears into skin.",
}
HYPE = re.compile(r"\b(first-ever|first ever|world'?s first|revolutionary|#1|number one|best-ever|best ever|instantly|miracle|magic|game-?changer)\b", re.I)
CAMEL = re.compile(r"\b[A-Z][a-z]+[A-Z][a-z]+\w*\b")  # invented product/tech names

def tidy(s):
    s = CAMEL.sub("", s)            # drop proprietary CamelCase tokens
    s = HYPE.sub("", s)             # drop hype superlatives (MAREN rule)
    s = s.replace("—", ", ").replace(" — ", ", ")
    s = re.sub(r"\s+,", ",", s)
    s = re.sub(r",\s*,", ",", s)
    s = re.sub(r"\s{2,}", " ", s)
    s = re.sub(r"\bthat\s+technology\b", "technology", s, flags=re.I)
    return s.strip(" ,")

def rewrite_desc(p, enr):
    cat = p["category"]; f = (enr or {}).get("facets", {})
    src = (p.get("clean_description") or "").strip()
    first = tidy(re.split(r"(?<=[.!])\s", src)[0]) if src else ""
    bits = [LEAD.get(cat, "A considered essential.")]
    if first and len(first) > 30: bits.append(first.rstrip("."))
    if f.get("finish"): bits.append(f"A {f['finish']} finish")
    ing = (enr or {}).get("ingredients_key", [])
    if ing: bits.append("Made with " + ", ".join(ing[:3]))
    txt = ". ".join(b.strip().rstrip(".") for b in bits if b) + "."
    return txt.replace(" — ", ", ").replace("—", ", ")

# --- FAQs ---
def faqs(p, enr):
    cat = p["category"]; f = (enr or {}).get("facets", {})
    out = [
        {"category":"usage","question":f"How do I apply the {p['display_title']}?",
         "answer":"Apply in thin layers and build to your preferred level. A little goes a long way."},
        {"category":"care","question":"Is it suitable for sensitive skin?",
         "answer":("Formulated to be gentle and fragrance-conscious; patch test if your skin is reactive."
                   if f.get("skin_type")=="sensitive" else "Suitable for most skin types; patch test if reactive.")},
        {"category":"general","question":"Is it long-wearing?",
         "answer":"It is made to wear comfortably through the day with minimal touch-ups."},
    ]
    if p.get("shade_count",0) > 1:
        out.append({"category":"sizing","question":"How do I choose my shade?",
                    "answer":"Match to the side of your jaw in natural light, or contact us for a shade recommendation."})
    return out

# --- A+ blocks for heroes ---
def aplus(p, enr, met):
    ing = (enr or {}).get("ingredients_key", [])
    blocks = [{"type":"story","heading":"Made with intention",
               "body":"Fewer, better products. Clean formulas, considered packaging, skin first."}]
    if ing:
        blocks.append({"type":"ingredient","heading":"Key ingredients",
                       "body":"Powered by " + ", ".join(ing[:4]) + "."})
    blocks.append({"type":"hero","heading":p["display_title"],
                   "body": rewrite_desc(p, enr)})
    return blocks

def main():
    descs, fqs, ap = {}, {}, {}
    for p in CAT:
        enr = ENR.get(p["display_title"])
        title = polish_title(p["display_title"], p["category"])
        d = rewrite_desc(p, enr)
        descs[p["src_handle"]] = {
            "title": title, "description": d,
            "seo_title": f"{title} | MAREN",
            "seo_description": (d[:150]).rstrip(". ") + ".",
        }
        fqs[p["src_handle"]] = faqs(p, enr)
    # heroes = top 40 by units sold
    heroes = sorted(CAT, key=lambda p: MET.get(p["display_title"],{}).get("units_sold_total",0), reverse=True)[:40]
    for p in heroes:
        ap[p["src_handle"]] = aplus(p, ENR.get(p["display_title"]), MET.get(p["display_title"]))

    # routines (Shop the Look)
    by_cat = defaultdict(list)
    for p in CAT: by_cat[p["category"]].append(p)
    def pick(cat):
        return random.choice(by_cat[cat])["src_handle"] if by_cat.get(cat) else None
    routine_defs = [
        ("The Five-Minute Face","Tinted base, a wash of colour, a defined lash.",
         [("Foundation","Even out with a sheer layer"),("Concealer","Spot-conceal where needed"),
          ("Blush","A soft flush on the cheeks"),("Mascara","One coat to define")]),
        ("Dewy, No-Makeup Look","Skin-first glow with the lightest touch.",
         [("SPF & Sun","Protect first"),("Foundation","Sheer, where you want it"),
          ("Highlighter","Tap onto high points"),("Lip Balm & Oil","Finish with shine")]),
        ("Evening Definition","Turn it up with structure and a bolder lip.",
         [("Contour","Add structure"),("Bronzer","Warm it through"),
          ("Lip Liner","Define the lip"),("Lipstick","Layer the colour")]),
        ("The Considered Routine","A calm daily ritual for skin.",
         [("Serum & Treatment","Treat morning and night"),("Mist & Spray","Refresh and set"),
          ("SPF & Sun","Always finish with protection")]),
    ]
    routines = []
    for name, ed, steps in routine_defs:
        members = [{"product": pick(c), "note": n} for c, n in steps if pick(c)]
        routines.append({"title": name, "editorial": ed, "steps": members})

    # product groups (finish/family siblings within a category)
    groups = []
    for cat in ["Foundation","Lipstick","Blush","Concealer","Serum & Treatment"]:
        items = [p for p in by_cat.get(cat, []) if p.get("shade_count",0) > 1][:4] or by_cat.get(cat, [])[:4]
        if len(items) >= 2:
            groups.append({"name": f"The {cat} Family", "axis": "finish/shade",
                           "members": [{"product": p["src_handle"], "label": polish_title(p["display_title"], cat)} for p in items]})

    json.dump(descs, open(f"{OUT}/descriptions.json","w"), indent=1)
    json.dump(fqs, open(f"{OUT}/faqs.json","w"), indent=1)
    json.dump(ap, open(f"{OUT}/aplus.json","w"), indent=1)
    json.dump(routines, open(f"{OUT}/routines.json","w"), indent=1)
    json.dump(groups, open(f"{OUT}/product_groups.json","w"), indent=1)

    print(f"descriptions: {len(descs)} (MAREN voice, residual proprietary names fixed)")
    print(f"FAQs: {sum(len(v) for v in fqs.values())} across {len(fqs)} products")
    print(f"A+ blocks: {sum(len(v) for v in ap.values())} across {len(ap)} hero products")
    print(f"routines: {len(routines)} | product groups: {len(groups)}")
    print("\nsample title/desc:")
    for h in list(descs)[:3]:
        print(f"  {descs[h]['title']!r}\n    {descs[h]['description']}")

if __name__ == "__main__":
    main()
