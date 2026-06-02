# MAREN data-layer schema

Built once to serve all 8 Kits. `source` column: **crawl** (have it), **synth** (we generate), **authored** (LLM/house-brand).

## Product metafields

| namespace.key | type | module / kit | source |
|---|---|---|---|
| `spec.finish` | enum (matte/satin/dewy/radiant/natural) | Discovery facets, Similar | authored |
| `spec.coverage` | enum (sheer/medium/full/buildable) | Discovery facets, A+ | authored |
| `spec.skin_type` | list.single_line (dry/oily/combo/sensitive/all) | Discovery facets, FAQs | authored |
| `spec.concern` | list.single_line (dark-circles/redness/dullness/texture…) | Discovery facets, Similar | authored |
| `spec.shade_family` | enum (fair/light/medium/tan/deep + undertone) | Product Groups, facets | crawl+authored |
| `spec.ingredients_key` | list.single_line | A+ ingredient callouts, FAQs, facets | crawl(PDP)+authored |
| `spec.attributes` | json (spec table) | Marketplace Sync, A+ comparison | crawl+synth |
| `spec.source` | enum (brand/marketplace) | Marketplace Sync provenance | synth |
| `seo.title` / `seo.description` | single_line / multi_line | Brand Enrichment, Organic | authored |
| `seo.tags` | list.single_line | Organic, feed | authored |
| `reviews.rating` | number_decimal | Reviews, badges | synth |
| `reviews.count` | integer | Reviews, FOMO | synth |
| `reviews.distribution` | json (5→1 star counts) | Reviews | synth |
| `reviews.sentiment_themes` | json (top_likes[], top_dislikes[], quotes[]) | Reviews (theme extraction) | synth |
| `merch.margin` | number_decimal | Similar (Margin mode) | synth |
| `merch.sellthrough` | number_decimal | Similar, FOMO | synth |
| `merch.is_new` | boolean | Similar (New Arrivals), badges | synth |
| `merch.is_clearance` | boolean | Similar (Clearance), badges | synth |
| `merch.units_sold_30d` | integer | FOMO velocity | synth |
| `merch.live_viewers_base` | integer | FOMO live count | synth |
| `merch.fbt` | json ({strategy, product_gids[]}) | Frequently Bought Together | synth |
| `merch.upsell` | list.product_reference | Monetisation cart upsell | synth |
| `merch.price_history` | json ([{date, price}]) | Watchlist price-drop | synth |
| `inv.on_hand` | integer | FOMO low-stock, reorder | synth |
| `inv.tier` | enum (healthy/low/critical) | FOMO multi-tier | synth |
| `feed.google_category` | single_line | Paid feed | authored |
| `feed.gtin` | single_line | Paid feed | synth |
| `content.faqs` | list.metaobject_reference → faq | FAQs | authored/synth |
| `content.aplus` | list.metaobject_reference → aplus_block | A+ Content | authored |
| `content.reviews` | list.metaobject_reference → review | Reviews | synth |
| `content.videos` | list.metaobject_reference → video | Shoppable Video | synth(stub) |
| `content.looks` | list.metaobject_reference → look | Shop the Look / Routine | authored |
| `merch.product_group` | metaobject_reference → product_group | Product Groups | crawl+authored |
| `gallery.layout` | enum (A/B/C) | Gallery | authored |

## Metaobjects

| type | key fields | module |
|---|---|---|
| `media_asset` | image(file), tag(lifestyle/detail/ugc/comparison), shade_match, sort | Gallery (per-variant, filterable) |
| `faq` | question, answer, category(enum 8) | FAQs |
| `review` | author, rating, title, body, media, sentiment, verified, date, variant | Reviews |
| `aplus_block` | type(hero/comparison/ingredient/lifestyle/story), heading, body, image, table_json | A+ Content |
| `video` | source(ig/tiktok/yt/upload), url/file, poster, hotspots(json [{t,product,x,y}]) | Shoppable Video |
| `video_rule` | match(page/device/cart/utm), video_ref | Shoppable Video display rules |
| `look` (routine) | title, hero_product, steps([{product, annotation}]), image, hotspots, editorial | Shop the Look / Routine |
| `bundle` | type(quantity/mixed/builder), products[], discount_pct, copy, segment | Volume Bundles |
| `product_group` | name, axis(shade/scent/size/style), members([{product, swatch, label}]) | Product Groups |
| `fomo_rule` | metric(stock/velocity/viewers), tiers([{min,max,message,urgency}]), segment | FOMO |
| `synonym` | term, synonyms[] | Discovery/Search |
| `loyalty_tier` | name, threshold, perks[] | Retention |

## Collections (Discovery / Merchandising / Collection-gen)
- Category (rule: product.category) · Concern · Skin type · Finish · Shade family
- Merch sets: New, Best sellers, Clearance, Bundles, The Edit (editorial)
- Each carries `collection.sort_default` + `collection.merch_rules` (json) for merchandising kit.

## Store-level (later kits)
- `llms.txt`, structured-data (Product/Review/FAQ schema auto from above), blog/editorial pages (Organic)
- Synthetic customers + orders (Retention, FBT co-purchase basis, CRO analytics), gift cards
- Discounts (auto-apply bundles, volume) (Monetisation)

## Out of scope
- Virtual Try-On (Mod 16): apparel/footwear only — N/A for beauty.
