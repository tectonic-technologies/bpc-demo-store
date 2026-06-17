# Spectrum Horizon — Agent Guide

Horizon + a Spectrum layer applied by `@spectrum/theme-skeleton`. **This theme is
generated.** It is regenerated from pristine Horizon every run; hand-edits to
generated files do not survive.

## Canonical theme — per-brand usage

This repo is **Spectrum's canonical Horizon theme**, not a single store's theme.
To use it for a brand:

1. Fork it to a brand-specific repo named `<brandslug>-via-spectrum`
   (e.g. `acme-via-spectrum`).
2. Connect that fork to the brand's Shopify store via **Shopify admin → Online
   Store → Themes → Add theme → Connect from GitHub**, pointing at the fork.

The brand's store tracks its `<brandslug>-via-spectrum` fork; this canonical
theme stays the upstream the fork is regenerated from.

## Do not edit

- `templates/*.spectrum.json` — Spectrum alternate templates (resource pages).
- `sections/spectrum-*.liquid`, `blocks/spectrum-*.liquid` — generated slot wrappers.
- `sections/*-spectrum.liquid` — forked vendor sections (e.g. the PDP fork).
- Edits to `sections/header.liquid` / `*-group.json` made by the engine.

Change the generator (`packages/theme-skeleton`) or snippet catalog
(`packages/snippet-library`) in the Spectrum monorepo, then regenerate.

## Layout

- **Resource pages** → alternate `<type>.spectrum.json`; Horizon defaults pristine.
  Preview with `?view=spectrum`; go live via `template_suffix`.
- **Fixed routes / section groups** → edited in place (no alternate possible).
- **Slots** → one section (or nested PDP block) per Spectrum feature; most are
  empty placeholders listing snippet options for a developer to wire in Studio.
- **PDP** → `product-information.liquid` is forked to
  `product-information-spectrum.liquid`; the base stays pristine.

## Runtime

`window.Spectrum` SDK + runtime artifacts come from the **Spectrum app embed**,
not this theme. Wired features need the embed enabled.
