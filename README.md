# Spectrum Horizon

This is Shopify's **Horizon** theme with a **Spectrum** layer applied by the
`@spectrum/theme-skeleton` engine. It is regenerated from pristine Horizon on
every run — **do not hand-edit generated `spectrum-*` files or `*.spectrum.json`
templates; they are overwritten on the next regen.**

## What the Spectrum layer adds

Spectrum features are installed as native Shopify primitives — no app blocks.

- **Resource pages** (product, collection, page, blog, article) ship as
  **alternate templates** (`templates/<type>.spectrum.json`). Horizon's default
  templates stay byte-pristine.
- **Fixed routes** (index, search, cart, 404) and the **header/footer section
  groups** are edited in place — Shopify has no alternate-template mechanism for
  them.
- **Header search** is replaced by the Spectrum search drawer (rendered inside
  `sections/header.liquid`); the **search results page** renders the Spectrum
  results section.
- Each Spectrum feature is a **slot**: one editor-placeable section (or, for PDP
  adornments, a nested block) that a developer fills with one snippet option.
  Most slots ship as empty placeholders — pick and wire them in Studio.

## Previewing Spectrum vs Horizon

Resource alternates render side-by-side with the pristine default via the
`?view=` URL parameter — customers keep seeing Horizon at the normal URL:

```
/products/<handle>              → Horizon default (pristine)
/products/<handle>?view=spectrum → Spectrum alternate
/collections/<handle>?view=spectrum
/pages/<handle>?view=spectrum
```

To make Spectrum the live template for a resource, set its
`template_suffix` to `spectrum` (Shopify admin / bulk metafield).

## Runtime

The Spectrum storefront SDK and runtime artifacts (`window.Spectrum`, design
tokens, the visibility gate) are provisioned by the **Spectrum app embed** when a
brand connects — they are not bundled in this theme. Wired features (search) need
the app embed enabled to function.

---

## Upstream theme

The original vendor README follows, preserved verbatim.

# MAREN — Shopify demo store

Internal Spectrum demo store for showcasing the PDP Optimisation Kit (and later Kits)
on a cohesive beauty / personal-care catalog. House brand: **MAREN** (quiet-luxury,
skin-first). Catalog is a de-branded blend of clean prestige beauty.

## Repo layout

```
/ (root)            Shopify theme files (Ritual) live here once the store theme
                    is connected via the Shopify <> GitHub integration.
                    config/ layout/ sections/ snippets/ templates/ assets/ locales/ blocks/
pipeline/           The data build (not part of the theme; Shopify ignores it)
  crawl/            Crawl + normalize + de-brand + clean scripts
  data/             Curated catalog, schema, reports
  brand/            MAREN brand + voice spec
```

## Shopify connection
- Install the **Ritual** theme on the dev store.
- Connect that theme to this repo (`anupam-tectonic/bpc-demo-store`) on the **`main`** branch (Shopify GitHub integration).
- Shopify commits the theme files to the repo root; edits sync both ways.
- The `pipeline/` folder is plain tooling and does not interfere with the theme.

## Data build status
- `pipeline/data/catalog_clean.json` — 213 curated, de-branded products (canonical)
- `pipeline/data/schema.md` — metafield + metaobject schema for all 16 PDP modules + 8-Kit foundations
- `pipeline/brand/maren.md` — house-brand identity + voice + content rules

Next: synthetic behavioral data, collections/facets/taxonomy, then load into the store via Admin API.

## Reproduce the catalog
```
python3 pipeline/crawl/crawl.py        # fetch raw (gitignored)
python3 pipeline/crawl/normalize.py    # de-brand + curate
python3 pipeline/crawl/rewrite_names.py
python3 pipeline/crawl/clean.py        # dedupe + recategorize -> catalog_clean.json
```
