/**
 * PDP Similar Products snippet-author runtime.
 *
 * Responsibilities:
 *   1. Recommendations load on first paint — reads the SSR'd handle list
 *      emitted by the Liquid from `spectrum.recommendations_similar_products_live`,
 *      then fetches each handle's full product JSON via
 *      `Spectrum.products.getByHandle(handle)` in parallel. The same payload
 *      powers both the grid cards and the Mini-PDP modal; per-handle 404s
 *      (stale handles since the playbook last ran) are dropped silently.
 *   2. Card hydration — for each resolved product, the `<template>` element
 *      emitted by the Liquid is cloned, populated, and substituted in place
 *      of one of the SSR'd skeletons in the grid. Leftover skeletons (when
 *      the metafield carries fewer handles than requested, or some failed
 *      to resolve) are removed and the carousel indicator is reconciled
 *      with the actual product count.
 *   3. Fail-closed visibility flip — when the metafield is missing, the
 *      default entry has no handles, or every per-handle fetch fails, the
 *      outer `[data-spectrum-lq-snippet]` wrapper is switched to
 *      `data-spectrum-vis="off"` so the snippet collapses silently rather
 *      than rendering an empty grid.
 *   4. Variant-resolution binding — `applyVariant` patches the cheap fields
 *      (heading text, description, alignment class, cards-per-row CSS var)
 *      every time the runtime SDK fires `$spectrum:variant_resolved`.
 *   5. Page-level carousel + per-card image carousel + Mini-PDP modal +
 *      ATC + Buy Now wiring. Single-variant ATC adds instantly; multi-variant
 *      opens the dialog. The Mini-PDP reads from the same recommendations
 *      payload stashed on each card element via `cardEl.__saiPayload`.
 *
 * Container-scoped: every DOM read/write goes through `node`; multi-render
 * pages cannot collide.
 */
