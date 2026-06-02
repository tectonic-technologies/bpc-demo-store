#!/usr/bin/env python3
"""Build the 2-level category tree in-store (run AFTER products load):
top collections (by cat:<top> tag, with distinct card images) + sub collections
(by productType) + best-sellers/new/clearance/sensitive + nested main-menu nav."""
import json, os, re, time
from collections import defaultdict, OrderedDict
from client import Shopify

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
CAT = json.load(open(os.path.join(D, "catalog_clean.json")))
ENR = json.load(open(os.path.join(D, "enriched.json")))
PID = "gid://shopify/Publication/186881769650"
TOP_ORDER = ["Makeup", "Skincare", "Body", "Hair", "Fragrance", "Tools"]

def slug(x): return re.sub(r"[^a-z0-9]+", "-", x.lower()).strip("-")

# subs present per top (ordered by frequency)
subs_by_top = defaultdict(lambda: defaultdict(int))
for p in CAT: subs_by_top[p["top"]][p["category"]] += 1
# representative image per top (product with most images)
rep_img = {}
for e in ENR:
    t = e.get("top"); imgs = e.get("images") or []
    if t and imgs and len(imgs) > len(rep_img.get(t, ("", []))[1] if t in rep_img else []):
        rep_img[t] = (imgs[0], imgs)
rep_img = {t: v[0] for t, v in rep_img.items()}

CREATE = """mutation($i:CollectionInput!){collectionCreate(input:$i){collection{id handle title} userErrors{field message}}}"""
PUB = """mutation($id:ID!,$pid:ID!){publishablePublish(id:$id,input:{publicationId:$pid}){userErrors{message}}}"""

def make(s, title, handle, rules, image=None):
    inp = {"title": title, "handle": handle,
           "ruleSet": {"appliedDisjunctively": False, "rules": rules}}
    if image: inp["image"] = {"src": image}
    r = s.gql(CREATE, {"i": inp})["collectionCreate"]
    if r.get("userErrors"):
        print(f"  ERR {handle}: {r['userErrors'][:1]}"); return None
    cid = r["collection"]["id"]
    s.gql(PUB, {"id": cid, "pid": PID})
    return cid

def main():
    s = Shopify()
    gid = {}  # handle -> collection gid
    # top collections
    for top in TOP_ORDER:
        if top not in subs_by_top: continue
        h = slug(top)
        cid = make(s, top, h, [{"column": "TAG", "relation": "EQUALS", "condition": f"cat:{slug(top)}"}], rep_img.get(top))
        if cid: gid[h] = cid
        time.sleep(0.3)
    # sub collections
    for top in TOP_ORDER:
        for sub in sorted(subs_by_top.get(top, {}), key=lambda x: -subs_by_top[top][x]):
            h = slug(sub)
            if h in gid: continue
            cid = make(s, sub, h, [{"column": "TYPE", "relation": "EQUALS", "condition": sub}])
            if cid: gid[h] = cid
            time.sleep(0.25)
    # merch collections
    for title, h, tag in [("Best Sellers","best-sellers","best-seller"),("New","new","new"),
                          ("Last Chance","clearance","clearance"),("For Sensitive Skin","sensitive-skin","sensitive")]:
        cid = make(s, title, h, [{"column":"TAG","relation":"EQUALS","condition":tag}])
        if cid: gid[h] = cid
        time.sleep(0.25)
    print("collections created:", len(gid))

    # nested main-menu nav
    menus = s.gql('{menus(first:10){nodes{id handle title}}}')["menus"]["nodes"]
    main_menu = next((m for m in menus if m["handle"] == "main-menu"), None)
    items = []
    for top in TOP_ORDER:
        h = slug(top)
        if h not in gid: continue
        children = [{"title": sub, "type": "COLLECTION", "resourceId": gid[slug(sub)]}
                    for sub in sorted(subs_by_top[top], key=lambda x: -subs_by_top[top][x]) if slug(sub) in gid]
        items.append({"title": top, "type": "COLLECTION", "resourceId": gid[h], "items": children})
    for title, h in [("Best Sellers","best-sellers"),("New","new")]:
        if h in gid: items.append({"title": title, "type": "COLLECTION", "resourceId": gid[h]})
    UP = """mutation($id:ID!,$t:String!,$h:String!,$items:[MenuItemUpdateInput!]!){menuUpdate(id:$id,title:$t,handle:$h,items:$items){menu{items{title items{title}}} userErrors{message}}}"""
    r = s.gql(UP, {"id": main_menu["id"], "t": main_menu["title"], "h": "main-menu", "items": items})["menuUpdate"]
    print("nav errors:", r.get("userErrors"))
    for it in (r.get("menu") or {}).get("items", []):
        print(f"  {it['title']}  ->  {[c['title'] for c in it.get('items',[])]}")

if __name__ == "__main__":
    main()
