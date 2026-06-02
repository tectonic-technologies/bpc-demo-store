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