;(() => {
  const SNIPPET_ID = 'frpxf1zz'
  const FEATURE_SLUG = 'pdp_related_products'
  const ROOT_SELECTOR = `.sai-${SNIPPET_ID}`
  const HEADING_SELECTOR = `.sai-${SNIPPET_ID}__heading`
  const DESCRIPTION_SELECTOR = `.sai-${SNIPPET_ID}__description`
  const LAYOUT_SELECTOR = `.sai-${SNIPPET_ID}__layout`
  const GRID_SELECTOR = `.sai-${SNIPPET_ID}__grid`
  const CARD_SELECTOR = `.sai-${SNIPPET_ID}__card`
  const SKELETON_SELECTOR = `.sai-${SNIPPET_ID}__card--skeleton`
  const CONFIG_SELECTOR = 'script[data-spectrum-sim-config]'
  const RECOMMENDATIONS_SELECTOR = 'script[data-spectrum-sim-recommendations]'
  const CARD_TEMPLATE_SELECTOR = 'template[data-spectrum-sim-card-template]'
  const CAROUSEL_CONTROLS_SELECTOR = '[data-spectrum-carousel-controls]'
  const ARROW_SELECTOR = '[data-spectrum-carousel-arrow]'
  const DOT_SELECTOR = '[data-spectrum-carousel-dot]'
  const DOTS_CONTAINER_SELECTOR = '[data-spectrum-carousel-dots]'
  const THUMB_SELECTOR = '[data-spectrum-carousel-thumb]'
  const STEPPER_SELECTOR = '[data-spectrum-carousel-stepper]'
  const CPR_VAR_M = `--sai-${SNIPPET_ID}-cpr-m`
  const CPR_VAR_T = `--sai-${SNIPPET_ID}-cpr-t`
  const CPR_VAR_D = `--sai-${SNIPPET_ID}-cpr-d`
  const ALIGN_PREFIX = `sai-${SNIPPET_ID}--align-`
  const CPR_MIN = 1
  const CPR_MAX = 6
  const CPR_DEFAULT_M = 2
  const CPR_DEFAULT_T = 3
  const CPR_DEFAULT_D = 4
  const ALIGN_VALUES = new Set(['left', 'center', 'right'])
  // Upper bound on how many recommendations we'll render per snippet
  // instance. Matches meta.json `product_count` max so a stale config or
  // an oversized metafield can't blow up parallel fetch fan-out.
  const RECOMMENDATIONS_LIMIT_MAX = 10
  // Cap on per-card image carousel to match the historical Liquid template
  // (which used `limit: 8` on `product.images`).
  const PRODUCT_IMAGES_CAP = 8
  // Image-rendition widths used in the card srcset. The Shopify CDN supports
  // `?width=NNN` on every storefront product image URL.
  const IMAGE_RENDITION_WIDTHS = [400, 800, 1200]
  // Minimum on-screen time for the ATC/Buy Now spinner so cart writes that
  // resolve in <100ms don't flash the loader imperceptibly before the modal
  // closes / the navigation fires.
  const MIN_SPINNER_MS = 350

  function noopTrack() {}

  // Wrap track so a malformed payload or downstream throw can never break a
  // cart-add / modal-open flow. Telemetry is observational — surface the
  // failure in DevTools but keep the user's action moving.
  function safeTrack(track) {
    return (name, payload) => {
      try {
        track(name, payload)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[${FEATURE_SLUG}] analytics dispatch failed`, name, err)
      }
    }
  }

  // Card-link href is the canonical product URL; derive the handle from the
  // path so analytics doesn't need a separate data attribute on every card.
  // Returns null when the URL is missing or unparseable — null is a valid
  // payload value per the analytics catalog.
  function productHandleFromUrl(url) {
    if (typeof url !== 'string') return null
    const m = url.match(/\/products\/([^/?#]+)/)
    return m?.[1] ? m[1] : null
  }

  // Walk a card to its 0-indexed position within the rendered grid. Used by
  // every event payload so PostHog can correlate cart-adds with where in
  // the list the merchandise was discovered.
  function cardPosition(cardEl) {
    if (!cardEl || !cardEl.parentElement) return null
    const siblings = cardEl.parentElement.querySelectorAll(`:scope > ${CARD_SELECTOR}`)
    for (let i = 0; i < siblings.length; i++) {
      if (siblings[i] === cardEl) return i
    }
    return null
  }

  // ── Recommendations load + card hydration ────────────────────

  // Parse the SSR'd config blob. Returns null when the script is missing
  // or unparseable — both treated as the silent-hide signal upstream.
  function readSimConfig(node) {
    const tag = node.querySelector(CONFIG_SELECTOR)
    if (!tag) return null
    try {
      return JSON.parse(tag.textContent || '{}')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[${FEATURE_SLUG}] failed to parse config`, err)
      return null
    }
  }

  // Read the SSR'd handle list emitted by the Liquid from the default
  // entry of `spectrum.recommendations_similar_products_live`. Always
  // returns an array (empty on missing tag / parse failure / non-array
  // payload) — the empty-list path is handled identically upstream as
  // "metafield said nothing to render", which collapses the snippet.
  function readRecommendationHandles(node) {
    const tag = node.querySelector(RECOMMENDATIONS_SELECTOR)
    if (!tag) return []
    let parsed
    try {
      parsed = JSON.parse(tag.textContent || '[]')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[${FEATURE_SLUG}] failed to parse recommendations`, err)
      return []
    }
    if (!Array.isArray(parsed)) return []
    return parsed.filter((h) => typeof h === 'string' && h.length > 0)
  }

  // Flip the outer `[data-spectrum-lq-snippet]` wrapper to vis=off so the
  // fail-closed CSS gate installed by `_sai-artifacts.liquid` collapses the
  // entire snippet. Falls back to the bound node when the wrapper can't be
  // located so the hide signal still reaches *something*.
  function hideWrapper(node) {
    const wrapper = node.closest('[data-spectrum-lq-snippet]') ?? node
    wrapper.setAttribute('data-spectrum-vis', 'off')
  }

  // Hydrate each handle into a full product object via
  // `Spectrum.products.getByHandle(handle)` (which wraps `/products/{handle}.js`
  // and returns the same shape Shopify's recommendations endpoint did).
  // Fetches run in parallel; per-handle failures (stale handles since the
  // playbook last ran → 404) drop out silently so one rotted entry can't
  // collapse the whole grid. Returns null when nothing resolved.
  async function loadRecommendations(handles, limit) {
    const clamped = Math.min(
      Math.max(1, Number.parseInt(limit, 10) || 1),
      RECOMMENDATIONS_LIMIT_MAX,
    )
    const sliced = handles.slice(0, clamped)
    if (sliced.length === 0) return null
    const sdkProducts = window.Spectrum?.products
    const fetcher =
      sdkProducts && typeof sdkProducts.getByHandle === 'function'
        ? (h) => sdkProducts.getByHandle(h)
        : (h) =>
            fetch(`/products/${encodeURIComponent(h)}.js`, {
              headers: { Accept: 'application/json' },
            }).then((res) => {
              if (!res.ok) throw new Error(`HTTP ${res.status}`)
              return res.json()
            })
    const settled = await Promise.allSettled(sliced.map((h) => fetcher(h)))
    const products = []
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]
      if (result.status === 'fulfilled' && result.value && typeof result.value === 'object') {
        products.push(result.value)
      } else if (result.status === 'rejected') {
        // eslint-disable-next-line no-console
        console.warn(
          `[${FEATURE_SLUG}] product fetch failed for handle "${sliced[i]}"`,
          result.reason,
        )
      }
    }
    return products.length > 0 ? products : null
  }

  // Append `?width=NNN` to a Shopify CDN image URL. Works for URLs with or
  // without an existing query string. Empty input returns empty.
  function transformImageUrl(url, width) {
    if (typeof url !== 'string' || url === '') return ''
    const sep = url.includes('?') ? '&' : '?'
    return `${url}${sep}width=${Math.round(width)}`
  }

  function buildImageSrcset(url) {
    return IMAGE_RENDITION_WIDTHS.map((w) => `${transformImageUrl(url, w)} ${w}w`).join(', ')
  }

  // `/recommendations/products.json` returns prices as integer cents.
  // Liquid's `| money` is locale + shop-currency aware; the closest client
  // equivalent is `Intl.NumberFormat` against the shop's active currency.
  function formatMoney(cents) {
    const numeric = typeof cents === 'number' ? cents : Number.parseFloat(cents)
    if (!Number.isFinite(numeric)) return ''
    const currency = window.Shopify?.currency?.active ?? 'USD'
    try {
      return new Intl.NumberFormat(navigator.language || 'en-US', {
        style: 'currency',
        currency,
      }).format(numeric / 100)
    } catch {
      return `${(numeric / 100).toFixed(2)}`
    }
  }

  function discountPercentFromCents(price, compareAt) {
    const p = Number.parseFloat(price)
    const c = Number.parseFloat(compareAt)
    if (!Number.isFinite(p) || !Number.isFinite(c)) return 0
    if (c <= 0 || c <= p) return 0
    return Math.floor(((c - p) / c) * 100)
  }

  // Find the color option's value list, falling back to "color"/"colour".
  // Newer Shopify product JSON exposes options as `[{ name, values: [...] }]`;
  // older shapes drop straight to `['Color', 'Size']` and we derive values
  // from each variant's `option1` / `option2` / `option3`.
  function findColorOptionValues(product, optionName) {
    if (!product || !Array.isArray(product.options) || product.options.length === 0) return null
    const target = (optionName || 'Color').toLowerCase()
    const optionNameOf = (opt) => (opt?.name ?? (typeof opt === 'string' ? opt : '')).toLowerCase()
    let match = product.options.find((o) => optionNameOf(o) === target)
    if (!match) {
      match = product.options.find((o) => {
        const n = optionNameOf(o)
        return n === 'color' || n === 'colour'
      })
    }
    if (!match) return null
    if (Array.isArray(match.values) && match.values.length > 0) return match.values
    const idx = product.options.indexOf(match)
    if (idx < 0 || !Array.isArray(product.variants)) return null
    const seen = new Set()
    const out = []
    for (const v of product.variants) {
      const val = v[`option${idx + 1}`]
      if (typeof val === 'string' && !seen.has(val)) {
        seen.add(val)
        out.push(val)
      }
    }
    return out.length > 0 ? out : null
  }

  // Normalise a /recommendations/products.json product into the payload
  // shape expected by readPayloadForProduct / initMiniPdp.open(): money
  // values are pre-formatted strings, images are pre-transformed at the
  // gallery width, and the field names match the prior SSR'd `data-spectrum-
  // atc-data` blob so the modal code is unchanged. inventory_quantity is
  // not exposed by the public storefront product JSON so it stays null —
  // the low-inventory callout is intentionally a no-op on this snippet.
  function normaliseProductPayload(product) {
    const images = Array.isArray(product.images)
      ? product.images.slice(0, PRODUCT_IMAGES_CAP).map((u) => transformImageUrl(u, 1200))
      : []
    const variants = Array.isArray(product.variants)
      ? product.variants.map((v) => ({
          id: v.id,
          title: v.title,
          available: v.available !== false,
          price: formatMoney(v.price),
          compareAtPrice: v.compare_at_price != null ? formatMoney(v.compare_at_price) : null,
          inventoryQuantity: null,
        }))
      : []
    return {
      productId: product.id,
      title: product.title ?? '',
      url: product.url ?? '#',
      description: product.description ?? product.body_html ?? '',
      images,
      variants,
    }
  }

  function populateCardImage(cardEl, product, config, isFirstCard) {
    if (config.imageMode === 'carousel') {
      const track = cardEl.querySelector('[data-spectrum-image-track]')
      if (!track) return
      const images = Array.isArray(product.images)
        ? product.images.slice(0, PRODUCT_IMAGES_CAP)
        : []
      if (images.length === 0) return
      for (let i = 0; i < images.length; i++) {
        const slide = document.createElement('div')
        slide.className = `sai-${SNIPPET_ID}__image-slide`
        slide.setAttribute('role', 'group')
        slide.setAttribute('aria-roledescription', 'slide')
        slide.setAttribute('aria-label', `Image ${i + 1} of ${images.length}`)
        const img = document.createElement('img')
        img.className = `sai-${SNIPPET_ID}__image`
        img.src = transformImageUrl(images[i], 800)
        img.srcset = buildImageSrcset(images[i])
        img.sizes = '(min-width: 990px) 25vw, (min-width: 750px) 33vw, 50vw'
        img.alt = product.title ?? ''
        img.style.objectFit = config.imageObjectFit ?? 'cover'
        img.loading = i === 0 ? 'eager' : 'lazy'
        if (isFirstCard && i === 0) img.fetchPriority = 'high'
        slide.appendChild(img)
        track.appendChild(slide)
      }
      if (config.showImageDots && images.length > 1) {
        const dotsContainer = cardEl.querySelector('[data-spectrum-image-dots]')
        if (dotsContainer) {
          for (let i = 0; i < images.length; i++) {
            const dot = document.createElement('button')
            dot.type = 'button'
            dot.className = `sai-${SNIPPET_ID}__image-dot${i === 0 ? ' is-active' : ''}`
            dot.setAttribute('aria-label', `Show image ${i + 1}`)
            dot.setAttribute('data-spectrum-image-dot', String(i))
            if (i === 0) dot.setAttribute('aria-selected', 'true')
            dotsContainer.appendChild(dot)
          }
          dotsContainer.hidden = false
        }
      }
      return
    }
    const img = cardEl.querySelector('[data-sai-image]')
    if (!img) return
    const url = product.featured_image
    if (!url) return
    img.src = transformImageUrl(url, 800)
    img.srcset = buildImageSrcset(url)
    img.sizes = '(min-width: 990px) 25vw, (min-width: 750px) 33vw, 50vw'
    img.alt = product.title ?? ''
    if (isFirstCard) {
      img.loading = 'eager'
      img.fetchPriority = 'high'
    }
    img.hidden = false
  }

  function populateCardSwatches(cardEl, product, config) {
    const container = cardEl.querySelector('[data-sai-swatches]')
    if (!container) return
    const values = findColorOptionValues(product, config.swatchOptionName)
    if (!values || values.length === 0) return
    const caps = config.swatchMaxVisible ?? { mobile: 3, tablet: 3, desktop: 3 }
    const capM = Number.parseInt(caps.mobile, 10) || 3
    const capT = Number.parseInt(caps.tablet, 10) || capM
    const capD = Number.parseInt(caps.desktop, 10) || capT
    const maxVisible = Math.max(capM, capT, capD)
    for (let i = 0; i < Math.min(values.length, maxVisible); i++) {
      const val = values[i]
      const name = typeof val === 'string' ? val : (val?.name ?? '')
      const swatch = document.createElement('span')
      swatch.className = `sai-${SNIPPET_ID}__swatch`
      swatch.setAttribute('role', 'listitem')
      swatch.setAttribute('title', name)
      swatch.setAttribute('aria-label', name)
      // Per-viewport visibility caps — the {% stylesheet %} block hides
      // beyond the cap for each breakpoint via these data attributes.
      if (i + 1 > capM) swatch.setAttribute('data-hide-m', '')
      if (i + 1 > capT) swatch.setAttribute('data-hide-t', '')
      if (i + 1 > capD) swatch.setAttribute('data-hide-d', '')
      // Newer storefront API responses can expose `{ swatch: { color, image } }`
      // on each option value. The public `/recommendations/products.json`
      // endpoint typically omits this — fall through to a neutral chip
      // when absent.
      if (val && typeof val === 'object' && val.swatch) {
        if (val.swatch.color) {
          swatch.style.backgroundColor = val.swatch.color
        } else if (val.swatch.image) {
          const u = transformImageUrl(val.swatch.image, 60)
          swatch.style.backgroundImage = `url(${u})`
          swatch.style.backgroundSize = 'cover'
          swatch.style.backgroundPosition = 'center'
        }
      }
      container.appendChild(swatch)
    }
    const moreByViewport = {
      m: values.length - capM,
      t: values.length - capT,
      d: values.length - capD,
    }
    for (const [k, n] of Object.entries(moreByViewport)) {
      if (n > 0) {
        const chip = document.createElement('span')
        chip.className = `sai-${SNIPPET_ID}__swatch-more sai-${SNIPPET_ID}__swatch-more--${k}`
        chip.setAttribute('aria-hidden', 'true')
        chip.textContent = `+${n}`
        container.appendChild(chip)
      }
    }
    container.hidden = false
  }

  function populateCardPrice(cardEl, product, config) {
    const currentEl = cardEl.querySelector('[data-sai-price-current]')
    const mrpEl = cardEl.querySelector('[data-sai-price-mrp]')
    const discountEl = cardEl.querySelector('[data-sai-price-discount]')
    const price = product.price
    const compareAt = product.compare_at_price
    const onSale = typeof compareAt === 'number' && compareAt > 0 && compareAt > price
    if (currentEl && config.showCurrentPrice) {
      currentEl.textContent = formatMoney(price)
    }
    if (mrpEl && config.showMrp && onSale) {
      mrpEl.textContent = formatMoney(compareAt)
      mrpEl.hidden = false
    }
    if (discountEl && config.showDiscount && onSale) {
      discountEl.textContent = `${discountPercentFromCents(price, compareAt)}% OFF`
      discountEl.hidden = false
    }
  }

  function populateCard(cardEl, product, config, isFirstCard) {
    if (!cardEl || !product) return

    cardEl.__saiPayload = normaliseProductPayload(product)

    const link = cardEl.querySelector('[data-sai-card-link]')
    if (link) link.setAttribute('href', product.url ?? '#')

    const cta = cardEl.querySelector('[data-sai-cta]')
    if (cta) {
      cta.setAttribute('href', product.url ?? '#')
      cta.dataset.productId = String(product.id ?? '')
      cta.dataset.productTitle = product.title ?? ''
      // Sold-out detection — if every variant is unavailable, flip the CTA
      // into a disabled state with the merchant-configured label.
      if (
        Array.isArray(product.variants) &&
        product.variants.length > 0 &&
        product.variants.every((v) => v.available === false)
      ) {
        const soldOutLabel = cta.dataset.soldOutLabel || 'Sold Out'
        cta.textContent = soldOutLabel
        cta.setAttribute('aria-disabled', 'true')
        cta.classList.add('is-soldout')
      }
    }

    const titleEl = cardEl.querySelector('[data-sai-title]')
    if (titleEl) titleEl.textContent = product.title ?? ''

    populateCardImage(cardEl, product, config, isFirstCard)
    if (config.showSwatches) populateCardSwatches(cardEl, product, config)
    populateCardPrice(cardEl, product, config)
  }

  // Reconcile carousel indicator dots / stepper denominator with the actual
  // returned count. Excess dots are removed; missing dots (theoretical —
  // Shopify shouldn't exceed the requested limit) are appended defensively.
  function reconcileCarouselControls(node, count) {
    const controls = node.querySelector(CAROUSEL_CONTROLS_SELECTOR)
    if (!controls) return
    if (count <= 0) {
      controls.hidden = true
      return
    }
    controls.setAttribute('data-card-count', String(count))
    const dotsContainer = controls.querySelector(DOTS_CONTAINER_SELECTOR)
    if (dotsContainer) {
      while (dotsContainer.children.length > count) {
        dotsContainer.lastElementChild?.remove()
      }
      while (dotsContainer.children.length < count) {
        const i = dotsContainer.children.length
        const dot = document.createElement('button')
        dot.type = 'button'
        dot.className = `sai-${SNIPPET_ID}__dot`
        dot.setAttribute('aria-label', `Go to slide ${i + 1}`)
        dot.setAttribute('data-spectrum-carousel-dot', String(i))
        dotsContainer.appendChild(dot)
      }
    }
    const stepper = controls.querySelector(STEPPER_SELECTOR)
    if (stepper) stepper.textContent = `1 / ${count}`
  }

  // Replace each SSR'd skeleton with a populated card clone, in place. When
  // Shopify returns fewer products than requested, the leftover skeletons
  // are removed. Returns the number of populated cards.
  function renderRecommendedProducts(node, products, config) {
    const grid = node.querySelector('[data-spectrum-sim-grid]')
    const template = node.querySelector(CARD_TEMPLATE_SELECTOR)
    if (!grid || !template || !template.content?.firstElementChild) return 0
    const skeletons = Array.from(grid.querySelectorAll('[data-spectrum-sim-skeleton]'))
    for (let i = 0; i < products.length; i++) {
      const clone = template.content.firstElementChild.cloneNode(true)
      populateCard(clone, products[i], config, i === 0)
      if (skeletons[i]) skeletons[i].replaceWith(clone)
      else grid.appendChild(clone)
    }
    for (let i = products.length; i < skeletons.length; i++) {
      skeletons[i].remove()
    }
    reconcileCarouselControls(node, products.length)
    return products.length
  }

  // Clamp a single sub-value. Falls back to the per-viewport default when the
  // input is missing / non-numeric — matches the Liquid cascade in
  // `_sai-snippet-frpxf1zz.liquid` so client variant-swap and SSR agree.
  function clampCpr(value, fallback) {
    const n = typeof value === 'number' ? Math.trunc(value) : Number.parseInt(value, 10)
    if (!Number.isFinite(n)) return fallback
    if (n < CPR_MIN) return CPR_MIN
    if (n > CPR_MAX) return CPR_MAX
    return n
  }

  // Resolve the responsive-number value into three clamped sub-values, with
  // the same mobile-first cascade the Liquid template uses (tablet inherits
  // mobile, desktop inherits tablet). Accepts the structured object plus a
  // legacy plain number for safety against stale data.
  function resolveCardsPerRow(value) {
    if (typeof value === 'number') {
      const n = clampCpr(value, CPR_DEFAULT_M)
      return { mobile: n, tablet: n, desktop: n }
    }
    const obj = value && typeof value === 'object' ? value : {}
    const mobile = clampCpr(obj.mobile, CPR_DEFAULT_M)
    const tablet =
      obj.tablet === undefined || obj.tablet === null ? mobile : clampCpr(obj.tablet, CPR_DEFAULT_T)
    const desktop =
      obj.desktop === undefined || obj.desktop === null
        ? tablet
        : clampCpr(obj.desktop, CPR_DEFAULT_D)
    return { mobile, tablet, desktop }
  }

  function normaliseAlignment(value) {
    return ALIGN_VALUES.has(value) ? value : 'left'
  }

  function setText(node, selector, text) {
    const el = node.querySelector(selector)
    if (!el) return
    el.textContent = typeof text === 'string' ? text : ''
  }

  function applyAlignment(root, align) {
    const next = normaliseAlignment(align)
    for (const cls of Array.from(root.classList)) {
      if (cls.startsWith(ALIGN_PREFIX)) root.classList.remove(cls)
    }
    root.classList.add(`${ALIGN_PREFIX}${next}`)
  }

  function applyVariant(node, content) {
    const root = node.querySelector(ROOT_SELECTOR)
    if (!root) return

    if ('heading' in content) setText(node, HEADING_SELECTOR, content.heading)
    if ('description' in content) setText(node, DESCRIPTION_SELECTOR, content.description)
    if ('heading_alignment' in content) applyAlignment(root, content.heading_alignment)

    const grid = node.querySelector(GRID_SELECTOR)
    if (grid && 'cards_per_row' in content) {
      const { mobile, tablet, desktop } = resolveCardsPerRow(content.cards_per_row)
      grid.style.setProperty(CPR_VAR_M, String(mobile))
      grid.style.setProperty(CPR_VAR_T, String(tablet))
      grid.style.setProperty(CPR_VAR_D, String(desktop))
    }
  }

  // ── Page-level carousel ─────────────────────────────────────
  function currentIndexFor(scrollLeft, cardStride, cardCount) {
    if (cardStride <= 0) return 0
    const i = Math.round(scrollLeft / cardStride)
    if (i < 0) return 0
    if (i > cardCount - 1) return cardCount - 1
    return i
  }

  function readGap(grid) {
    const raw = window.getComputedStyle(grid).columnGap || window.getComputedStyle(grid).gap
    const n = Number.parseFloat(raw)
    return Number.isFinite(n) ? n : 0
  }

  function initCarousel(node) {
    const layout = node.querySelector(LAYOUT_SELECTOR)
    if (!layout || layout.dataset.layout !== 'carousel') return

    const grid = layout.querySelector(GRID_SELECTOR)
    const cards = grid ? Array.from(grid.querySelectorAll(`:scope > ${CARD_SELECTOR}`)) : []
    if (!grid || cards.length === 0) return

    const arrows = layout.querySelectorAll(ARROW_SELECTOR)
    const dots = Array.from(layout.querySelectorAll(DOT_SELECTOR))
    const thumb = layout.querySelector(THUMB_SELECTOR)
    const stepper = layout.querySelector(STEPPER_SELECTOR)
    const controls = layout.querySelector(CAROUSEL_CONTROLS_SELECTOR)

    function getStride() {
      const card = cards[0]
      if (!card) return 0
      return card.getBoundingClientRect().width + readGap(grid)
    }

    // Indicator dots / stepper / arrows page by *visible-cards-per-row*, not
    // by raw card count. When 3 cards fit per viewport the indicator shows
    // ceil(cards/3) entries — clicking one advances by a whole page. The
    // page size is recomputed on every update() because cards-per-row is
    // responsive and the iframe can resize without a window resize event.
    function getPageSize(stride) {
      if (!stride || stride <= 0) return 1
      return Math.max(1, Math.round(grid.clientWidth / stride))
    }

    function update() {
      const stride = getStride()
      const pageSize = getPageSize(stride)
      const totalPages = Math.max(1, Math.ceil(cards.length / pageSize))
      const max = grid.scrollWidth - grid.clientWidth

      // When every card already fits the viewport there's nothing to page
      // through — hide the arrows + indicator strip entirely rather than leave
      // dead controls on screen (a lone dot + permanently-disabled chevrons).
      // Toggle inline `display`, not the `hidden` attribute: the stylesheet
      // sets `display` on `.__controls` (flex) and, on desktop, `.__arrow`
      // (inline-flex, 0,2,0), both of which outrank the `[hidden]` UA rule.
      // Restoring `''` lets the responsive arrow rules reassert (arrows stay
      // hidden on mobile).
      const hasOverflow = max > 2
      if (controls) controls.style.display = hasOverflow ? '' : 'none'
      for (const arrow of arrows) arrow.style.display = hasOverflow ? '' : 'none'
      if (!hasOverflow) return

      // Drive dots + stepper + thumb from clamped scroll progress so the final
      // page is always reachable. A floored card-index page misses the last
      // dot at the end (the end scroll position maps to a fractional index).
      const progress = Math.min(1, Math.max(0, grid.scrollLeft / max))
      const activePage = Math.round(progress * (totalPages - 1))

      for (const [i, dot] of dots.entries()) {
        const visible = i < totalPages
        dot.hidden = !visible
        const active = visible && i === activePage
        dot.classList.toggle('is-active', active)
        if (active) dot.setAttribute('aria-selected', 'true')
        else dot.removeAttribute('aria-selected')
      }

      if (thumb && grid.scrollWidth > 0) {
        // `translateX(%)` is a percentage of the THUMB's own width, not the
        // track — using it left the thumb short of the end. Translate in px
        // against the track so the thumb reaches the right edge at progress=1.
        const track = thumb.parentElement
        const trackW = track ? track.clientWidth : 0
        const widthPct = Math.max(grid.clientWidth / grid.scrollWidth, 0.05) * 100
        const thumbW = trackW * (widthPct / 100)
        thumb.style.width = `${widthPct}%`
        thumb.style.transform = `translateX(${progress * (trackW - thumbW)}px)`
      }

      if (stepper) stepper.textContent = `${activePage + 1} / ${totalPages}`

      for (const arrow of arrows) {
        const dir = arrow.dataset.spectrumCarouselArrow
        const atStart = grid.scrollLeft <= 1
        const atEnd = grid.scrollLeft >= max - 1
        arrow.disabled = (dir === 'prev' && atStart) || (dir === 'next' && atEnd)
      }
    }

    for (const arrow of arrows) {
      arrow.addEventListener('click', () => {
        const stride = getStride()
        const pageSize = getPageSize(stride)
        const dir = arrow.dataset.spectrumCarouselArrow === 'prev' ? -1 : 1
        grid.scrollBy({ left: dir * stride * pageSize, behavior: 'smooth' })
      })
    }

    for (const [i, dot] of dots.entries()) {
      dot.addEventListener('click', () => {
        const stride = getStride()
        const pageSize = getPageSize(stride)
        grid.scrollTo({ left: i * stride * pageSize, behavior: 'smooth' })
      })
    }

    grid.addEventListener('scroll', update, { passive: true })
    // ResizeObserver catches the display:none → visible transition that
    // happens when the experience's visibility gate flips on. A plain
    // `resize` listener fires on viewport changes only — it misses the
    // initial render, when card widths first become measurable and the
    // page count needs to recompute.
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => update())
      ro.observe(grid)
    } else {
      window.addEventListener('resize', update)
    }
    update()
  }

  // ── Mini-PDP runtime ───────────────────────────────────────
  /**
   * Read the per-card payload stashed by `populateCard` after the
   * recommendations fetch resolved.
   *
   * Shape: { productId, title, url, description, images[],
   *          variants: [{ id, title, available, price, compareAtPrice,
   *                       inventoryQuantity }] }
   *
   * `inventoryQuantity` is always null on this snippet — the public
   * `/products/{handle}.json` and recommendations endpoints do not expose
   * stock counts. The Mini-PDP's low-inventory callout is therefore a
   * no-op here even when the prop is enabled.
   */
  function readPayloadForProduct(node, productId) {
    if (productId == null) return null
    const targetId = String(productId)
    const cards = node.querySelectorAll(CARD_SELECTOR)
    for (const card of cards) {
      const payload = card.__saiPayload
      if (payload && String(payload.productId) === targetId) return payload
    }
    return null
  }

  function discountPercent(price, compareAt) {
    const numPrice = Number.parseFloat(String(price ?? '').replace(/[^0-9.-]/g, ''))
    const numCompare = Number.parseFloat(String(compareAt ?? '').replace(/[^0-9.-]/g, ''))
    if (!Number.isFinite(numPrice) || !Number.isFinite(numCompare)) return null
    if (numCompare <= 0 || numCompare <= numPrice) return null
    return Math.round(((numCompare - numPrice) / numCompare) * 100)
  }

  function formatDiscount(price, compareAt, format) {
    if (format === 'amount') {
      const numPrice = Number.parseFloat(String(price ?? '').replace(/[^0-9.-]/g, ''))
      const numCompare = Number.parseFloat(String(compareAt ?? '').replace(/[^0-9.-]/g, ''))
      if (!Number.isFinite(numPrice) || !Number.isFinite(numCompare)) return null
      const diff = numCompare - numPrice
      if (!Number.isFinite(diff) || diff <= 0) return null
      const prefixMatch = String(compareAt ?? '').match(/^[^0-9-]+/)
      const prefix = prefixMatch ? prefixMatch[0].trim() : ''
      const amountStr = Math.round(diff).toLocaleString()
      return prefix ? `SAVE ${prefix}${amountStr}` : `SAVE ${amountStr}`
    }
    const pct = discountPercent(price, compareAt)
    return pct === null || pct <= 0 ? null : `${pct}% OFF`
  }

  // ─── Cart-refresh helpers ──────────────────────────────────────────────
  //
  // The snippet-library convention is "all DOM ops scoped to container —
  // never query outside it." The four helpers below (`discoverCartSectionIds`,
  // `applyCartSectionUpdates`, `refreshCartCountBadges`, `notifyCartUpdate`)
  // intentionally query `document` globally. Their job is to drive theme-
  // owned cart UI — the cart drawer, the cart-count bubble in the header,
  // the standalone cart-items section — all of which live OUTSIDE any
  // snippet container by design. A scoped query would be functionally
  // wrong: we'd never find the merchant's cart components.
  //
  // Reviewers: do not refactor these to `node.querySelectorAll(...)`. The
  // global query is the contract; the scoped rule is the rule for everything
  // *else* in this file.

  /**
   * Discover the section IDs the theme expects in the section-rendering
   * payload.  Modern Shopify themes (Horizon, Dawn-derived, etc.) tag
   * their cart drawers, cart icons, and bubble counts with
   * `data-section-id="…"`.  We forward all discovered IDs to
   * `/cart/add.js?sections=…` so the response includes the rerendered
   * HTML for each — which `applyCartSectionUpdates` then swaps into the
   * DOM directly (so themes that don't listen for our events still
   * update).  Returns a comma-joined string or `null` when no cart
   * components are present.
   */
  function discoverCartSectionIds() {
    const seen = new Set()
    const elements = document.querySelectorAll(
      'cart-items-component[data-section-id],' +
        ' cart-drawer-component[data-section-id],' +
        ' cart-icon-component[data-section-id],' +
        ' cart-bubble-component[data-section-id],' +
        ' cart-notification[data-section-id],' +
        ' cart-count-bubble[data-section-id],' +
        ' [data-cart-items-section-id],' +
        ' [data-cart-drawer-section-id],' +
        ' [data-section-id^="cart"],' +
        ' [data-section-id$="cart"],' +
        ' [data-section-id*="cart-icon"],' +
        ' [data-section-id*="cart-drawer"],' +
        ' [data-section-id*="cart-bubble"]',
    )
    for (const el of elements) {
      const id =
        el.dataset?.sectionId ??
        el.getAttribute?.('data-cart-items-section-id') ??
        el.getAttribute?.('data-cart-drawer-section-id')
      if (id) seen.add(id)
    }
    if (seen.size === 0) return null
    return Array.from(seen).join(',')
  }

  /**
   * Swap the rendered cart-section HTML from a successful `/cart/add.js`
   * response into the live DOM.  For each `{ sectionId: html }` pair we
   * find every `[data-section-id="<id>"]` element, parse the returned
   * HTML, locate the matching source element, and replace `innerHTML`
   * (preserving the host custom element + its event listeners).  This is
   * the path that updates cart-bubble counts and cart-drawer contents
   * without a page reload on themes that don't listen to our events.
   */
  function applyCartSectionUpdates(sectionsHtml) {
    if (!sectionsHtml || typeof sectionsHtml !== 'object') return
    const parser = new DOMParser()
    for (const [sectionId, html] of Object.entries(sectionsHtml)) {
      if (typeof html !== 'string' || !html) continue
      const targets = document.querySelectorAll(`[data-section-id="${CSS.escape(sectionId)}"]`)
      if (targets.length === 0) continue
      const doc = parser.parseFromString(html, 'text/html')
      const source =
        doc.querySelector(`[data-section-id="${CSS.escape(sectionId)}"]`) ??
        doc.body.firstElementChild
      if (!source) continue
      for (const target of targets) {
        target.innerHTML = source.innerHTML
      }
    }
  }

  /**
   * Best-effort cart-count refresh for themes whose cart-count badge
   * sits outside any `data-section-id` element (so the section-update
   * path doesn't touch it).  We re-fetch the cart and overwrite the
   * `textContent` of common count-badge selectors with the fresh count.
   * Silent on themes that don't expose one of these selectors.
   */
  async function refreshCartCountBadges() {
    let count
    try {
      const sdk = window.Spectrum
      const cart =
        sdk?.cart?.get != null ? await sdk.cart.get() : await (await fetch('/cart.js')).json()
      count = cart?.item_count
    } catch {
      return
    }
    if (typeof count !== 'number') return
    const text = String(count)
    const selectors = [
      '[data-cart-count]',
      '.cart-count',
      '.cart-count-bubble',
      '#cart-icon-bubble [aria-hidden="true"]',
      '.header__icon--cart .cart-count-bubble span:first-child',
    ]
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.querySelector(':scope > *')) continue
        el.textContent = text
      }
    }
  }

  /**
   * Tell the merchant theme the cart just changed.  First actively swaps
   * the rerendered section HTML into the DOM and refreshes count badges
   * outside any section host — then dispatches `cart:update` / `cart:added`
   * / `cart:refresh` for themes that listen.  Cart-bubble + drawer reflect
   * the new item without a page reload.
   */
  function notifyCartUpdate({ variantId, productId, response }) {
    const sections = response?.sections ?? {}

    applyCartSectionUpdates(sections)
    refreshCartCountBadges()

    const detail = {
      resource: response ?? {},
      sourceId: String(variantId),
      data: {
        source: 'spectrum-featured-collection',
        sections,
        itemCount: 1,
        productId: productId ?? undefined,
        variantId: String(variantId),
      },
    }
    try {
      document.dispatchEvent(new CustomEvent('cart:update', { bubbles: true, detail }))
      document.dispatchEvent(new CustomEvent('cart:added', { bubbles: true, detail }))
      document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true, detail }))
    } catch {}

    const candidates = document.querySelectorAll(
      'cart-drawer-component, cart-drawer, cart-notification, [data-cart-drawer], #cart-drawer',
    )
    for (const el of candidates) {
      if (typeof el.showDialog === 'function') {
        try {
          el.showDialog()
          return
        } catch {}
      }
      if (typeof el.open === 'function') {
        try {
          el.open()
          return
        } catch {}
      }
    }
    const toggle = document.querySelector('[data-cart-toggle], [data-action="open-cart"]')
    if (toggle && typeof toggle.click === 'function') {
      try {
        toggle.click()
      } catch {}
    }
  }

  async function addVariantToCart(variantId, quantity) {
    const sdk = window.Spectrum
    const sections = discoverCartSectionIds()
    const items = { id: variantId, quantity }
    if (sdk?.cart && typeof sdk.cart.add === 'function') {
      return sdk.cart.add(items, sections ? { sections } : undefined)
    }
    const fd = new FormData()
    fd.append('id', String(variantId))
    fd.append('quantity', String(quantity))
    if (sections) fd.append('sections', sections)
    const res = await fetch('/cart/add.js', { method: 'POST', body: fd })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Cart add failed: ${res.status} ${text.slice(0, 200)}`)
    }
    return res.json().catch(() => ({}))
  }

  /**
   * Initialise the inline Mini-PDP modal scoped to this snippet container.
   *
   * On open, populates gallery / variants / price / qty / description from
   * the per-card payload.  Variant selection drives price-row + low-inventory
   * updates synchronously.
   *
   *   - ATC button: cart add + cart drawer notify (existing flow).
   *   - Buy Now: cart add + redirect to /checkout.
   *   - Share: native Web Share API; clipboard copy fallback.
   */
  function initMiniPdp(node, track) {
    const modal = node.querySelector('[data-spectrum-pdp-modal]')
    if (!modal) return null
    const trackFn = typeof track === 'function' ? track : noopTrack

    const cfgTag = modal.querySelector('[data-spectrum-pdp-config]')
    let cfg = {}
    try {
      cfg = JSON.parse(cfgTag?.textContent || '{}')
    } catch {}

    const backdrop = modal.querySelector('[data-spectrum-pdp-backdrop]')
    const closeBtn = modal.querySelector('[data-spectrum-pdp-close]')
    const trackEl = modal.querySelector('[data-spectrum-pdp-track]')
    const dotsEl = modal.querySelector('[data-spectrum-pdp-dots]')
    const chevronPrev = modal.querySelector('[data-spectrum-pdp-chevron="prev"]')
    const chevronNext = modal.querySelector('[data-spectrum-pdp-chevron="next"]')
    const titleEl = modal.querySelector('[data-spectrum-pdp-title]')
    const priceCurrentEl = modal.querySelector('[data-spectrum-pdp-price-current]')
    const priceMrpEl = modal.querySelector('[data-spectrum-pdp-price-mrp]')
    const discountEl = modal.querySelector('[data-spectrum-pdp-discount]')
    const variantsEl = modal.querySelector('[data-spectrum-pdp-variants]')
    const lowStockEl = modal.querySelector('[data-spectrum-pdp-low-stock]')
    const lowStockTextEl = modal.querySelector('[data-spectrum-pdp-low-stock-text]')
    const qtyInput = modal.querySelector('[data-spectrum-pdp-qty-input]')
    const qtyDec = modal.querySelector('[data-spectrum-pdp-qty-decrement]')
    const qtyInc = modal.querySelector('[data-spectrum-pdp-qty-increment]')
    const descEl = modal.querySelector('[data-spectrum-pdp-description]')
    const descBody = modal.querySelector('[data-spectrum-pdp-description-body]')
    const descToggle = modal.querySelector('[data-spectrum-pdp-description-toggle]')
    const atcBtn = modal.querySelector('[data-spectrum-pdp-atc]')
    const buyNowBtn = modal.querySelector('[data-spectrum-pdp-buy-now]')
    const shareBtn = modal.querySelector('[data-spectrum-pdp-share]')
    const viewProductLink = modal.querySelector('[data-spectrum-pdp-view-product]')
    // Cache the configured ATC / Buy Now labels so we can restore them when
    // a different (available) variant is selected after a sold-out one.
    const atcDefaultLabel = atcBtn?.textContent ?? ''
    const buyNowDefaultLabel = buyNowBtn?.textContent ?? ''
    const soldOutLabel =
      typeof cfg.soldOutLabel === 'string' && cfg.soldOutLabel ? cfg.soldOutLabel : 'Sold Out'

    let returnFocusTo = null
    let activeProduct = null
    let selectedVariantId = null
    let autoPlayTimer = null

    function stopAutoPlay() {
      if (autoPlayTimer) {
        clearInterval(autoPlayTimer)
        autoPlayTimer = null
      }
    }

    function close() {
      modal.hidden = true
      document.documentElement.classList.remove(`sai-${SNIPPET_ID}-body-locked`)
      stopAutoPlay()
      if (returnFocusTo && typeof returnFocusTo.focus === 'function') {
        try {
          returnFocusTo.focus()
        } catch {}
      }
      returnFocusTo = null
      activeProduct = null
      selectedVariantId = null
    }

    function renderGallery(images) {
      while (trackEl.firstChild) trackEl.removeChild(trackEl.firstChild)
      const count = images.length
      for (const [i, src] of images.entries()) {
        const slide = document.createElement('div')
        slide.className = `sai-${SNIPPET_ID}__pdp-slide`
        slide.setAttribute('role', 'group')
        slide.setAttribute('aria-roledescription', 'slide')
        slide.setAttribute('aria-label', `Image ${i + 1} of ${count}`)
        const img = document.createElement('img')
        img.src = src
        img.alt = ''
        img.loading = i === 0 ? 'eager' : 'lazy'
        slide.appendChild(img)
        trackEl.appendChild(slide)
      }

      const showCarouselNav = cfg.galleryStyle === 'carousel' && count > 1
      if (chevronPrev) chevronPrev.hidden = !(showCarouselNav && cfg.showChevrons)
      if (chevronNext) chevronNext.hidden = !(showCarouselNav && cfg.showChevrons)

      if (dotsEl) {
        while (dotsEl.firstChild) dotsEl.removeChild(dotsEl.firstChild)
        if (showCarouselNav && cfg.showDots) {
          dotsEl.hidden = false
          for (let i = 0; i < count; i++) {
            const dot = document.createElement('button')
            dot.type = 'button'
            dot.className = `sai-${SNIPPET_ID}__pdp-dot${i === 0 ? ' is-active' : ''}`
            dot.setAttribute('aria-label', `Show image ${i + 1}`)
            if (i === 0) dot.setAttribute('aria-selected', 'true')
            dot.addEventListener('click', () => {
              const stride = trackEl.clientWidth
              trackEl.scrollTo({ left: i * stride, behavior: 'smooth' })
            })
            dotsEl.appendChild(dot)
          }
        } else {
          dotsEl.hidden = true
        }
      }
    }

    function updateGalleryActiveState() {
      const stride = trackEl.clientWidth
      if (stride <= 0) return
      const idx = Math.max(
        0,
        Math.min(Math.round(trackEl.scrollLeft / stride), trackEl.children.length - 1),
      )
      if (dotsEl && !dotsEl.hidden) {
        const dots = dotsEl.children
        for (let i = 0; i < dots.length; i++) {
          const active = i === idx
          dots[i].classList.toggle('is-active', active)
          if (active) dots[i].setAttribute('aria-selected', 'true')
          else dots[i].removeAttribute('aria-selected')
        }
      }
      if (chevronPrev && !chevronPrev.hidden) chevronPrev.disabled = idx === 0
      if (chevronNext && !chevronNext.hidden)
        chevronNext.disabled = idx === trackEl.children.length - 1
    }

    function renderVariants(variants) {
      if (!variantsEl) return
      while (variantsEl.firstChild) variantsEl.removeChild(variantsEl.firstChild)

      if (cfg.variantSelectorStyle === 'dropdown') {
        const select = document.createElement('select')
        select.setAttribute('aria-label', 'Choose a variant')
        for (const v of variants) {
          const opt = document.createElement('option')
          opt.value = String(v.id)
          opt.textContent = cfg.showPriceInVariant && v.price ? `${v.title} — ${v.price}` : v.title
          if (v.available === false) opt.disabled = true
          select.appendChild(opt)
        }
        select.addEventListener('change', () => setSelectedVariant(select.value))
        variantsEl.appendChild(select)
        return
      }

      for (const v of variants) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = `sai-${SNIPPET_ID}__pdp-variant`
        btn.dataset.variantId = String(v.id)
        btn.setAttribute('role', 'radio')
        btn.setAttribute('aria-checked', 'false')

        const titleSpan = document.createElement('span')
        titleSpan.className = `sai-${SNIPPET_ID}__pdp-variant-title`
        titleSpan.textContent = typeof v.title === 'string' ? v.title : ''
        btn.appendChild(titleSpan)

        if (cfg.showPriceInVariant && v.price) {
          const priceSpan = document.createElement('span')
          priceSpan.className = `sai-${SNIPPET_ID}__pdp-variant-price`
          priceSpan.innerHTML = v.price
          btn.appendChild(priceSpan)
        }

        if (v.available === false) {
          btn.disabled = true
          btn.setAttribute('aria-disabled', 'true')
        }

        btn.addEventListener('click', () => {
          if (btn.disabled) return
          setSelectedVariant(v.id)
        })

        variantsEl.appendChild(btn)
      }
    }

    function variantById(id) {
      if (!activeProduct) return null
      const idStr = String(id)
      return activeProduct.variants.find((v) => String(v.id) === idStr) ?? null
    }

    function setSelectedVariant(id) {
      selectedVariantId = id == null ? null : String(id)
      const v = variantById(selectedVariantId)

      if (variantsEl) {
        for (const btn of variantsEl.querySelectorAll(`.sai-${SNIPPET_ID}__pdp-variant`)) {
          const isMatch = btn.dataset.variantId === selectedVariantId
          btn.classList.toggle('is-selected', isMatch)
          btn.setAttribute('aria-checked', isMatch ? 'true' : 'false')
        }
      }

      if (v) {
        if (priceCurrentEl) priceCurrentEl.innerHTML = v.price ?? ''
        if (priceMrpEl) {
          if (v.compareAtPrice && discountPercent(v.price, v.compareAtPrice) !== null) {
            priceMrpEl.innerHTML = v.compareAtPrice
            priceMrpEl.hidden = false
          } else {
            priceMrpEl.hidden = true
            priceMrpEl.innerHTML = ''
          }
        }
        if (discountEl) {
          const text = formatDiscount(v.price, v.compareAtPrice, cfg.discountFormat)
          if (text) {
            discountEl.textContent = text
            discountEl.hidden = false
          } else {
            discountEl.hidden = true
            discountEl.textContent = ''
          }
        }
      }

      if (lowStockEl && cfg.showLowInventoryCallout) {
        const qty = v?.inventoryQuantity
        const threshold = Number(cfg.lowInventoryThreshold) || 10
        if (typeof qty === 'number' && qty > 0 && qty <= threshold) {
          const tmpl = String(cfg.lowInventoryText || 'Only {n} available')
          if (lowStockTextEl) lowStockTextEl.textContent = tmpl.replace('{n}', String(qty))
          lowStockEl.hidden = false
        } else {
          lowStockEl.hidden = true
        }
      }

      const enabled = v != null && v.available !== false
      if (atcBtn) {
        atcBtn.disabled = !enabled
        atcBtn.textContent = enabled ? atcDefaultLabel : soldOutLabel
      }
      if (buyNowBtn) {
        buyNowBtn.disabled = !enabled
        buyNowBtn.textContent = enabled ? buyNowDefaultLabel : soldOutLabel
      }
    }

    function renderDescription(html) {
      if (!descEl || !descBody) return
      descBody.innerHTML = html ?? ''
      if (cfg.descriptionStyle !== 'expandable' || !descToggle) return
      descEl.classList.add('is-collapsed')
      requestAnimationFrame(() => {
        const overflowing = descBody.scrollHeight > descBody.clientHeight + 4
        descToggle.hidden = !overflowing
        descToggle.textContent = 'Read more'
        descToggle.setAttribute('aria-expanded', 'false')
      })
    }

    function getQuantity() {
      if (!qtyInput) return 1
      const n = Number.parseInt(qtyInput.value, 10)
      return Number.isFinite(n) && n > 0 ? n : 1
    }

    function startAutoPlay(slideCount) {
      stopAutoPlay()
      autoPlayTimer = setInterval(() => {
        const stride = trackEl.clientWidth
        if (stride <= 0) return
        const idx = Math.round(trackEl.scrollLeft / stride)
        const next = (idx + 1) % slideCount
        trackEl.scrollTo({ left: next * stride, behavior: 'smooth' })
      }, 4000)
    }

    function open(payload, triggerEl) {
      if (!payload || !Array.isArray(payload.variants) || payload.variants.length === 0) return
      activeProduct = payload
      returnFocusTo = triggerEl ?? null

      // Clear loading state from any prior open so a stale spinner never
      // overlays a fresh button label.
      if (atcBtn) atcBtn.removeAttribute('aria-busy')
      if (buyNowBtn) buyNowBtn.removeAttribute('aria-busy')

      if (titleEl) titleEl.textContent = payload.title ?? ''
      if (viewProductLink && payload.url) viewProductLink.setAttribute('href', payload.url)

      const images =
        Array.isArray(payload.images) && payload.images.length > 0 ? payload.images : []
      renderGallery(images)
      requestAnimationFrame(() => {
        trackEl.scrollLeft = 0
        updateGalleryActiveState()
      })

      renderVariants(payload.variants)
      const firstAvailable = payload.variants.find((v) => v.available !== false)
      setSelectedVariant(firstAvailable?.id ?? payload.variants[0].id)

      if (qtyInput) qtyInput.value = '1'

      if (cfg.showDescription) {
        renderDescription(payload.description)
      }

      modal.hidden = false
      document.documentElement.classList.add(`sai-${SNIPPET_ID}-body-locked`)

      if (cfg.galleryStyle === 'carousel' && cfg.autoPlay && images.length > 1) {
        startAutoPlay(images.length)
      }

      const focusable =
        modal.querySelector(`.sai-${SNIPPET_ID}__pdp-variant:not(:disabled)`) ?? closeBtn
      focusable?.focus?.()
    }

    backdrop?.addEventListener('click', close)
    closeBtn?.addEventListener('click', close)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) close()
    })

    if (chevronPrev) {
      chevronPrev.addEventListener('click', () => {
        const stride = trackEl.clientWidth
        trackEl.scrollBy({ left: -stride, behavior: 'smooth' })
      })
    }
    if (chevronNext) {
      chevronNext.addEventListener('click', () => {
        const stride = trackEl.clientWidth
        trackEl.scrollBy({ left: stride, behavior: 'smooth' })
      })
    }
    trackEl.addEventListener('scroll', updateGalleryActiveState, { passive: true })
    window.addEventListener('resize', updateGalleryActiveState)

    modal.addEventListener('mouseenter', stopAutoPlay)
    modal.addEventListener('focusin', stopAutoPlay)

    if (qtyDec && qtyInput) {
      qtyDec.addEventListener('click', () => {
        const n = getQuantity()
        qtyInput.value = String(Math.max(1, n - 1))
      })
    }
    if (qtyInc && qtyInput) {
      qtyInc.addEventListener('click', () => {
        qtyInput.value = String(getQuantity() + 1)
      })
    }

    if (descToggle && descEl) {
      descToggle.addEventListener('click', () => {
        const collapsed = descEl.classList.toggle('is-collapsed')
        descToggle.textContent = collapsed ? 'Read more' : 'Read less'
        descToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
      })
    }

    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        if (!activeProduct) return
        const data = {
          title: activeProduct.title ?? '',
          url: activeProduct.url
            ? new URL(activeProduct.url, window.location.origin).toString()
            : window.location.href,
        }
        if (typeof navigator.share === 'function') {
          try {
            await navigator.share(data)
            return
          } catch {}
        }
        if (navigator.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(data.url)
            shareBtn.setAttribute('data-copied', 'true')
            setTimeout(() => shareBtn.removeAttribute('data-copied'), 2000)
          } catch {}
        }
      })
    }

    if (atcBtn) {
      atcBtn.addEventListener('click', async () => {
        if (selectedVariantId == null || atcBtn.disabled) return
        atcBtn.disabled = true
        atcBtn.setAttribute('aria-busy', 'true')
        const startedAt = Date.now()
        const quantity = getQuantity()
        try {
          const result = await addVariantToCart(selectedVariantId, quantity)
          const elapsed = Date.now() - startedAt
          if (elapsed < MIN_SPINNER_MS) {
            await new Promise((r) => setTimeout(r, MIN_SPINNER_MS - elapsed))
          }
          notifyCartUpdate({
            variantId: selectedVariantId,
            productId: activeProduct?.productId,
            response: result,
          })
          // Fire AFTER successful cart write — never fire on a failed POST.
          // `source: 'mini_pdp'` separates the modal-driven add from the
          // single-variant instant-add path emitted by initAtcButtons.
          trackFn(`${FEATURE_SLUG}:add_to_cart`, {
            product_id: activeProduct?.productId ?? null,
            product_handle: productHandleFromUrl(activeProduct?.url),
            variant_id: selectedVariantId,
            quantity,
            source: 'mini_pdp',
          })
          close()
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[Featured Collection] Add to cart failed', err)
          atcBtn.disabled = false
          atcBtn.removeAttribute('aria-busy')
        }
      })
    }

    if (buyNowBtn) {
      buyNowBtn.addEventListener('click', async () => {
        if (selectedVariantId == null || buyNowBtn.disabled) return
        buyNowBtn.disabled = true
        buyNowBtn.setAttribute('aria-busy', 'true')
        const startedAt = Date.now()
        try {
          await addVariantToCart(selectedVariantId, getQuantity())
          const elapsed = Date.now() - startedAt
          if (elapsed < MIN_SPINNER_MS) {
            await new Promise((r) => setTimeout(r, MIN_SPINNER_MS - elapsed))
          }
          window.location.href = '/checkout'
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[Featured Collection] Buy now failed', err)
          buyNowBtn.disabled = false
          buyNowBtn.removeAttribute('aria-busy')
        }
      })
    }

    return { open, close }
  }

  // ── Per-card image carousel ────────────────────────────────
  function initImageCarousels(node) {
    const tracks = node.querySelectorAll('[data-spectrum-image-track]')
    for (const track of tracks) {
      const zone = track.parentElement
      if (!zone) continue
      const slides = Array.from(track.children)
      if (slides.length === 0) continue
      const dotsContainer = zone.querySelector('[data-spectrum-image-dots]')
      const dots = dotsContainer ? Array.from(dotsContainer.children) : []

      function update() {
        const stride = track.clientWidth
        if (stride <= 0) return
        const idx = Math.round(track.scrollLeft / stride)
        const clamped = Math.max(0, Math.min(idx, slides.length - 1))
        for (let i = 0; i < dots.length; i++) {
          const dot = dots[i]
          const active = i === clamped
          dot.classList.toggle('is-active', active)
          if (active) dot.setAttribute('aria-selected', 'true')
          else dot.removeAttribute('aria-selected')
        }
      }

      for (const dot of dots) {
        dot.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          const idx = Number.parseInt(dot.dataset.spectrumImageDot ?? '0', 10)
          if (!Number.isFinite(idx)) return
          const stride = track.clientWidth
          track.scrollTo({ left: idx * stride, behavior: 'smooth' })
        })
      }

      track.addEventListener('scroll', update, { passive: true })
      window.addEventListener('resize', update)
      update()
    }
  }

  /**
   * CTA click → either instant-add the only variant, or open the inline
   * Mini-PDP with the per-card payload.
   *
   * Single-variant products skip the modal entirely — there's nothing to
   * pick — and add straight to cart with the same spinner + cart-drawer
   * notify the Mini-PDP uses.  Multi-variant (or sole-variant-unavailable)
   * products open the modal so the shopper can choose / see the state.
   *
   * Falls back to navigating to PDP only when no payload could be parsed.
   */
  function initAtcButtons(node, dialog, track) {
    const trackFn = typeof track === 'function' ? track : noopTrack
    const ctas = node.querySelectorAll(`.sai-${SNIPPET_ID}__cta[data-spectrum-atc]`)
    for (const cta of ctas) {
      // At render time: if every variant on this product is `available: false`,
      // flip the CTA into a disabled "Sold Out" state.  The label uses the
      // merchant-configured `sold_out_label` (Liquid threads it through via
      // `data-sold-out-label`).
      const productId = cta.dataset.productId
      if (productId) {
        const payload = readPayloadForProduct(node, productId)
        if (
          payload &&
          Array.isArray(payload.variants) &&
          payload.variants.length > 0 &&
          payload.variants.every((v) => v.available === false)
        ) {
          const soldOutLabel = cta.dataset.soldOutLabel || 'Sold Out'
          cta.textContent = soldOutLabel
          cta.setAttribute('aria-disabled', 'true')
          cta.classList.add('is-soldout')
        }
      }

      cta.addEventListener('click', async (e) => {
        const productId = cta.dataset.productId
        if (!productId) return
        const payload = readPayloadForProduct(node, productId)
        if (!payload || !Array.isArray(payload.variants) || payload.variants.length === 0) return

        e.preventDefault()

        if (cta.getAttribute('aria-busy') === 'true') return
        if (cta.getAttribute('aria-disabled') === 'true') return

        // Single-variant products skip the modal unconditionally.  Nothing
        // to pick — and a malformed id / OOS state should surface as a
        // failed cart POST (logged in the catch), not as a useless modal
        // with one strikethrough pill.
        if (payload.variants.length === 1) {
          const onlyVariant = payload.variants[0]
          cta.setAttribute('aria-busy', 'true')
          const startedAt = Date.now()
          try {
            const result = await addVariantToCart(onlyVariant.id, 1)
            const elapsed = Date.now() - startedAt
            if (elapsed < MIN_SPINNER_MS) {
              await new Promise((r) => setTimeout(r, MIN_SPINNER_MS - elapsed))
            }
            notifyCartUpdate({
              variantId: onlyVariant.id,
              productId: payload.productId ?? productId,
              response: result,
            })
            // `source: 'instant'` separates the single-variant fast path
            // from the modal-driven add emitted by initMiniPdp.
            trackFn(`${FEATURE_SLUG}:add_to_cart`, {
              product_id: payload.productId ?? productId ?? null,
              product_handle: productHandleFromUrl(payload.url ?? cta.href),
              variant_id: onlyVariant.id,
              quantity: 1,
              source: 'instant',
            })
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[Featured Collection] Instant add to cart failed', err)
          } finally {
            cta.removeAttribute('aria-busy')
          }
          return
        }

        if (!dialog) {
          window.location.href = cta.href
          return
        }

        // Fire `mini_pdp_open` BEFORE dialog.open() so the timestamp captures
        // intent (the open() call paints the modal synchronously; ordering
        // doesn't affect UX but it keeps the event causally upstream of any
        // in-modal events that follow).
        const cardElForOpen = cta.closest(CARD_SELECTOR)
        trackFn(`${FEATURE_SLUG}:mini_pdp_open`, {
          product_id: payload.productId ?? productId ?? null,
          product_handle: productHandleFromUrl(payload.url ?? cta.href),
          position: cardPosition(cardElForOpen),
        })

        dialog.open(
          {
            productId: payload.productId ?? productId,
            title: payload.title ?? cta.dataset.productTitle ?? '',
            url: payload.url ?? cta.href,
            description: payload.description ?? '',
            images: Array.isArray(payload.images) ? payload.images : [],
            variants: payload.variants,
          },
          cta,
        )
      })
    }
  }

  if (typeof globalThis !== 'undefined' && globalThis.__SAI_TEST_HARNESS__ === true) {
    globalThis.__saiFrpxf1zz = {
      applyVariant,
      clampCpr,
      resolveCardsPerRow,
      normaliseAlignment,
      currentIndexFor,
      readPayloadForProduct,
      discoverCartSectionIds,
      discountPercent,
      formatDiscount,
      productHandleFromUrl,
      cardPosition,
      safeTrack,
      readSimConfig,
      readRecommendationHandles,
      loadRecommendations,
      hideWrapper,
      transformImageUrl,
      buildImageSrcset,
      formatMoney,
      discountPercentFromCents,
      findColorOptionValues,
      normaliseProductPayload,
      populateCard,
      populateCardImage,
      populateCardSwatches,
      populateCardPrice,
      renderRecommendedProducts,
      reconcileCarouselControls,
      initCarousel,
    }
  }

  // Card-link clicks are intent-to-navigate. We fire BEFORE the browser
  // commits the navigation (no preventDefault) so the event lands in
  // PostHog even when the user immediately lands on the PDP. Native link
  // semantics (cmd-click, middle-click, right-click → Open in new tab)
  // still work — we never call preventDefault from here.
  function initCardLinkTracking(node, track) {
    if (typeof track !== 'function') return
    const links = node.querySelectorAll(`.sai-${SNIPPET_ID}__card-link`)
    for (const link of links) {
      link.addEventListener('click', () => {
        const cardEl = link.closest(CARD_SELECTOR)
        // Read product_id from the sibling CTA's data attribute. Card
        // doesn't carry product_id itself; CTA does. When show_cta is
        // false the CTA is absent — fall back to null.
        const cta = cardEl?.querySelector(`.sai-${SNIPPET_ID}__cta[data-spectrum-atc]`)
        track(`${FEATURE_SLUG}:card_click`, {
          product_id: cta?.dataset.productId ?? null,
          product_handle: productHandleFromUrl(link.getAttribute('href')),
          position: cardPosition(cardEl),
        })
      })
    }
  }

  const snippetApi = window.__spectrumAi?.snippet
  const containers = document.querySelectorAll(
    `[data-spectrum-instance-id][data-spectrum-snippet-id="${SNIPPET_ID}"]`,
  )

  // Per container: bind (so analytics handles + variant resolution exist
  // before any click code might want them), then load recommendations from
  // the SSR'd metafield handle list + per-handle product fetches, render
  // the cards, and only then wire up the carousel / mini-PDP / ATC
  // handlers — which all depend on populated cards being in the DOM. On
  // any failure path (no anchor, empty handle list, every fetch failed)
  // the outer wrapper is flipped to vis=off and the snippet collapses
  // silently.
  async function bootContainer(node) {
    // Suppress the pager (arrows + indicator strip) through the skeleton /
    // recommendations-fetch phase. The SSR renders it sized to product_count
    // placeholders, which overflow and show arrows + a dot-per-placeholder;
    // once the (usually fewer) real cards load it would collapse. initCarousel()
    // reveals the pager post-load, and only when the populated track overflows.
    const pagerLayout = node.querySelector(LAYOUT_SELECTOR)
    if (pagerLayout) {
      const pagerControls = pagerLayout.querySelector(CAROUSEL_CONTROLS_SELECTOR)
      if (pagerControls) pagerControls.style.display = 'none'
      for (const pagerArrow of pagerLayout.querySelectorAll(ARROW_SELECTOR))
        pagerArrow.style.display = 'none'
    }

    let track = null
    if (snippetApi && typeof snippetApi.bind === 'function') {
      const handles = snippetApi.bind(node, ({ variants, currentVariantId }) => {
        const variant = variants.find((v) => v.variantId === currentVariantId)
        if (!variant || !variant.content) return
        applyVariant(node, variant.content)
      })
      track = handles?.track ? safeTrack(handles.track) : null
    }

    const config = readSimConfig(node)
    if (!config || !config.anchorProductId) {
      hideWrapper(node)
      return
    }

    const recommendationHandles = readRecommendationHandles(node)
    if (recommendationHandles.length === 0) {
      hideWrapper(node)
      return
    }

    const products = await loadRecommendations(recommendationHandles, config.productCount)
    if (!products || products.length === 0) {
      hideWrapper(node)
      return
    }

    const rendered = renderRecommendedProducts(node, products, config)
    if (rendered === 0) {
      hideWrapper(node)
      return
    }

    initCarousel(node)
    initImageCarousels(node)
    const miniPdp = initMiniPdp(node, track)
    initAtcButtons(node, miniPdp, track)
    initCardLinkTracking(node, track)
  }

  for (const node of containers) {
    bootContainer(node).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(`[${FEATURE_SLUG}] boot failed`, err)
      hideWrapper(node)
    })
  }
})()
