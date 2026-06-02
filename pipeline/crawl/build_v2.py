#!/usr/bin/env python3
"""v2 build: 9 brands -> de-branded, 2-level category taxonomy, balanced ~250.
Output: data/catalog_v2.json with top + sub category, de-branded title/desc,
options/variants, images, price, shade_count."""
import json, os, glob, re, html
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, "..", "data")
BRAND_DEFAULT_TOP = {"kosas":"Makeup","ilia":"Makeup","saie":"Makeup","tower28":"Makeup","westman":"Makeup",
                     "inkey":"Skincare","necessaire":"Body","ouai":"Hair","phlur":"Fragrance"}
BRAND_TOKENS = ["kosas","ilia","saie","tower 28","tower28","tower-28","westman atelier","westman-atelier","westman",
                "the inkey list","inkey list","inkey","necessaire","nécessaire","the ouai","ouai","phlur"]

JUNK = re.compile(r"gift card|e-gift|\bsample\b|\d+\s?ml sample|travel size|\bmini\b|merch|tote|sticker|\btee\b|"
                  r"detergent|supplement|candle|\bobjects?\b|swatch|test kit|wardrobe", re.I)
SETLIKE = re.compile(r"\b(set|kit|bundle|duo|trio|collection|edit|pack|favorites|favourites|system|routine|regimen)\b", re.I)

# (sub, top, pattern) — first match wins; ordered specific -> general
RULES = [
 # makeup (unambiguous)
 ("Foundation","Makeup", r"foundation|skin tint|complexion stick|bb cream|cc cream|tinted serum"),
 ("Concealer","Makeup", r"concealer|corrector"),
 ("Setting Spray","Makeup", r"setting spray|setting mist|makeup setting"),
 ("Powder","Makeup", r"setting powder|finishing powder|pressed powder|loose powder|blot"),
 ("Primer","Makeup", r"primer|makeup base|face base|grip"),
 ("Blush","Makeup", r"blush"),
 ("Bronzer","Makeup", r"bronzer|bronz"),
 ("Contour","Makeup", r"contour|sculpt stick"),
 ("Highlighter","Makeup", r"highlight|illuminiz|luminiz"),
 ("Lipstick","Makeup", r"lipstick|lip color|lip colour|matte lip|lip suede"),
 ("Lip Liner","Makeup", r"lip liner|lip pencil|lip shape"),
 ("Lip Gloss & Oil","Makeup", r"lip gloss|lip oil|lip jelly|lip plump|lip balm|lip treatment|lip mask|lip glaze"),
 ("Mascara","Makeup", r"mascara|lash lift|lash"),
 ("Eyeliner","Makeup", r"eyeliner|eye liner|kohl|kajal|liner pen"),
 ("Brow","Makeup", r"brow"),
 ("Eyeshadow","Makeup", r"eyeshadow|eye shadow|eye paint|shadow stick|cream shadow"),
 # hair
 ("Shampoo","Hair", r"shampoo"),
 ("Conditioner","Hair", r"conditioner|detangler"),
 ("Hair Treatment","Hair", r"hair mask|hair treatment|hair oil|hair serum|scalp|leave.?in|bond"),
 ("Styling","Hair", r"styling|texturiz|texturis|hair spray|wave spray|mousse|finishing|heat protect|dry shampoo|gel"),
 # fragrance
 ("Eau de Parfum","Fragrance", r"eau de parfum|parfum|perfume|cologne|\bedp\b|fragrance(?! mist)"),
 ("Body Mist","Fragrance", r"body mist|hair.*mist|fragrance mist|scent mist"),
 # body
 ("Body Wash","Body", r"body wash|shower gel|shower oil|cleansing gel"),
 ("Body Lotion","Body", r"body lotion|body cream|body butter|body oil|body serum|body milk"),
 ("Body Scrub","Body", r"body scrub|body exfoliant|body polish|salt scrub|sugar scrub"),
 ("Hand Care","Body", r"hand cream|hand wash|hand lotion|hand balm|hand serum"),
 ("Deodorant","Body", r"deodorant|\bdeo\b"),
 # skincare
 ("Cleanser","Skincare", r"cleanser|cleansing|face wash|micellar|makeup remover|oat balm"),
 ("Exfoliant","Skincare", r"exfoliat|\bpeel\b|\baha\b|\bbha\b|\bpha\b|glycolic|salicylic|lactic"),
 ("Eye Care","Skincare", r"eye cream|eye serum|under.?eye|caffeine eye|eye balm"),
 ("Serum","Skincare", r"serum|booster|ampoule|hyaluronic|niacinamide|vitamin c|retinol|peptide|essence|polyglutamic|squalane oil|face oil"),
 ("Mask","Skincare", r"face mask|overnight mask|clay mask|sleeping mask"),
 ("Moisturizer","Skincare", r"moisturiz|moisturis|face cream|gel cream|day cream|night cream|hydrator|barrier"),
 ("SPF & Sun","Skincare", r"spf|sunscreen|\bsun \b|uv "),
 ("Toner & Mist","Skincare", r"toner|face mist|facial mist|prep mist|essence water"),
 # tools
 ("Tools","Tools", r"brush|sponge|applicator|blender|tool|mirror|case|pouch|bag|curler"),
]

