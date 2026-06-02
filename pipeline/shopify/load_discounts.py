#!/usr/bin/env python3
"""Create a varied set of discounts across collections + types:
automatic % off, code % off, BXGY, free shipping, sitewide code, clearance."""
import datetime as dt
from client import Shopify

NOW = dt.datetime(2026, 6, 2).strftime("%Y-%m-%dT00:00:00Z")

AUTO_BASIC = """mutation($d:DiscountAutomaticBasicInput!){discountAutomaticBasicCreate(automaticBasicDiscount:$d){userErrors{field message}}}"""
CODE_BASIC = """mutation($d:DiscountCodeBasicInput!){discountCodeBasicCreate(basicCodeDiscount:$d){userErrors{field message}}}"""
AUTO_BXGY = """mutation($d:DiscountAutomaticBxgyInput!){discountAutomaticBxgyCreate(automaticBxgyDiscount:$d){userErrors{field message}}}"""
CODE_SHIP = """mutation($d:DiscountCodeFreeShippingInput!){discountCodeFreeShippingCreate(freeShippingCodeDiscount:$d){userErrors{field message}}}"""

def main():
    s = Shopify()
    g = {c["handle"]: c["id"] for c in s.gql('{collections(first:80){nodes{id handle}}}')["collections"]["nodes"]}
    def coll(h): return g.get(h)

    def run(name, q, d):
        key = list(q.split("($d:")[0].split()[-1])  # noop
        r = s.gql(q, {"d": d})
        ue = list(r.values())[0].get("userErrors")
        print(f"  {'OK ' if not ue else 'ERR'} {name}" + (f" -> {ue}" if ue else ""))

    # 1. Sitewide welcome code, 15% off everything, once per customer
    run("CODE WELCOME15 (15% off all)", CODE_BASIC, {
        "title": "Welcome 15", "code": "WELCOME15", "startsAt": NOW,
        "customerSelection": {"all": True},
        "customerGets": {"value": {"percentage": 0.15}, "items": {"all": True}},
        "appliesOncePerCustomer": True})

    # 2. Automatic 20% off Skincare
    run("AUTO 20% off Skincare", AUTO_BASIC, {
        "title": "Skincare Edit - 20% Off", "startsAt": NOW,
        "customerGets": {"value": {"percentage": 0.20}, "items": {"collections": {"add": [coll("skincare")]}}}})

    # 3. Automatic 25% off Last Chance (clearance)
    run("AUTO 25% off Last Chance", AUTO_BASIC, {
        "title": "Last Chance - 25% Off", "startsAt": NOW,
        "customerGets": {"value": {"percentage": 0.25}, "items": {"collections": {"add": [coll("clearance")]}}}})

    # 4. Code 25% off Body
    run("CODE BODY25 (25% off Body)", CODE_BASIC, {
        "title": "Body 25", "code": "BODY25", "startsAt": NOW,
        "customerSelection": {"all": True},
        "customerGets": {"value": {"percentage": 0.25}, "items": {"collections": {"add": [coll("body")]}}}})

    # 5. Automatic BXGY: buy 2 lipsticks, get 1 free
    run("AUTO BXGY lipstick buy2get1", AUTO_BXGY, {
        "title": "Lipstick - Buy 2 Get 1 Free", "startsAt": NOW,
        "customerBuys": {"items": {"collections": {"add": [coll("lipstick")]}}, "value": {"quantity": "2"}},
        "customerGets": {"items": {"collections": {"add": [coll("lipstick")]}},
                         "value": {"discountOnQuantity": {"quantity": "1", "effect": {"percentage": 1.0}}}}})

    # 6. Free shipping code over 40
    run("CODE FREESHIP (free ship over 40)", CODE_SHIP, {
        "title": "Free Shipping over 40", "code": "FREESHIP", "startsAt": NOW,
        "customerSelection": {"all": True},
        "minimumRequirement": {"subtotal": {"greaterThanOrEqualToSubtotal": "40.0"}},
        "destination": {"all": True}})

    # 7. Automatic 10% off New
    run("AUTO 10% off New", AUTO_BASIC, {
        "title": "New In - 10% Off", "startsAt": NOW,
        "customerGets": {"value": {"percentage": 0.10}, "items": {"collections": {"add": [coll("new")]}}}})

if __name__ == "__main__":
    main()
