;(() => {
  if (window.__sai_qbpdp001_initialized__) return
  window.__sai_qbpdp001_initialized__ = true

  const SNIPPET_ID = 'qbpdp001'
  const TAG = 'sai-qbpdp001'
  const FEATURE_SLUG = 'quantity_bundles'

  function readJsonChild(node, attr) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]
      if (child.tagName === 'SCRIPT' && child.hasAttribute(attr)) {
        try {
          return JSON.parse(child.textContent || '{}')
        } catch (error) {
          console.warn(`[${SNIPPET_ID}] Invalid embedded JSON for ${attr}`, error)
          return null
        }
      }
    }
    return null
  }

  function normalizeProductData(raw) {
    const variants = Array.isArray(raw?.variants)
      ? raw.variants.map((variant) => ({
          id: String(variant.id),
          title: variant.title || 'Default',
          available: variant.available !== false,
          price: toCents(variant.price),
          compare_at_price: toCents(variant.compare_at_price),
          image_url: variant.image_url || '',
          image_alt: variant.image_alt || variant.title || '',
          options: Array.isArray(variant.options) ? variant.options.map(String) : [],
        }))
      : []
    const optionNames = Array.isArray(raw?.option_names)
      ? raw.option_names.map(String).filter(Boolean)
      : []
    return {
      product_id: raw?.product_id != null ? String(raw.product_id) : '',
      product_handle: raw?.product_handle || '',
      selected_variant_id: raw?.selected_variant_id != null ? String(raw.selected_variant_id) : '',
      currency_code: raw?.currency_code || '',
      option_names: optionNames,
      variants,
    }
  }

  function asBool(value, fallback) {
    if (value === true || value === false) return value
    if (value == null) return fallback
    if (typeof value === 'string') {
      if (value === 'true') return true
      if (value === 'false') return false
    }
    return fallback
  }

  // Snippet-instance config defaults (mirror meta.json props defaults).
  // Applied as a final fallback for any prop that arrives unset.
  function normalizeConfig(raw) {
    const r = raw || {}
    return {
      allow_variant_selection: asBool(r.allow_variant_selection, true),
      selected_card_style:
        r.selected_card_style === 'outline_border' ? 'outline_border' : 'highlight_background',
      show_overlay_callout: asBool(r.show_overlay_callout, false),
      overlay_callout_position:
        r.overlay_callout_position === 'top_right' ? 'top_right' : 'top_left',
      show_description: asBool(r.show_description, true),
      show_savings_callout: asBool(r.show_savings_callout, true),
      savings_format: r.savings_format === 'absolute' ? 'absolute' : 'percentage',
      show_bundle_price: asBool(r.show_bundle_price, true),
      show_mrp: asBool(r.show_mrp, true),
      show_mrp_strikethrough: asBool(r.show_mrp_strikethrough, true),
      show_per_unit_price: asBool(r.show_per_unit_price, false),
      sale_ends_at: typeof r.sale_ends_at === 'string' ? r.sale_ends_at : '',
      show_timer: asBool(r.show_timer, true),
      timer_type: (() => {
        if (r.timer_type === 'countdown_to_date') return 'countdown_to_date'
        if (r.timer_type === 'daily_weekly') return 'daily_weekly'
        return 'fixed_minutes'
      })(),
      // Clamp duration into the merchant-facing 0-9999 range. 0 (or any
      // invalid input) means "no timer" — same fallback semantic as an
      // empty sale_ends_at.
      timer_duration_minutes: (() => {
        const n = Number(r.timer_duration_minutes)
        if (!Number.isFinite(n)) return 0
        return Math.max(0, Math.min(9999, Math.floor(n)))
      })(),
      timer_fixed_minutes_behavior:
        r.timer_fixed_minutes_behavior === 'dismiss' ? 'dismiss' : 'repeat',
      timer_recurrence_start_at:
        typeof r.timer_recurrence_start_at === 'string' ? r.timer_recurrence_start_at : '',
      // Hard ceiling matches the meta.json bound (168 = one week). 0 / invalid
      // collapses to "no timer" via the lenient runtime fallback.
      timer_recurrence_interval_hours: (() => {
        const n = Number(r.timer_recurrence_interval_hours)
        if (!Number.isFinite(n)) return 0
        return Math.max(0, Math.min(168, Math.floor(n)))
      })(),
      timer_recurrence_cadence: r.timer_recurrence_cadence === 'weekly' ? 'weekly' : 'daily',
      timer_position: r.timer_position === 'inline' ? 'inline' : 'bottom_of_card',
      timer_prefix_text:
        typeof r.timer_prefix_text === 'string' && r.timer_prefix_text.trim().length > 0
          ? r.timer_prefix_text
          : 'Limited time offer',
      timer_tier_indexes: typeof r.timer_tier_indexes === 'string' ? r.timer_tier_indexes : '',
    }
  }

  // 1-based tier positions where the countdown banner should render. Out-of-range
  // and non-numeric entries are silently dropped — a merchant typing "1,2,3,4,5"
  // on a 3-tier bundle still renders cleanly on the existing three.
  function parseTimerTierIndexes(raw) {
    if (!raw || typeof raw !== 'string') return new Set()
    const out = new Set()
    for (const part of raw.split(',')) {
      const n = Number.parseInt(part.trim(), 10)
      if (Number.isInteger(n) && n >= 1) out.add(n)
    }
    return out
  }

  function parseTimerEndAt(raw) {
    if (!raw || typeof raw !== 'string') return null
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return null
    return d
  }

  // Resolves the snippet-instance id from the wrapper. Falls back to a
  // stable string so a missing wrapper attribute doesn't crash storage keys
  // — the dismiss flag would still scope by minutes in that case.
  function resolveInstanceId(host) {
    const wrapper = host.closest('[data-spectrum-instance-id]')
    return wrapper?.dataset?.spectrumInstanceId || 'default'
  }

  // The dismiss flag is the ONLY piece of timer state we persist client-side.
  // Including minutes in the key means editing the duration in Studio
  // naturally resets every previously-dismissed visitor to a fresh timer.
  function dismissStorageKey(host, minutes) {
    return `sai-qbpdp001-dismissed:${resolveInstanceId(host)}:${minutes}`
  }

  function isDismissed(host, minutes) {
    try {
      return window.localStorage.getItem(dismissStorageKey(host, minutes)) === '1'
    } catch {
      return false
    }
  }

  function markDismissed(host, minutes) {
    try {
      window.localStorage.setItem(dismissStorageKey(host, minutes), '1')
    } catch {
      // Private browsing / quota — degrade to per-page-view behaviour.
    }
  }

  // Computes the timer end-time based on the configured mode. For
  // countdown-to-date this is the merchant-picked datetime; for fixed-
  // minutes the countdown is fresh on every page load (no anchor, no
  // persistence) — `now + minutes * 60_000`. For daily / weekly the math
  // lives in resolveDailyWeeklyEndAt and only returns a Date while we're
  // inside an active occurrence's window.
  function resolveTimerEndAt(config) {
    if (config.timer_type === 'countdown_to_date') {
      return parseTimerEndAt(config.sale_ends_at)
    }
    if (config.timer_type === 'fixed_minutes') {
      if (config.timer_duration_minutes <= 0) return null
      return new Date(Date.now() + config.timer_duration_minutes * 60 * 1000)
    }
    if (config.timer_type === 'daily_weekly') {
      return resolveDailyWeeklyEndAt(config)
    }
    return null
  }

  // Computes the end-of-current-window for a recurring daily / weekly timer.
  // Returns null when the schedule isn't fully configured, when the start
  // datetime is still in the future, or when we're in the dormant gap
  // between two occurrences. Interval is clamped to the cadence period so
  // an over-spec'd interval (e.g. 50 hours daily) acts as "always on" with
  // a countdown that resets at each period boundary.
  function resolveDailyWeeklyEndAt(config) {
    const startAt = parseTimerEndAt(config.timer_recurrence_start_at)
    if (!startAt) return null
    const intervalHours = config.timer_recurrence_interval_hours
    if (!intervalHours || intervalHours <= 0) return null
    const period = config.timer_recurrence_cadence === 'weekly' ? 7 * 86_400_000 : 86_400_000
    const windowMs = Math.min(intervalHours * 3_600_000, period)
    const now = Date.now()
    const startMs = startAt.getTime()
    if (now < startMs) return null
    const intoCurrent = (now - startMs) % period
    if (intoCurrent >= windowMs) return null
    return new Date(now + (windowMs - intoCurrent))
  }

  function formatCountdown(remainingMs) {
    const totalSec = Math.max(0, Math.floor(remainingMs / 1000))
    const days = Math.floor(totalSec / 86400)
    const hours = Math.floor((totalSec % 86400) / 3600)
    const minutes = Math.floor((totalSec % 3600) / 60)
    const seconds = totalSec % 60
    const pad = (n) => String(n).padStart(2, '0')
    if (days > 0) {
      return `${pad(days)}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`
    }
    return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`
  }

  const NUMBER_WORDS = [
    '',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
  ]

  function tierDisplayLabel(tier) {
    const word = NUMBER_WORDS[tier.minQuantity]
    return word ? `Pack of ${word}` : `Pack of ${tier.minQuantity}`
  }

  function normalizeTiers(bundle) {
    const rewardTiers = Array.isArray(bundle?.reward?.tiers) ? bundle.reward.tiers : []
    const tiers = [
      {
        triggerType: 'QUANTITY',
        minQuantity: 1,
        discountValueType: 'NONE',
        discountPercentage: null,
        discountFixedAmount: null,
        discountFixedCurrencyCode: null,
        title: '1 Product',
        description: '',
        discountCode: null,
        badges: [],
        isBaseline: true,
      },
      ...rewardTiers
        .filter((tier) => tier?.triggerType === 'QUANTITY' && Number(tier.minQuantity) > 1)
        .map((tier) => ({
          ...tier,
          minQuantity: Number(tier.minQuantity),
          badges: Array.isArray(tier.badges) ? tier.badges : [],
          isBaseline: false,
        })),
    ]
    return tiers.sort((a, b) => a.minQuantity - b.minQuantity)
  }

  function isRenderableBundleContent(content) {
    if (!content || content.implementation !== 'volume_discount' || content.status !== 'active') {
      return false
    }
    const tiers = Array.isArray(content?.reward?.tiers) ? content.reward.tiers : []
    return tiers.some((tier) => tier?.triggerType === 'QUANTITY' && Number(tier.minQuantity) > 1)
  }

  function resolveInitialVariantId(productData, preselection) {
    const variants = productData.variants || []
    const available = variants.find((variant) => variant.available)
    const first = available || variants[0]
    if (!first) return ''

    if (preselection === 'first_available') return first.id

    const queryVariant = new URLSearchParams(window.location.search).get('variant')
    const preferredIds = [productData.selected_variant_id, queryVariant].filter(Boolean).map(String)
    for (const id of preferredIds) {
      const match = variants.find((variant) => variant.id === id && variant.available)
      if (match) return match.id
    }
    return first.id
  }

  function toCents(value) {
    if (value == null || value === '') return 0
    if (typeof value === 'number') return Math.round(value)
    const numeric = Number(String(value).replace(/[^\d.-]/g, ''))
    return Number.isFinite(numeric) ? Math.round(numeric) : 0
  }

  function parseAmountToCents(value) {
    if (value == null || value === '') return 0
    const numeric = Number(value)
    return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0
  }

  function formatMoney(cents) {
    const value = Math.max(0, cents) / 100
    const currency = (window.Shopify?.currency?.active || 'USD').toUpperCase()
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
      }).format(value)
    } catch {
      return `$${value.toFixed(2)}`
    }
  }

  function calculateTierPricing(tier, selectedVariants, activeCurrencyCode) {
    const subtotal = selectedVariants.reduce((sum, variant) => sum + (variant?.price || 0), 0)
    const compareAtSubtotal = selectedVariants.reduce((sum, variant) => {
      const compare = variant?.compare_at_price || 0
      const price = variant?.price || 0
      return sum + (compare > price ? compare : price)
    }, 0)

    let discountCents = 0
    if (tier.discountValueType === 'PERCENTAGE' && Number(tier.discountPercentage) > 0) {
      discountCents = Math.round((subtotal * Number(tier.discountPercentage)) / 100)
    } else if (tier.discountValueType === 'FIXED') {
      const tierCurrency = tier.discountFixedCurrencyCode
        ? String(tier.discountFixedCurrencyCode).toUpperCase()
        : ''
      const activeCurrency = activeCurrencyCode ? String(activeCurrencyCode).toUpperCase() : ''
      if (tierCurrency && tierCurrency !== activeCurrency) {
        discountCents = 0
      } else {
        discountCents = parseAmountToCents(tier.discountFixedAmount)
      }
    }
    discountCents = Math.min(discountCents, subtotal)
    const discountedTotal = Math.max(0, subtotal - discountCents)
    const savings = Math.max(0, compareAtSubtotal - discountedTotal)

    return {
      subtotal,
      compareAtSubtotal,
      discountCents,
      discountedTotal,
      savings,
      savingsPerUnit:
        selectedVariants.length > 0 ? Math.round(savings / selectedVariants.length) : 0,
    }
  }

  function buildCartLines(variantIds) {
    const counts = new Map()
    for (const id of variantIds) {
      if (!id) continue
      counts.set(id, (counts.get(id) || 0) + 1)
    }
    return [...counts.entries()].map(([id, quantity]) => ({ id, quantity }))
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => {
      switch (c) {
        case '&':
          return '&amp;'
        case '<':
          return '&lt;'
        case '>':
          return '&gt;'
        case '"':
          return '&quot;'
        default:
          return '&#39;'
      }
    })
  }

  function noopTrack(_name, _payload) {}
  function noopEmit(_name, _detail) {}

  function fireSafely(fn, name, payload) {
    try {
      fn(name, payload)
    } catch (error) {
      // Analytics must not break cart or selection behavior.
      console.warn(`[${SNIPPET_ID}] Analytics handler failed for ${name}`, error)
    }
  }

  function firstNonEmptyObject(...values) {
    for (const value of values) {
      if (value && typeof value === 'object' && Object.keys(value).length > 0) return value
    }
    return {}
  }

  if (!customElements.get(TAG)) {
    class SaiQuantityBundles extends HTMLElement {
      connectedCallback() {
        if (this._initialized) return
        const ready = () => !!this.querySelector('[data-role="root"]')
        if (ready()) {
          this._init()
          return
        }
        const obs = new MutationObserver(() => {
          if (ready()) {
            obs.disconnect()
            this._init()
          }
        })
        obs.observe(this, { childList: true, subtree: true })
      }

      _init() {
        if (this._initialized) return
        this._initialized = true
        this.rootEl = this.querySelector('[data-role="root"]')
        this.messageEl = this.querySelector('[data-role="message"]')
        // Heading is server-rendered and lives outside the root (which render()
        // clears on every pass). Cached so the inline timer can be positioned
        // above it without re-creating the title.
        this.headingEl = this.querySelector('[data-role="heading"]')
        this.containerEl = this.rootEl ? this.rootEl.parentNode : null
        this.bundle = null
        this.tiers = []
        this.diagnosticMessage = ''
        this.badgeImages = {}
        this.productData = normalizeProductData({})
        this.initialVariantId = ''
        this.selectedTierQty = 1
        this.selectionsByQty = new Map()
        this._track = noopTrack
        this._emit = noopEmit
        this._analyticsReady = false
        this._bundleImpressed = false
        this._impressedTiers = new Set()
        this._bundleObserver = null
        this._tierObserver = null
        this.modalOpen = false
        this.modalStep = 0
        this.modalSelectionsByTier = new Map()
        this.modalEl = null
        this._modalKeyHandler = (e) => {
          if (e.key === 'Escape' && this.modalOpen) this.closeModal()
        }
        this.config = normalizeConfig({})
        this._timerInterval = null
        this._timerEndAt = null
      }

      disconnectedCallback() {
        this._stopTimer()
      }

      setAnalytics(track, emit) {
        if (!this._initialized) this._init()
        this._track = typeof track === 'function' ? track : noopTrack
        this._emit = typeof emit === 'function' ? emit : noopEmit
        this._analyticsReady = true
        this._observeImpressions()
      }

      applyVariant(_presentation, content, badgeImages, productData, snippetConfig) {
        if (!this._initialized) this._init()
        this.config = normalizeConfig(snippetConfig || {})
        if (!isRenderableBundleContent(content)) {
          this.bundle = null
          this.tiers = []
          this.diagnosticMessage = 'Quantity bundle content is unavailable.'
          this.render()
          return
        }

        this.bundle = content
        this.diagnosticMessage = ''
        this.badgeImages = badgeImages || {}
        this.productData = normalizeProductData(productData || {})
        this.tiers = normalizeTiers(content)
        if (this.productData.variants.length === 0) {
          this.bundle = null
          this.tiers = []
          this.diagnosticMessage = 'Product variant data is unavailable.'
          this.render()
          return
        }
        this.initialVariantId = resolveInitialVariantId(
          this.productData,
          content.variantPreselection || 'pdp_selected_variant',
        )
        this.selectedTierQty = this.resolveDefaultTierQty(content.defaultTierMinQuantity || 1)
        this.selectionsByQty = new Map()
        for (const tier of this.tiers) this.ensureSelections(tier.minQuantity)
        this.render()
      }

      resolveDefaultTierQty(configuredQty) {
        const configured = this.tiers.find((tier) => tier.minQuantity === configuredQty)
        return configured ? configured.minQuantity : 1
      }

      variantById(id) {
        return this.productData.variants.find((variant) => variant.id === String(id))
      }

      firstAvailableVariantId() {
        return this.productData.variants.find((variant) => variant.available)?.id || ''
      }

      hasAvailableVariants() {
        return this.productData.variants.some((variant) => variant.available)
      }

      activeCurrencyCode() {
        return this.productData.currency_code || window.Shopify?.currency?.active || ''
      }

      selectionMode() {
        return this.bundle?.variantSelectionMode === 'uniform' ? 'uniform' : 'per_unit'
      }

      ensureSelections(quantity) {
        const mode = this.selectionMode()
        const size = mode === 'uniform' ? 1 : quantity
        const existing = this.selectionsByQty.get(quantity) || []
        const fallback = this.variantById(this.initialVariantId)?.available
          ? this.initialVariantId
          : this.firstAvailableVariantId()
        const next = []
        for (let i = 0; i < size; i++) {
          const current = existing[i]
          next.push(this.variantById(current)?.available ? current : fallback)
        }
        this.selectionsByQty.set(quantity, next)
        return next
      }

      expandedSelection(quantity) {
        const selections = this.ensureSelections(quantity)
        if (this.selectionMode() === 'uniform') {
          return Array.from({ length: quantity }, () => selections[0]).filter(Boolean)
        }
        return selections.filter(Boolean)
      }

      selectedVariants(quantity) {
        return this.expandedSelection(quantity)
          .map((id) => this.variantById(id))
          .filter(Boolean)
      }

      render() {
        if (!this.rootEl) return
        this.rootEl.textContent = ''
        this.hideMessage()

        if (this.diagnosticMessage) {
          this.showMessage('error', this.diagnosticMessage)
          return
        }

        if (!this.bundle || this.tiers.length === 0 || this.productData.variants.length === 0) {
          return
        }

        // Resolve timer state up front — inline placement renders ABOVE the
        // heading so the merchant gets the urgency cue before the product
        // title; bottom-of-card mode reads tier_indexes downstream.
        //
        // Timer expiry only ever removes the BANNER — never the surrounding
        // bundle. So a `fixed_minutes/dismiss` visitor who hit zero in a
        // previous session, a past `countdown_to_date`, or a `daily_weekly`
        // schedule sitting between occurrences all collapse to the same
        // result here: `_timerEndAt = null`, no banner rendered, bundle
        // continues to render normally.
        const isFixedDismissed =
          this.config.show_timer &&
          this.config.timer_type === 'fixed_minutes' &&
          this.config.timer_fixed_minutes_behavior === 'dismiss' &&
          isDismissed(this, this.config.timer_duration_minutes)
        this._timerEndAt =
          this.config.show_timer && !isFixedDismissed ? resolveTimerEndAt(this.config) : null
        const hasFutureTimer =
          this.config.show_timer &&
          this._timerEndAt !== null &&
          this._timerEndAt.getTime() > Date.now()
        const timerInline = hasFutureTimer && this.config.timer_position === 'inline'
        const timerIndexes =
          this.config.timer_position === 'bottom_of_card'
            ? parseTimerTierIndexes(this.config.timer_tier_indexes)
            : new Set()
        const showTimerOnTier = (i) =>
          hasFutureTimer &&
          this.config.timer_position === 'bottom_of_card' &&
          timerIndexes.has(i + 1)

        // The heading is server-rendered (see the Liquid). The inline timer
        // banner sits above it. Because the banner lives outside the root, the
        // root clear at the top of render() doesn't remove it — drop any banner
        // from a previous pass before inserting a fresh one so re-renders don't
        // stack timers.
        if (this.containerEl) {
          const staleInline = this.containerEl.querySelector('[data-role="inline-timer"]')
          if (staleInline) staleInline.remove()
        }
        if (timerInline && this.containerEl) {
          const banner = this.renderTimerBanner(true)
          banner.dataset.role = 'inline-timer'
          this.containerEl.insertBefore(banner, this.headingEl || this.rootEl)
        }

        if (!this.hasAvailableVariants()) {
          this.showMessage('error', 'This bundle is sold out.')
          this._observeImpressions()
          return
        }

        const list = document.createElement('ol')
        list.className = 'sai-qbpdp001__tiers'
        this.tiers.forEach((tier, i) => {
          list.appendChild(this.renderTier(tier, { showTimer: showTimerOnTier(i) }))
        })
        this.rootEl.appendChild(list)

        const selectedTier = this.tiers.find((tier) => tier.minQuantity === this.selectedTierQty)
        if (selectedTier) {
          this.rootEl.appendChild(this.renderButton(selectedTier))
        }

        this._observeImpressions()
        this._startTimer()
      }

      renderTier(tier, options) {
        const item = document.createElement('li')
        const button = document.createElement('button')
        button.type = 'button'
        const isSelected = tier.minQuantity === this.selectedTierQty
        const classes = ['sai-qbpdp001__tier']
        if (isSelected) classes.push('sai-qbpdp001__tier--selected')
        if (this.config.selected_card_style === 'outline_border') {
          classes.push('sai-qbpdp001__tier--style-outline')
        }
        if (this.config.show_overlay_callout) {
          classes.push('sai-qbpdp001__tier--callout-overlay')
          classes.push(
            `sai-qbpdp001__tier--callout-${this.config.overlay_callout_position.replace('_', '-')}`,
          )
        }
        button.className = classes.join(' ')
        button.dataset.tierQty = String(tier.minQuantity)
        button.setAttribute('aria-pressed', String(isSelected))
        button.addEventListener('click', () => {
          if (this.selectedTierQty === tier.minQuantity) return
          this.selectedTierQty = tier.minQuantity
          this.ensureSelections(tier.minQuantity)
          this.fire('tier_select', this.analyticsPayload(tier))
          this.render()
        })

        button.appendChild(this.renderThumbs(tier))

        const main = document.createElement('span')
        main.className = 'sai-qbpdp001__tier-main'
        const title = document.createElement('span')
        title.className = 'sai-qbpdp001__tier-title'
        title.textContent = tierDisplayLabel(tier)
        // Per-tier inline asset (e.g. coupon graphic) renders inline with the
        // title text. Sourced from `tier.inlineAsset.url` on the bundle
        // metaobject; absent => no image renders.
        const tierAsset = tier.inlineAsset
        if (tierAsset && typeof tierAsset.url === 'string' && tierAsset.url) {
          const assetImg = document.createElement('img')
          assetImg.className = 'sai-qbpdp001__tier-inline-asset'
          assetImg.src = tierAsset.url
          assetImg.alt = typeof tierAsset.alt === 'string' ? tierAsset.alt : ''
          assetImg.loading = 'lazy'
          title.appendChild(assetImg)
        }
        main.appendChild(title)
        if (this.config.show_description && tier.description) {
          const desc = document.createElement('span')
          desc.className = 'sai-qbpdp001__tier-description'
          desc.textContent = tier.description
          main.appendChild(desc)
        }

        button.appendChild(main)
        button.appendChild(this.renderPrice(tier))

        const badges = this.renderBadges(tier)
        if (badges) button.appendChild(badges)

        if (options?.showTimer) {
          button.appendChild(this.renderTimerBanner())
        }

        item.appendChild(button)
        return item
      }

      // Renders the countdown banner. In bottom-of-card mode it spans every
      // grid column of the tier card and lands as the last row; in inline mode
      // it is inserted into the container above the heading and uses --inline
      // styling (no card-bleed negative margins, full snippet width). Initial
      // textContent is populated immediately so there is no blank/flicker
      // before the first tick.
      renderTimerBanner(isInline) {
        const wrap = document.createElement(isInline ? 'div' : 'span')
        wrap.className = isInline
          ? 'sai-qbpdp001__timer sai-qbpdp001__timer--inline'
          : 'sai-qbpdp001__timer'

        const prefix = document.createElement('span')
        prefix.className = 'sai-qbpdp001__timer-prefix'
        prefix.textContent = this.config.timer_prefix_text
        wrap.appendChild(prefix)

        const countdown = document.createElement('span')
        countdown.className = 'sai-qbpdp001__timer-countdown'
        countdown.dataset.role = 'qb-countdown'
        if (this._timerEndAt) {
          countdown.textContent = formatCountdown(this._timerEndAt.getTime() - Date.now())
        } else {
          countdown.textContent = ''
        }
        wrap.appendChild(countdown)

        return wrap
      }

      _startTimer() {
        this._stopTimer()
        if (!this._timerEndAt) return
        if (this._timerEndAt.getTime() <= Date.now()) {
          // Past end-time at start (e.g. countdown_to_date with a past
          // sale_ends_at). hasFutureTimer was already false in render(), so
          // no banner was rendered — nothing to clean up here, just don't
          // start the interval. Bundle keeps rendering.
          return
        }
        this._timerInterval = window.setInterval(() => this._tickTimer(), 1000)
      }

      _stopTimer() {
        if (this._timerInterval != null) {
          window.clearInterval(this._timerInterval)
          this._timerInterval = null
        }
      }

      _tickTimer() {
        if (!this._timerEndAt) {
          this._stopTimer()
          return
        }
        const remaining = this._timerEndAt.getTime() - Date.now()
        // Cycle boundary fires one tick early so the displayed final tick is
        // "00h 00m 01s" — the 00s frame never paints. Repeat snaps the end-
        // time forward by one full cycle and lets the next tick render N:00
        // again. Dismiss + countdown_to_date + daily_weekly window-end all
        // converge on "remove the banner, leave the bundle visible"; dismiss
        // additionally persists a per-visitor flag so the banner stays gone
        // on subsequent loads.
        if (remaining <= 1000) {
          if (
            this.config.timer_type === 'fixed_minutes' &&
            this.config.timer_fixed_minutes_behavior === 'repeat' &&
            this.config.timer_duration_minutes > 0
          ) {
            this._timerEndAt = new Date(Date.now() + this.config.timer_duration_minutes * 60 * 1000)
            return
          }
          if (
            this.config.timer_type === 'fixed_minutes' &&
            this.config.timer_fixed_minutes_behavior === 'dismiss'
          ) {
            markDismissed(this, this.config.timer_duration_minutes)
          }
          this._removeTimerBanners()
          return
        }
        const text = formatCountdown(remaining)
        const nodes = this.querySelectorAll('[data-role="qb-countdown"]')
        for (const node of nodes) {
          node.textContent = text
        }
      }

      // Strip every rendered timer banner from the DOM and stop the tick
      // interval. The surrounding bundle (heading, tier cards, CTA) stays
      // visible — only the urgency cue goes away.
      _removeTimerBanners() {
        this._stopTimer()
        this._timerEndAt = null
        for (const node of this.querySelectorAll('.sai-qbpdp001__timer')) {
          node.remove()
        }
      }

      renderThumbs(tier) {
        const wrap = document.createElement('span')
        wrap.className = 'sai-qbpdp001__thumbs'
        const ids = this.expandedSelection(tier.minQuantity)
        const visibleIds = ids.slice(0, Math.min(ids.length, 4))
        visibleIds.forEach((id, index) => {
          const variant = this.variantById(id)
          const thumb = document.createElement('span')
          thumb.className =
            index > 0 ? 'sai-qbpdp001__thumb sai-qbpdp001__thumb--overlap' : 'sai-qbpdp001__thumb'
          if (variant?.image_url) {
            const img = document.createElement('img')
            img.className = 'sai-qbpdp001__thumb-image'
            img.src = variant.image_url
            img.alt = variant.image_alt || variant.title
            img.loading = 'lazy'
            thumb.appendChild(img)
          } else {
            thumb.classList.add('sai-qbpdp001__thumb--empty')
            thumb.textContent = variant?.title?.charAt(0) || '?'
          }
          wrap.appendChild(thumb)
        })
        return wrap
      }

      renderPrice(tier) {
        const selectedVariants = this.selectedVariants(tier.minQuantity)
        const pricing = calculateTierPricing(tier, selectedVariants, this.activeCurrencyCode())
        const config = this.bundle.priceDisplay || {}
        const wrap = document.createElement('span')
        wrap.className = 'sai-qbpdp001__price'

        const showBundlePrice = this.config.show_bundle_price && config.discountedTotal !== false
        const showMrp =
          this.config.show_mrp &&
          config.compareAtSubtotal !== false &&
          pricing.compareAtSubtotal > pricing.discountedTotal

        // Savings callout — sits at the top of the price column when on.
        if (this.config.show_savings_callout && pricing.savings > 0) {
          const savings = document.createElement('span')
          savings.className = 'sai-qbpdp001__price-note'
          let savingsText
          if (this.config.savings_format === 'percentage' && pricing.compareAtSubtotal > 0) {
            const pct = Math.round((pricing.savings / pricing.compareAtSubtotal) * 100)
            savingsText = `Save ${pct}%`
          } else {
            savingsText = `Save ${formatMoney(pricing.savings)}`
          }
          savings.textContent = savingsText
          wrap.appendChild(savings)
        }

        if (showMrp) {
          const compare = document.createElement('span')
          compare.className = 'sai-qbpdp001__price-compare'
          const mrpLabel = document.createElement('span')
          mrpLabel.className = 'sai-qbpdp001__price-compare-label'
          mrpLabel.textContent = 'MRP '
          const mrpValue = document.createElement('span')
          mrpValue.className = 'sai-qbpdp001__price-compare-value'
          if (this.config.show_mrp_strikethrough) {
            mrpValue.classList.add('sai-qbpdp001__price-compare-value--strike')
          }
          mrpValue.textContent = formatMoney(pricing.compareAtSubtotal)
          compare.appendChild(mrpLabel)
          compare.appendChild(mrpValue)
          wrap.appendChild(compare)
        }

        if (showBundlePrice) {
          const total = document.createElement('span')
          total.className = 'sai-qbpdp001__price-current'
          total.textContent = formatMoney(pricing.discountedTotal)
          wrap.appendChild(total)
        }

        if (this.config.show_per_unit_price && tier.minQuantity > 0) {
          const unitPriceCents = Math.round(pricing.discountedTotal / tier.minQuantity)
          const perUnit = document.createElement('span')
          perUnit.className = 'sai-qbpdp001__price-note'
          perUnit.textContent = `${formatMoney(unitPriceCents)} each`
          wrap.appendChild(perUnit)
          if (pricing.savingsPerUnit > 0) {
            const perUnitSavings = document.createElement('span')
            perUnitSavings.className = 'sai-qbpdp001__price-note'
            perUnitSavings.textContent = `${formatMoney(pricing.savingsPerUnit)} saved each`
            wrap.appendChild(perUnitSavings)
          }
        }

        return wrap
      }

      renderBadges(tier) {
        if (!Array.isArray(tier.badges) || tier.badges.length === 0) return null
        const wrap = document.createElement('span')
        wrap.className = 'sai-qbpdp001__badges'
        let rendered = 0
        for (const badge of tier.badges) {
          const badgeEl = document.createElement('span')
          badgeEl.className = 'sai-qbpdp001__badge'
          const image = badge.imageId ? this.badgeImages[badge.imageId] : null
          if (image?.url) {
            const img = document.createElement('img')
            img.className = 'sai-qbpdp001__badge-image'
            img.src = image.url
            img.alt = badge.alt || image.alt || ''
            img.loading = 'lazy'
            badgeEl.appendChild(img)
          }
          if (badge.label) {
            const label = document.createElement('span')
            label.textContent = badge.label
            badgeEl.appendChild(label)
          }
          if (!badgeEl.childNodes.length) continue
          wrap.appendChild(badgeEl)
          rendered++
        }
        return rendered > 0 ? wrap : null
      }

      renderButton(tier) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'sai-qbpdp001__button'
        button.textContent = this.bundle.ctaText || 'Add to cart'
        if (!this.hasAvailableVariants()) {
          button.disabled = true
          button.classList.add('sai-qbpdp001__button--disabled')
        }
        button.addEventListener('click', () => {
          if (this.config.allow_variant_selection) {
            this.openModal(tier)
          } else {
            // Skip the variant picker — add the currently-pre-filled selection
            // (default variants) × tier quantity straight to cart.
            this._performCartAdd(tier, button)
          }
        })
        return button
      }

      // Toggle the CTA's in-flight state: show a spinner (shared .sai-spinner)
      // in place of the label, disable the button, and flag aria-busy. The
      // label is stashed on a data attribute and restored when loading clears.
      _setButtonLoading(button, loading) {
        if (!button) return
        if (loading) {
          if (button.dataset.saiLabel == null) button.dataset.saiLabel = button.textContent
          button.disabled = true
          button.classList.add('sai-qbpdp001__button--disabled', 'sai-qbpdp001__button--loading')
          button.setAttribute('aria-busy', 'true')
          const spinner = document.createElement('span')
          spinner.className = 'sai-spinner sai-qbpdp001__spinner'
          spinner.setAttribute('aria-hidden', 'true')
          const label = document.createElement('span')
          label.textContent = button.dataset.saiLabel
          button.replaceChildren(spinner, label)
        } else {
          button.disabled = false
          button.classList.remove('sai-qbpdp001__button--disabled', 'sai-qbpdp001__button--loading')
          button.removeAttribute('aria-busy')
          button.textContent = button.dataset.saiLabel != null ? button.dataset.saiLabel : button.textContent
          delete button.dataset.saiLabel
        }
      }

      // Cart-add path used by the inline ATC when allow_variant_selection is
      // off. Mirrors _confirmCartFromModal but doesn't touch any modal state.
      async _performCartAdd(tier, button) {
        const variantIds = this.expandedSelection(tier.minQuantity)
        const selectedVariants = this.selectedVariants(tier.minQuantity)
        if (
          selectedVariants.length !== tier.minQuantity ||
          selectedVariants.some((v) => !v.available)
        ) {
          this.fire('add_to_cart_error', {
            ...this.analyticsPayload(tier),
            error_message: 'Unavailable or incomplete variant selection',
          })
          return
        }

        const lines = buildCartLines(variantIds)
        const payload = { ...this.analyticsPayload(tier), cart_lines: lines }
        this.fire('add_to_cart', payload)

        if (!window.Spectrum?.cart?.add) {
          this.fire('add_to_cart_error', {
            ...payload,
            error_message: 'Spectrum cart API unavailable',
          })
          return
        }

        this._setButtonLoading(button, true)
        try {
          const result = await window.Spectrum.cart.addAndOpen(lines, {
            sourceId: 'spectrum-qbpdp001',
          })
          if (result && result.ok === false) {
            throw new Error(result.error?.message || 'Add to cart failed')
          }
          this.fire('added_to_cart', payload)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.fire('add_to_cart_error', {
            ...payload,
            error_message: message || 'Add to cart failed',
          })
        } finally {
          this._setButtonLoading(button, false)
        }
      }

      // -- Variant option helpers ------------------------------------------

      optionNames() {
        const names = this.productData.option_names
        if (Array.isArray(names) && names.length > 0) return names
        const sample = this.productData.variants[0]?.options ?? []
        return sample.map((_, i) => `Option ${i + 1}`)
      }

      optionValueLists() {
        const names = this.optionNames()
        return names.map((_, idx) => {
          const values = new Set()
          for (const v of this.productData.variants) {
            const val = v.options[idx]
            if (val != null && val !== '') values.add(val)
          }
          return [...values]
        })
      }

      isOptionValueAvailable(optIdx, value) {
        return this.productData.variants.some((v) => v.available && v.options[optIdx] === value)
      }

      resolveVariantFromValues(values) {
        return this.productData.variants.find((variant) =>
          values.every((val, idx) => val != null && variant.options[idx] === val),
        )
      }

      // -- Modal state -----------------------------------------------------

      modalItemCount(tier) {
        return this.selectionMode() === 'uniform' ? 1 : tier.minQuantity
      }

      ensureModalSelections(tier) {
        const key = tier.minQuantity
        const itemCount = this.modalItemCount(tier)
        const names = this.optionNames()
        const optCount = names.length || 1
        const existing = this.modalSelectionsByTier.get(key)
        if (existing && existing.length === itemCount) {
          // Make sure each item has an array of the right length.
          for (const row of existing) {
            while (row.length < optCount) row.push(null)
          }
          return existing
        }
        // Pre-seed from existing committed selections so the modal opens with
        // the current tier-card variants pre-filled.
        const committed = this.selectionsByQty.get(key) || []
        const fresh = Array.from({ length: itemCount }, (_, i) => {
          const variantId = committed[i] || committed[0]
          const variant = this.variantById(variantId)
          if (!variant) return Array.from({ length: optCount }, () => null)
          return Array.from({ length: optCount }, (_, optIdx) => variant.options[optIdx] ?? null)
        })
        this.modalSelectionsByTier.set(key, fresh)
        return fresh
      }

      isModalItemComplete(tier, itemIdx) {
        const selections = this.ensureModalSelections(tier)
        const row = selections[itemIdx] || []
        const optCount = this.optionNames().length || 1
        if (row.length < optCount) return false
        if (row.some((v) => v == null || v === '')) return false
        const variant = this.resolveVariantFromValues(row)
        return !!variant?.available
      }

      areAllModalItemsComplete(tier) {
        const itemCount = this.modalItemCount(tier)
        for (let i = 0; i < itemCount; i++) {
          if (!this.isModalItemComplete(tier, i)) return false
        }
        return true
      }

      // -- Modal lifecycle -------------------------------------------------

      openModal(tier) {
        if (!this.hasAvailableVariants()) return
        this.modalOpen = true
        this.modalStep = 0
        this.modalActiveTier = tier
        this.ensureModalSelections(tier)
        document.addEventListener('keydown', this._modalKeyHandler)
        const prevOverflow = document.body.style.overflow
        if (!this._prevBodyOverflow) this._prevBodyOverflow = prevOverflow || ''
        document.body.style.overflow = 'hidden'
        this.renderModal()
      }

      closeModal() {
        this.modalOpen = false
        this.modalStep = 0
        this.modalActiveTier = null
        document.removeEventListener('keydown', this._modalKeyHandler)
        document.body.style.overflow = this._prevBodyOverflow || ''
        this._prevBodyOverflow = ''
        if (this.modalEl?.parentNode) {
          this.modalEl.parentNode.removeChild(this.modalEl)
        }
        this.modalEl = null
      }

      gotoModalStep(n) {
        const tier = this.modalActiveTier
        if (!tier) return
        const max = this.modalItemCount(tier) - 1
        this.modalStep = Math.max(0, Math.min(max, n))
        this._renderModalContents()
      }

      pickModalOption(itemIdx, optIdx, value) {
        const tier = this.modalActiveTier
        if (!tier) return
        if (!this.isOptionValueAvailable(optIdx, value)) {
          this.fire('sold_out_variant_click', {
            ...this.analyticsPayload(tier),
            option_index: optIdx,
            option_value: value,
            selector_index: itemIdx,
          })
          return
        }
        const selections = this.ensureModalSelections(tier)
        const row = selections[itemIdx]
        row[optIdx] = value
        // Sync the resolved variant ID back into selectionsByQty so the tier
        // card thumbs reflect the in-progress modal pick.
        const resolved = this.resolveVariantFromValues(row)
        if (resolved) {
          const committed = this.ensureSelections(tier.minQuantity)
          committed[itemIdx] = resolved.id
          this.selectionsByQty.set(tier.minQuantity, committed)
          this.fire('variant_select', {
            ...this.analyticsPayload(tier),
            variant_id: resolved.id,
            variant_title: resolved.title,
            selector_index: itemIdx,
          })
          // Update only the tier-card thumb for the affected tier (kept
          // outside the modal subtree, so no flicker risk).
          this._refreshTierThumbs(tier)
        }
        this._renderModalContents()
      }

      // Update only the thumb cluster on the active tier card. Avoids a full
      // `this.render()` which would rebuild every tier and tear down DOM the
      // modal isn't anchored to but still affects the page layout under it.
      _refreshTierThumbs(tier) {
        const tierEl = this.querySelector(
          `.sai-qbpdp001__tier[data-tier-qty="${tier.minQuantity}"]`,
        )
        if (!tierEl) return
        const existing = tierEl.querySelector('.sai-qbpdp001__thumbs')
        const fresh = this.renderThumbs(tier)
        if (existing && fresh) {
          existing.replaceWith(fresh)
        }
      }

      // -- Modal DOM rendering ---------------------------------------------

      // Build the modal overlay + sheet once per open. Animations on these
      // elements run exactly once. Inner contents (header / stepper / options /
      // footer) are swapped via _renderModalContents on every state change so
      // step transitions don't restart the slide-up / fade-in animations.
      _mountModalShell() {
        const overlay = document.createElement('div')
        overlay.className = 'sai-qbpdp001__modal'
        overlay.setAttribute('role', 'dialog')
        overlay.setAttribute('aria-modal', 'true')
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) this.closeModal()
        })

        const sheet = document.createElement('div')
        sheet.className = 'sai-qbpdp001__sheet'
        sheet.addEventListener('click', (e) => e.stopPropagation())

        overlay.appendChild(sheet)
        this.appendChild(overlay)
        this.modalEl = overlay
        this.modalSheetEl = sheet
      }

      renderModal() {
        if (!this.modalOpen || !this.modalActiveTier) return
        if (!this.modalEl || !this.modalEl.isConnected) this._mountModalShell()
        this._renderModalContents()
      }

      _renderModalContents() {
        if (!this.modalSheetEl || !this.modalActiveTier) return
        const tier = this.modalActiveTier
        const sheet = this.modalSheetEl
        // Clear inner content only — keep the overlay + sheet so their
        // mount-time animations don't re-trigger.
        sheet.textContent = ''

        // Header
        const header = document.createElement('div')
        header.className = 'sai-qbpdp001__modal-header'
        const title = document.createElement('h3')
        title.className = 'sai-qbpdp001__modal-title'
        title.textContent =
          this.modalItemCount(tier) === 1 ? 'Choose your variant' : 'Customize your pack'
        header.appendChild(title)
        const close = document.createElement('button')
        close.type = 'button'
        close.className = 'sai-qbpdp001__modal-close'
        close.setAttribute('aria-label', 'Close')
        close.textContent = '✕'
        close.addEventListener('click', () => this.closeModal())
        header.appendChild(close)
        sheet.appendChild(header)

        // Stepper (shown when there are 2+ items)
        if (this.modalItemCount(tier) > 1) {
          sheet.appendChild(this.renderStepper(tier))
        }

        // Option groups for the current step
        sheet.appendChild(this.renderModalOptions(tier))

        // Footer
        sheet.appendChild(this.renderModalFooter(tier))
      }

      renderStepper(tier) {
        const stepper = document.createElement('div')
        stepper.className = 'sai-qbpdp001__stepper'
        const itemCount = this.modalItemCount(tier)
        for (let i = 0; i < itemCount; i++) {
          const isDone = i < this.modalStep && this.isModalItemComplete(tier, i)
          const isCurrent = i === this.modalStep
          const node = document.createElement('div')
          node.className = 'sai-qbpdp001__step-node'
          const circle = document.createElement('div')
          const state = isDone ? 'done' : isCurrent ? 'current' : 'later'
          circle.className = `sai-qbpdp001__step-circle sai-qbpdp001__step-circle--${state}`
          circle.textContent = isDone ? '✓' : String(i + 1)
          const label = document.createElement('div')
          label.className = `sai-qbpdp001__step-label${isCurrent ? ' sai-qbpdp001__step-label--active' : ''}`
          label.textContent = `Item ${i + 1}`
          node.appendChild(circle)
          node.appendChild(label)
          stepper.appendChild(node)
          if (i < itemCount - 1) {
            // <span> not <div>: Dawn-like themes hide all `div:empty` via
            // base.css, which would collapse the connector to display:none.
            // <span> is excluded from that rule.
            const conn = document.createElement('span')
            conn.className = `sai-qbpdp001__step-conn${isDone ? ' sai-qbpdp001__step-conn--filled' : ''}`
            stepper.appendChild(conn)
          }
        }
        return stepper
      }

      renderModalOptions(tier) {
        const wrap = document.createElement('div')
        wrap.className = 'sai-qbpdp001__opt-groups'
        const itemIdx = this.modalStep
        const selections = this.ensureModalSelections(tier)
        const row = selections[itemIdx] || []
        const names = this.optionNames()
        const valueLists = this.optionValueLists()

        names.forEach((name, optIdx) => {
          const group = document.createElement('div')
          group.className = 'sai-qbpdp001__opt-group'

          const labelEl = document.createElement('div')
          labelEl.className = 'sai-qbpdp001__opt-label'
          const selectedValue = row[optIdx]
          labelEl.innerHTML = selectedValue
            ? `${name} — <span class="sai-qbpdp001__opt-label-value">${escapeHtml(selectedValue)}</span>`
            : name
          group.appendChild(labelEl)

          const pillRow = document.createElement('div')
          pillRow.className = 'sai-qbpdp001__pill-row'
          for (const value of valueLists[optIdx] || []) {
            const pill = document.createElement('button')
            pill.type = 'button'
            const isSelected = selectedValue === value
            const isAvail = this.isOptionValueAvailable(optIdx, value)
            const classes = ['sai-qbpdp001__pill']
            if (isSelected) classes.push('sai-qbpdp001__pill--selected')
            if (!isAvail) classes.push('sai-qbpdp001__pill--sold-out')
            pill.className = classes.join(' ')
            pill.textContent = isAvail ? value : `${value} — sold out`
            pill.setAttribute('aria-pressed', String(isSelected))
            pill.setAttribute('aria-disabled', String(!isAvail))
            pill.addEventListener('click', () => this.pickModalOption(itemIdx, optIdx, value))
            pillRow.appendChild(pill)
          }
          group.appendChild(pillRow)
          wrap.appendChild(group)
        })

        return wrap
      }

      renderModalFooter(tier) {
        const footer = document.createElement('div')
        footer.className = 'sai-qbpdp001__modal-footer'

        const itemCount = this.modalItemCount(tier)
        const isLast = this.modalStep === itemCount - 1
        const canProceed = this.isModalItemComplete(tier, this.modalStep)

        if (this.modalStep > 0) {
          const back = document.createElement('button')
          back.type = 'button'
          back.className = 'sai-qbpdp001__btn-back'
          back.textContent = '←'
          back.setAttribute('aria-label', 'Back')
          back.addEventListener('click', () => this.gotoModalStep(this.modalStep - 1))
          footer.appendChild(back)
        }

        const next = document.createElement('button')
        next.type = 'button'
        next.className = 'sai-qbpdp001__btn-next'
        next.disabled = !canProceed
        if (isLast) {
          const allOk = canProceed && this.areAllModalItemsComplete(tier)
          next.disabled = !allOk
          const pricing = calculateTierPricing(
            tier,
            this.selectedVariants(tier.minQuantity),
            this.activeCurrencyCode(),
          )
          next.textContent = `Add to cart — ${formatMoney(pricing.discountedTotal)}`
          next.addEventListener('click', () => this._confirmCartFromModal(tier, next))
        } else {
          next.textContent = `Next — Item ${this.modalStep + 2}`
          next.addEventListener('click', () => this.gotoModalStep(this.modalStep + 1))
        }
        footer.appendChild(next)

        return footer
      }

      // -- Cart add (modal-driven) -----------------------------------------

      async _confirmCartFromModal(tier, button) {
        const variantIds = this.expandedSelection(tier.minQuantity)
        const selectedVariants = this.selectedVariants(tier.minQuantity)
        if (
          selectedVariants.length !== tier.minQuantity ||
          selectedVariants.some((v) => !v.available)
        ) {
          this.fire('add_to_cart_error', {
            ...this.analyticsPayload(tier),
            error_message: 'Unavailable or incomplete variant selection',
          })
          return
        }

        const lines = buildCartLines(variantIds)
        const payload = {
          ...this.analyticsPayload(tier),
          cart_lines: lines,
        }
        this.fire('add_to_cart', payload)

        if (!window.Spectrum?.cart?.add) {
          this.fire('add_to_cart_error', {
            ...payload,
            error_message: 'Spectrum cart API unavailable',
          })
          this.closeModal()
          return
        }

        this._setButtonLoading(button, true)
        try {
          const result = await window.Spectrum.cart.addAndOpen(lines, {
            sourceId: 'spectrum-qbpdp001',
          })
          if (result && result.ok === false) {
            throw new Error(result.error?.message || 'Add to cart failed')
          }
          this.fire('added_to_cart', payload)
          this.closeModal()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.fire('add_to_cart_error', {
            ...payload,
            error_message: message || 'Add to cart failed',
          })
          this._setButtonLoading(button, false)
          this.closeModal()
        }
      }

      showMessage(state, message) {
        if (!this.messageEl) return
        this.messageEl.hidden = false
        this.messageEl.dataset.state = state
        this.messageEl.classList.remove(
          'sai-qbpdp001__message--error',
          'sai-qbpdp001__message--success',
        )
        this.messageEl.classList.add(`sai-qbpdp001__message--${state}`)
        this.messageEl.textContent = message
      }

      hideMessage() {
        if (!this.messageEl) return
        this.messageEl.hidden = true
        this.messageEl.textContent = ''
        this.messageEl.removeAttribute('data-state')
        this.messageEl.classList.remove(
          'sai-qbpdp001__message--error',
          'sai-qbpdp001__message--success',
        )
      }

      analyticsPayload(tier) {
        const variantIds = this.expandedSelection(tier.minQuantity)
        const selectedVariants = this.selectedVariants(tier.minQuantity)
        const pricing = calculateTierPricing(tier, selectedVariants, this.activeCurrencyCode())
        return {
          bundle_id: this.bundle?.bundleId,
          bundle_slug: this.bundle?.bundleSlug,
          bundle_variant_id: this.bundle?.bundleVariantId,
          tier_min_quantity: tier.minQuantity,
          tier_title: tier.title || null,
          variant_selection_mode: this.selectionMode(),
          selected_variant_ids: variantIds,
          cart_lines: buildCartLines(variantIds),
          estimated_subtotal_cents: pricing.subtotal,
          estimated_discount_cents: pricing.discountCents,
          estimated_total_cents: pricing.discountedTotal,
          estimated_savings_cents: pricing.savings,
          currency_code: this.activeCurrencyCode() || null,
          discount_code_present: Boolean(tier.discountCode),
        }
      }

      fire(event, payload) {
        const name = `${FEATURE_SLUG}:${event}`
        fireSafely(this._track, name, payload)
        fireSafely(this._emit, name, payload)
      }

      _observeImpressions() {
        if (!this._analyticsReady || !this.bundle) return
        this._observeBundleImpression()
        this._observeTierImpressions()
      }

      _observeBundleImpression() {
        if (this._bundleImpressed) return
        if (typeof window.IntersectionObserver !== 'function') {
          this._fireBundleImpression()
          return
        }
        if (this._bundleObserver) this._bundleObserver.disconnect()
        this._bundleObserver = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio >= 0.5)) {
              this._bundleObserver.disconnect()
              this._fireBundleImpression()
            }
          },
          { threshold: 0.5 },
        )
        this._bundleObserver.observe(this)
      }

      _fireBundleImpression() {
        if (this._bundleImpressed) return
        this._bundleImpressed = true
        this.fire('bundle_impression', {
          bundle_id: this.bundle?.bundleId,
          bundle_slug: this.bundle?.bundleSlug,
          bundle_variant_id: this.bundle?.bundleVariantId,
        })
      }

      _observeTierImpressions() {
        const tierNodes = Array.from(this.querySelectorAll('.sai-qbpdp001__tier'))
        if (typeof window.IntersectionObserver !== 'function') {
          for (const node of tierNodes) this._fireTierImpression(node)
          return
        }
        if (this._tierObserver) this._tierObserver.disconnect()
        this._tierObserver = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting || entry.intersectionRatio >= 0.5) {
                this._fireTierImpression(entry.target)
                this._tierObserver.unobserve(entry.target)
              }
            }
          },
          { threshold: 0.5 },
        )
        for (const node of tierNodes) this._tierObserver.observe(node)
      }

      _fireTierImpression(node) {
        const qty = Number(node.dataset.tierQty)
        if (!qty || this._impressedTiers.has(qty)) return
        const tier = this.tiers.find((item) => item.minQuantity === qty)
        if (!tier) return
        this._impressedTiers.add(qty)
        this.fire('tier_impression', this.analyticsPayload(tier))
      }
    }

    customElements.define(TAG, SaiQuantityBundles)
  }

  if (typeof globalThis !== 'undefined' && globalThis.__SAI_TEST_HARNESS__ === true) {
    globalThis.__saiQbpdp001 = {
      buildCartLines,
      calculateTierPricing,
      isRenderableBundleContent,
      normalizeProductData,
      normalizeTiers,
      readJsonChild,
      resolveInitialVariantId,
    }
  }

  function bindAllContainers() {
    const snippetApi = window.__spectrumAi?.snippet
    if (!snippetApi || typeof snippetApi.bind !== 'function') {
      console.warn(`[${SNIPPET_ID}] Spectrum snippet runtime unavailable; using embedded payload`)
      hydrateStandaloneContainers()
      return
    }
    const containers = document.querySelectorAll(
      `[data-spectrum-instance-id][data-spectrum-snippet-id="${SNIPPET_ID}"]`,
    )
    if (containers.length === 0) {
      hydrateStandaloneContainers()
      return
    }
    for (const node of containers) {
      const handles = snippetApi.bind(
        node,
        ({ variant, entry, pools, variants, currentVariantId }) => {
          const resolvedVariant =
            variant ??
            (Array.isArray(variants)
              ? variants.find((v) => v.variantId === currentVariantId)
              : null)
          hydrateContainer(node, {
            content: entry?.content,
            pools,
            presentation: resolvedVariant?.content,
          })
        },
      )
      const sai = node.querySelector(TAG)
      if (sai && handles) sai.setAnalytics(handles.track, handles.emit)
    }
  }

  function hydrateStandaloneContainers() {
    const nodes = new Set()
    for (const node of document.querySelectorAll(`[data-spectrum-snippet-id="${SNIPPET_ID}"]`)) {
      nodes.add(node)
    }
    for (const node of document.querySelectorAll(TAG)) {
      nodes.add(
        node.closest(`[data-spectrum-snippet-id="${SNIPPET_ID}"]`) || node.parentElement || node,
      )
    }
    for (const node of nodes) hydrateContainer(node, {})
  }

  function hydrateContainer(node, context) {
    const sai = node.matches?.(TAG) ? node : node.querySelector(TAG)
    if (!sai) return
    const readNode = node.matches?.(TAG) ? node.parentElement || node : node
    const pool = readJsonChild(readNode, 'data-spectrum-snippet-pool') || {}
    const bundle = context.content ?? readJsonChild(readNode, 'data-spectrum-quantity-bundle')
    const productData = readJsonChild(readNode, 'data-spectrum-product-variants')
    // Merge the Liquid JSON pool UNDER the SDK-provided presentation. Snippet
    // props (timer config, display toggles, …) live on the metaobject and
    // come in via `presentation`, but bundle-sourced fields (inline_asset,
    // anything else the Liquid resolves from bundle_content) only exist in
    // the JSON pool. Without merging, those fields silently drop whenever
    // presentation is non-empty.
    const fromPool = readJsonChild(readNode, 'data-spectrum-qbpdp-config') || {}
    const fromPresentation =
      context.presentation && Object.keys(context.presentation).length ? context.presentation : {}
    const snippetConfig = { ...fromPool, ...fromPresentation }
    const badgeImages = firstNonEmptyObject(pool.badge_images, context.pools?.badge_images)
    sai.applyVariant(context.presentation || {}, bundle, badgeImages, productData, snippetConfig)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindAllContainers, { once: true })
  } else {
    bindAllContainers()
  }
})()
