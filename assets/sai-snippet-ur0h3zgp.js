/**
 * Low Inventory — PDP scarcity signal.
 *
 * Reads three JSON islands rendered by the wrapper Liquid:
 *   - data-spectrum-ur0h3zgp-inv-callouts    map of String(variantId) -> rows[]
 *   - data-spectrum-ur0h3zgp-initial-variant String(variantId) of the SSR'd variant
 *   - data-spectrum-ur0h3zgp-settings        snippet settings
 *
 * Rows shape: { targetingTree, availableQuantity, totalQuantity? }
 *
 * The rows are source-agnostic: the wrapper Liquid emits the same shape whether
 * the merchant's `inventory_source` is the synced metafield or live Shopify
 * inventory, so this JS does not branch on the source. Live-mode rows are always
 * catch-all (targetingTree: null) and carry no totalQuantity, so the meter falls
 * back to meter_initial_quantity_fallback — the same path as a metafield row
 * that omits totalQuantity.
 *
 * Row selection: the first row whose `targetingTree` evaluates true wins.
 * A row with no `targetingTree` is a catch-all. Targeting is evaluated
 * inline via the public `__spectrumAi.targeting.evaluate` + `buildContext`
 * APIs — same primitives the storefront's slot-entry resolver uses.
 * If `targeting.evaluate` is unavailable (older bootstrap), the snippet
 * falls back to the first catch-all row so single-row data still renders.
 *
 * Effective display mode per render is `tier.display_type || settings.display_type`
 * with `'inline' | 'meter'`. The DOM exposes the resolved mode through the
 * `data-spectrum-mode` attribute on the root, which the CSS uses to switch
 * between the simple inline layout and the card-style meter layout.
 */