def strip_html(s):
    if not s: return ""
    return re.sub(r"\s{2,}"," ",html.unescape(re.sub(r"<[^>]+>"," ",s))).strip()

def debrand(t):
    if not t: return t
    for tok in BRAND_TOKENS: t = re.sub(re.escape(tok),"",t,flags=re.I)
    t = t.replace("®","").replace("™","")
    return re.sub(r"\s{2,}"," ",t).strip(" -–—|:")

def categorize(p):
    hay=(p.get("product_type","")+" "+p.get("title","")).lower()
    for sub,top,pat in RULES:
        if re.search(pat,hay): return top,sub
    top=BRAND_DEFAULT_TOP.get(p["_brand"],"Makeup")
    return top, {"Makeup":"Other Makeup","Skincare":"Treatment","Body":"Body Care","Hair":"Hair Care","Fragrance":"Eau de Parfum"}[top]

def price_of(p):
    for v in p.get("variants",[]):
        try: return round(float(v.get("price") or 0),2)
        except: pass
    return 0.0

def main():
    allp=[]
    for f in glob.glob(os.path.join(HERE,"raw","*.json")):
        slug=os.path.basename(f)[:-5]
        for p in json.load(open(f)): p["_brand"]=slug; allp.append(p)
    cands=[]
    for p in allp:
        t=p.get("title",""); pt=p.get("product_type","")
        if JUNK.search(t+" "+pt) or SETLIKE.search(t): continue
        if not p.get("images"): continue
        if price_of(p) <= 0: continue
        top,sub=categorize(p)
        p["_top"],p["_sub"]=top,sub
        cands.append(p)

    # dedupe cross-brand by normalized debranded title
    seen={}
    for p in cands:
        key=re.sub(r"\s{2,}"," ",debrand(p["title"]).lower()).strip()
        sc=min(len(p.get("images",[])),8)+ (3 if len(strip_html(p.get("body_html")))>=120 else 0)
        if key not in seen or sc>seen[key][0]: seen[key]=(sc,p)
    uniq=[v[1] for v in seen.values()]

    # balance: per-top targets, round-robin across subs+brands
    TARGET={"Makeup":85,"Skincare":62,"Body":40,"Hair":30,"Fragrance":25,"Tools":8}
    by_top=defaultdict(list)
    for p in uniq: by_top[p["_top"]].append(p)
    def score(p): return min(len(p.get("images",[])),8)+(4 if any(o.get("name","").lower() in ("shade","color") for o in p.get("options",[])) else 0)+(3 if len(strip_html(p.get("body_html")))>=120 else 0)
    curated=[]
    for top,items in by_top.items():
        items.sort(key=score,reverse=True)
        # interleave by brand for variety
        bybrand=defaultdict(list)
        for p in items: bybrand[p["_brand"]].append(p)
        order=sorted(bybrand,key=lambda b:-len(bybrand[b]))
        idx={b:0 for b in order}; picked=[]
        tgt=TARGET.get(top,20)
        while len(picked)<tgt and any(idx[b]<len(bybrand[b]) for b in order):
            for b in order:
                if len(picked)>=tgt: break
                if idx[b]<len(bybrand[b]): picked.append(bybrand[b][idx[b]]); idx[b]+=1
        curated+=picked

    out=[]
    for p in curated:
        opts=[{"name":o.get("name"),"values":o.get("values",[])} for o in p.get("options",[])]
        variants=[{"sku":v.get("sku"),"price":v.get("price"),"available":v.get("available"),
                   "option_values":[v.get("option1"),v.get("option2"),v.get("option3")]} for v in p.get("variants",[])]
        out.append({"src_brand":p["_brand"],"src_handle":p.get("handle"),"top":p["_top"],"sub":p["_sub"],
            "title":debrand(p.get("title")),"description":debrand(strip_html(p.get("body_html"))),
            "options":opts,"variants":variants,"images":[i.get("src") for i in p.get("images",[])],
            "price":price_of(p),
            "shade_count":len(next((o["values"] for o in opts if o["name"] and o["name"].lower() in ("shade","color")),[]))})
    json.dump(out,open(os.path.join(DATA,"catalog_v2.json"),"w"),indent=1)

    print(f"TOTAL curated: {len(out)}")
    print("by TOP:", dict(Counter(p["top"] for p in out)))
    print("by BRAND:", dict(Counter(p["src_brand"] for p in out)))
    print("\nsubcategories per top:")
    tops=defaultdict(Counter)
    for p in out: tops[p["top"]][p["sub"]]+=1
    for top in ["Makeup","Skincare","Body","Hair","Fragrance","Tools"]:
        print(f"  {top}: {dict(tops[top])}")

if __name__=="__main__":
    main()
