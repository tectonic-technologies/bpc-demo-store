#!/usr/bin/env python3
"""Associate each shade/color variant with its own image so the PDP swaps the
photo on variant select. Source variant->image comes from the raw crawl; we add
the per-shade images as product media (alt=shade) then bind variant.mediaId."""
import json, os, glob, re, time
from client import Shopify

HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(HERE, "..", "data")
CAT = json.load(open(os.path.join(D, "catalog_clean.json")))
DESC = json.load(open(os.path.join(D, "content/descriptions.json")))

# src_handle -> {shade_value: image_src}
shade_img = {}
for f in glob.glob(os.path.join(HERE, "..", "crawl", "raw", "*.json")):
    for p in json.load(open(f)):
        opts = p.get("options", [])
        pos = next((o["position"] for o in opts if (o.get("name") or "").lower() in ("shade", "color", "colour")), None)
        if not pos: continue
        m = {}
        for v in p.get("variants", []):
            val = v.get(f"option{pos}")
            fi = v.get("featured_image") or {}
            if val and fi.get("src"): m[val] = fi["src"]
        if len(m) >= 2: shade_img[p.get("handle")] = m

title2src = {}
for p in CAT:
    t = (DESC.get(p["src_handle"]) or {}).get("title") or p["display_title"]
    title2src[t] = p["src_handle"]

ADDMEDIA = """mutation($pid:ID!,$m:[CreateMediaInput!]!){productCreateMedia(productId:$pid,media:$m){media{... on MediaImage{id alt}} mediaUserErrors{message}}}"""
BULK = """mutation($pid:ID!,$v:[ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$pid,variants:$v){userErrors{message}}}"""

def main():
    s = Shopify()
    prods, cur = [], None
    while True:
        d = s.gql('query($c:String){products(first:50,after:$c){pageInfo{hasNextPage endCursor} nodes{id title options{name} variants(first:100){nodes{id selectedOptions{name value}}}}}}', {"c": cur})["products"]
        prods += d["nodes"]
        if not d["pageInfo"]["hasNextPage"]: break
        cur = d["pageInfo"]["endCursor"]

    done = skipped = 0
    for p in prods:
        src = title2src.get(p["title"])
        smap = shade_img.get(src) if src else None
        if not smap: skipped += 1; continue
        opt = next((o["name"] for o in p["options"] if o["name"].lower() in ("shade","color","colour")), None)
        if not opt: skipped += 1; continue
        # unique shade values present on store variants that have a source image
        needed = {}
        for v in p["variants"]["nodes"]:
            val = next((so["value"] for so in v["selectedOptions"] if so["name"] == opt), None)
            if val and val in smap: needed[val] = smap[val]
        if not needed: skipped += 1; continue
        # add media (alt = shade value)
        media = [{"originalSource": src_url, "alt": val, "mediaContentType": "IMAGE"} for val, src_url in needed.items()]
        alt2mid = {}
        for i in range(0, len(media), 10):
            r = s.gql(ADDMEDIA, {"pid": p["id"], "m": media[i:i+10]})["productCreateMedia"]
            for mn in r.get("media", []):
                if mn and mn.get("alt"): alt2mid[mn["alt"]] = mn["id"]
            time.sleep(0.4)
        # bind variants
        vupd = []
        for v in p["variants"]["nodes"]:
            val = next((so["value"] for so in v["selectedOptions"] if so["name"] == opt), None)
            if val in alt2mid: vupd.append({"id": v["id"], "mediaId": alt2mid[val]})
        if vupd:
            for i in range(0, len(vupd), 100):
                s.gql(BULK, {"pid": p["id"], "v": vupd[i:i+100]})
            done += 1
            if done % 10 == 0: print(f"  bound {done} products...")
        time.sleep(0.4)
    print(f"\nvariant images bound on {done} products (skipped {skipped})")

if __name__ == "__main__":
    main()