;(() => {
  const SNIPPET_ID = 'ur0h3zgp'

  const root = document.querySelector(`.sai-${SNIPPET_ID}`)
  if (!root) return

  const bindFn = window.__spectrumAi?.snippet?.bind
  const bound = typeof bindFn === 'function' ? bindFn(root, () => {}) : null
  const track = bound && typeof bound.track === 'function' ? bound.track : () => {}

  const settings = parseIsland('[data-spectrum-ur0h3zgp-settings]') || {}
  const callouts = parseIsland('[data-spectrum-ur0h3zgp-inv-callouts]') || {}
  let currentVariantId = String(parseIsland('[data-spectrum-ur0h3zgp-initial-variant]') ?? '')

  const iconBadgeEl = root.querySelector(`.sai-${SNIPPET_ID}__icon-badge`)
  const messageEl = root.querySelector(`.sai-${SNIPPET_ID}__message`)
  const subMessageEl = root.querySelector(`.sai-${SNIPPET_ID}__sub-message`)
  const meterEl = root.querySelector(`.sai-${SNIPPET_ID}__meter`)
  const meterFillEl = root.querySelector(`.sai-${SNIPPET_ID}__meter-fill`)
  const beaconBarEl = root.querySelector(`.sai-${SNIPPET_ID}__beacon-bar`)
  const beaconFillEl = root.querySelector(`.sai-${SNIPPET_ID}__beacon-bar-fill`)

  applyPulseInterval()
  hydrate()
  subscribeVariantChange()

  function hydrate() {
    const rows = Array.isArray(callouts[currentVariantId]) ? callouts[currentVariantId] : []
    if (rows.length === 0) return hide()

    const matched = pickFirstMatchingRow(rows)
    if (!matched) return hide()

    const tier = pickTier(matched.availableQuantity, settings.stock_templates)
    if (!tier) return hide()

    render(matched, tier)
    show()
    track('fomo:low_inventory_impression', {
      display_mode: resolveMode(tier),
      tier_min_stock: tier.min_stock,
      tier_max_stock: tier.max_stock,
      data_source: settings.inventory_source || 'metafield',
    })
  }

  function render(row, tier) {
    const mode = resolveMode(tier)
    const urgent = !!(settings.urgency_escalation_enabled && tier.urgency)

    root.setAttribute('data-spectrum-mode', mode)
    root.classList.toggle(`sai-${SNIPPET_ID}--urgent`, urgent)

    // Beacon's ring IS the indicator, so it pulses whenever the merchant
    // hasn't disabled the animation — independent of tier urgency. Inline /
    // meter pulse the emoji only on urgent tiers.
    const wantPulse =
      mode === 'beacon' ? settings.pulse_animation !== false : urgent && !!settings.pulse_animation
    root.classList.toggle(`sai-${SNIPPET_ID}--pulse`, wantPulse)

    applyIcon(tier)
    applyMessages(row, tier)
    applyMeter(row, mode)
    applyBeaconBar(row, mode)
  }

  function resolveMode(tier) {
    const t = tier?.display_type
    if (t === 'inline' || t === 'meter' || t === 'beacon') return t
    const d = settings.display_type
    return d === 'meter' || d === 'beacon' ? d : 'inline'
  }

  function applyIcon(tier) {
    if (!iconBadgeEl) return
    const tierImage = typeof tier?.icon_image_url === 'string' ? tier.icon_image_url.trim() : ''
    const tierEmoji = typeof tier?.icon_emoji === 'string' ? tier.icon_emoji.trim() : ''
    const defaultImage =
      typeof settings.icon_image_url === 'string' ? settings.icon_image_url.trim() : ''
    const defaultEmoji = typeof settings.icon_emoji === 'string' ? settings.icon_emoji : '🔥'

    let imageUrl = ''
    let emoji = defaultEmoji

    if (tierImage) {
      imageUrl = tierImage
    } else if (tierEmoji) {
      emoji = tierEmoji
    } else if (defaultImage) {
      imageUrl = defaultImage
    }

    // Replace badge children with a single element that matches the resolved
    // icon source. Keeps the DOM minimal and the SSR shape consistent across
    // re-renders (e.g. variant-change).
    iconBadgeEl.innerHTML = ''
    if (imageUrl) {
      const img = document.createElement('img')
      img.className = `sai-${SNIPPET_ID}__icon sai-${SNIPPET_ID}__icon--image`
      img.src = imageUrl
      img.alt = ''
      img.loading = 'lazy'
      img.decoding = 'async'
      iconBadgeEl.appendChild(img)
    } else {
      const span = document.createElement('span')
      span.className = `sai-${SNIPPET_ID}__icon sai-${SNIPPET_ID}__icon--emoji`
      span.textContent = emoji
      iconBadgeEl.appendChild(span)
    }
  }

  function applyMessages(row, tier) {
    if (messageEl) {
      const template = typeof tier.message === 'string' ? tier.message : ''
      messageEl.textContent = template.replace('{count}', String(row.availableQuantity))
    }
    if (subMessageEl) {
      const sub = typeof tier.sub_message === 'string' ? tier.sub_message : ''
      if (sub) {
        subMessageEl.textContent = sub.replace('{count}', String(row.availableQuantity))
        subMessageEl.hidden = false
      } else {
        subMessageEl.textContent = ''
        subMessageEl.hidden = true
      }
    }
  }

  // Depletion percentage shared by the meter and the beacon bar. Denominator
  // is the row's totalQuantity, falling back to the configured initial
  // quantity when the row omits it. Clamped to [0, 100].
  function depletionPct(row) {
    const total =
      typeof row.totalQuantity === 'number' && row.totalQuantity > 0
        ? row.totalQuantity
        : Number(settings.meter_initial_quantity_fallback) || 100
    const raw = (Number(row.availableQuantity) / total) * 100
    return Math.max(0, Math.min(100, raw))
  }

  function applyMeter(row, mode) {
    if (!meterEl) return
    if (mode !== 'meter') {
      meterEl.hidden = true
      return
    }
    meterEl.hidden = false

    const pct = depletionPct(row)
    meterEl.setAttribute('aria-valuenow', String(Math.round(pct)))

    if (meterFillEl) {
      const bucket = bucketFor(pct)
      const base = `sai-${SNIPPET_ID}__meter-fill`
      meterFillEl.className = `${base} ${base}--${bucket}`
      meterFillEl.style.width = `${pct}%`
    }
  }

  function applyBeaconBar(row, mode) {
    if (!beaconBarEl) return
    if (mode !== 'beacon') {
      beaconBarEl.hidden = true
      return
    }
    beaconBarEl.hidden = false

    const pct = depletionPct(row)
    beaconBarEl.setAttribute('aria-valuenow', String(Math.round(pct)))
    if (beaconFillEl) beaconFillEl.style.width = `${pct}%`
  }

  function bucketFor(pct) {
    const high = Number(settings.meter_high_threshold_pct)
    const low = Number(settings.meter_low_threshold_pct)
    if (Number.isFinite(high) && pct >= high) return 'high'
    if (Number.isFinite(low) && pct >= low) return 'medium'
    return 'low'
  }

  function pickFirstMatchingRow(rows) {
    const targeting = window.__spectrumAi?.targeting
    const evaluate = typeof targeting?.evaluate === 'function' ? targeting.evaluate : null
    const buildContext =
      typeof targeting?.buildContext === 'function' ? targeting.buildContext : null
    const ctx = evaluate && buildContext ? buildContext() : null

    for (const row of rows) {
      if (row == null) continue
      if (!row.targetingTree) return row
      if (!evaluate || !ctx) continue
      const result = evaluate(row.targetingTree, ctx)
      const matched = Array.isArray(result) ? result[0] : result
      if (matched) return row
    }
    return null
  }

  function pickTier(qty, tiers) {
    if (!Array.isArray(tiers) || typeof qty !== 'number') return null
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i]
      if (qty >= t.min_stock && qty <= t.max_stock) return t
    }
    return null
  }

  function applyPulseInterval() {
    const ms = Number(settings.pulse_interval_ms)
    if (Number.isFinite(ms) && ms > 0) {
      root.style.setProperty(`--sai-${SNIPPET_ID}-pulse-duration`, `${ms}ms`)
    }
  }

  function hide() {
    root.setAttribute('data-spectrum-vis', 'off')
  }
  function show() {
    root.setAttribute('data-spectrum-vis', 'on')
  }

  function parseIsland(sel) {
    const scope = root.parentElement || document
    const el = scope.querySelector(sel) || document.querySelector(sel)
    if (!el) return null
    try {
      return JSON.parse(el.textContent || '')
    } catch (_e) {
      return null
    }
  }

  function subscribeVariantChange() {
    document.addEventListener(
      'variant:change',
      (e) => {
        const next = e?.detail && (e.detail.variant || e.detail)
        const id = next && (next.id || next.variantId)
        if (id != null) updateVariant(String(id))
      },
      false,
    )

    const idInputs = document.querySelectorAll(
      'form[action*="/cart/add"] input[name="id"], form[action*="/cart/add"] select[name="id"]',
    )
    for (const input of idInputs) {
      input.addEventListener(
        'change',
        () => {
          const value = input.value
          if (value) updateVariant(String(value))
        },
        false,
      )
    }

    const variantContainers = document.querySelectorAll(
      '[data-variant-id], .product-variant-id, [data-product-variant-id]',
    )
    if (variantContainers.length > 0 && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        for (let i = 0; i < variantContainers.length; i++) {
          const el = variantContainers[i]
          const id =
            el.getAttribute('data-variant-id') ||
            el.getAttribute('data-product-variant-id') ||
            el.textContent
          if (id && String(id).trim()) {
            updateVariant(String(id).trim())
            break
          }
        }
      })
      for (const el of variantContainers) {
        observer.observe(el, {
          attributes: true,
          attributeFilter: ['data-variant-id', 'data-product-variant-id'],
          childList: true,
          characterData: true,
          subtree: true,
        })
      }
    }
  }

  function updateVariant(nextId) {
    if (!nextId || nextId === currentVariantId) return
    currentVariantId = nextId
    hydrate()
  }
})()
