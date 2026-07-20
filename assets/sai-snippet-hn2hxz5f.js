/**
 * Product Gallery snippet runtime.
 *
 * Desktop: vertical image stack, zoom → lightbox.
 * Mobile: scroll-snap swipe with progress bar, zoom → lightbox.
 * Filters: bottom sheet (mobile) / dialog (desktop), Apply/Cancel.
 * Variant change: theme-agnostic via URL ?variant= observation.
 *
 * Analytics events:
 *   product_gallery:image_view       — swipe to new index (mobile)
 *   product_gallery:lightbox_open    — zoom tap opens lightbox
 *   product_gallery:lightbox_close   — lightbox closed (with dwell_ms)
 *   product_gallery:filter_open      — filter panel opened
 *   product_gallery:filter_apply     — filters applied (with active_filters)
 *   product_gallery:filter_clear     — filters cleared
 */
;(() => {
  if (window.__sai_hn2hxz5f_initialized__) return
  window.__sai_hn2hxz5f_initialized__ = true

  const SNIPPET_ID = 'hn2hxz5f'
  const TAG = 'sai-hn2hxz5f'
  const FEATURE_SLUG = 'product_gallery'
  const SLOT_SLUG = 'gallery'
  // Intentionally global (not product-scoped): filter selections persist across
  // PDP navigations so the user's preference carries to the next product.
  // _loadFilters validates stored values against each product's filterTags.
  // Single-instance-per-page assumption: only one PDP gallery renders per page.
  const FILTER_STORAGE_KEY = `spectrum:${FEATURE_SLUG}:filters`

  function readSnippetPool(node) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]
      if (child.tagName === 'SCRIPT' && child.hasAttribute('data-spectrum-snippet-pool')) {
        const text = child.textContent
        if (!text) return {}
        try {
          return JSON.parse(text)
        } catch (e) {
          return {}
        }
      }
    }
    return {}
  }

  function noopTrack() {}

  function safeTrack(fn) {
    return (...args) => {
      try {
        fn(...args)
      } catch (_) {
        /* analytics must never break the gallery */
      }
    }
  }

  function resolveSlot(pool, variantId) {
    const vs = pool.variantSlots || {}
    const ps = pool.productSlots || {}
    const vid = variantId != null ? String(variantId) : null
    const vSlots = vid ? vs[vid] : null
    if (vSlots?.[SLOT_SLUG]) return vSlots[SLOT_SLUG]
    if (ps[SLOT_SLUG]) return ps[SLOT_SLUG]
    return null
  }

  function resolveSlotVariant(slot) {
    if (!slot?.variants || !slot.variants.length) return null
    // Personalisation: return the first targeted variant whose targeting tree
    // matches the live shopper (author priority order), else the untargeted
    // default. Targeting is evaluated with the storefront SDK engine
    // (window.__spectrumAi.targeting) — the same one that resolves experience
    // and snippet-instance targeting. session.utm_source / cart.* are only
    // knowable client-side, so this runs here, never in Liquid; the default is
    // SSR-rendered and swapped once the engine has resolved.
    const engine = window.__spectrumAi && window.__spectrumAi.targeting
    let fallback = null
    for (const v of slot.variants) {
      if (!v.targeting) {
        if (!fallback) fallback = v
        continue
      }
      if (engine && typeof engine.evaluate === 'function') {
        try {
          const result = engine.evaluate(v.targeting)
          const matched = Array.isArray(result) ? result[0] : result
          if (matched) return v
        } catch (_err) {
          // A malformed tree or engine fault must never blank the gallery —
          // skip this variant and fall through to the default.
        }
      }
    }
    return fallback || slot.variants[0] || null
  }

  function resolveAssets(pool, handles) {
    const assets = pool.assets || {}
    const resolved = []
    for (const handle of handles) {
      const asset = assets[handle]
      if (asset?.url) {
        resolved.push(Object.assign({}, asset, { handle }))
      } else {
        resolved.push({ handle, type: 'unavailable', url: '', alt: '', tags: {} })
      }
    }
    return resolved
  }

  // ── Safe DOM builders ──

  const ICON_PLAY =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
  const ICON_PAUSE =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'
  const ICON_MUTED =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
  const ICON_UNMUTED =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.08"/></svg>'

  function createMediaElement(asset, loading, props) {
    if (asset.type === 'video') {
      const video = document.createElement('video')
      video.className = 'sai-hn2hxz5f__media'
      video.src = asset.url
      video.autoplay = props ? props.autoplayVideo : true
      video.muted = props ? props.autoplayVideo : true
      video.loop = true
      video.playsInline = true
      video.controls = false
      if (asset.thumb) video.poster = asset.thumb
      return video
    }
    const img = document.createElement('img')
    img.className = 'sai-hn2hxz5f__media'
    img.src = asset.url
    img.alt = asset.alt || ''
    img.loading = loading || 'lazy'
    if (asset.width) img.width = asset.width
    if (asset.height) img.height = asset.height
    return img
  }

  function createVideoControls(video) {
    const playBtn = document.createElement('button')
    playBtn.className = 'sai-hn2hxz5f__video-play'
    playBtn.type = 'button'
    playBtn.setAttribute('aria-label', 'Play/Pause')
    playBtn.innerHTML = ICON_PAUSE
    if (video.paused) {
      playBtn.innerHTML = ICON_PLAY
      playBtn.setAttribute('data-visible', '')
    }

    const muteBtn = document.createElement('button')
    muteBtn.className = 'sai-hn2hxz5f__video-mute'
    muteBtn.type = 'button'
    muteBtn.setAttribute('aria-label', 'Mute/Unmute')
    muteBtn.innerHTML = video.muted ? ICON_MUTED : ICON_UNMUTED
    muteBtn.setAttribute('data-visible', '')

    playBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (video.paused) {
        video.play()
      } else {
        video.pause()
      }
    })

    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      video.muted = !video.muted
      muteBtn.innerHTML = video.muted ? ICON_MUTED : ICON_UNMUTED
    })

    video.addEventListener('play', () => {
      playBtn.innerHTML = ICON_PAUSE
      playBtn.removeAttribute('data-visible')
    })
    video.addEventListener('pause', () => {
      playBtn.innerHTML = ICON_PLAY
      playBtn.setAttribute('data-visible', '')
    })

    return { playBtn, muteBtn }
  }

  function buildImageBlockEl(asset, index, isFirst, props) {
    const block = document.createElement('div')
    block.className = 'sai-hn2hxz5f__image-block'
    block.dataset.index = index
    block.dataset.handle = asset.handle

    if (asset.type === 'unavailable') {
      block.classList.add('sai-hn2hxz5f__image-block--unavailable')
      block.setAttribute('aria-hidden', 'true')
      return block
    }

    if (isFirst) block.classList.add('sai-hn2hxz5f__image-block--first')
    if (asset.type === 'video') block.classList.add('sai-hn2hxz5f__image-block--video')
    const media = createMediaElement(asset, isFirst ? 'eager' : 'lazy', props)
    block.appendChild(media)
    if (asset.type === 'video' && props?.showPlayPause !== false) {
      const { playBtn, muteBtn } = createVideoControls(media)
      block.appendChild(playBtn)
      block.appendChild(muteBtn)
    }
    if (isFirst) {
      const zoomBtn = document.createElement('button')
      zoomBtn.className = 'sai-hn2hxz5f__zoom'
      zoomBtn.type = 'button'
      zoomBtn.setAttribute('aria-label', 'Zoom image')
      zoomBtn.dataset.action = 'open-lightbox'
      zoomBtn.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 11h6M11 8v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
      block.appendChild(zoomBtn)

      const filterBtn = document.createElement('button')
      filterBtn.className = 'sai-hn2hxz5f__select-model'
      filterBtn.type = 'button'
      filterBtn.dataset.action = 'toggle-filters'
      filterBtn.setAttribute('aria-label', 'Select model')
      filterBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M3 6h18M7 12h10M10 18h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Select model'
      block.appendChild(filterBtn)
    }
    return block
  }

  function buildSlideEl(asset, index, isFirst, props) {
    const slide = document.createElement('div')
    slide.className = 'sai-hn2hxz5f__slide'
    slide.dataset.index = index

    if (asset.type === 'unavailable') {
      slide.classList.add('sai-hn2hxz5f__slide--unavailable')
      slide.setAttribute('aria-hidden', 'true')
      return slide
    }

    const media = createMediaElement(asset, isFirst ? 'eager' : 'lazy', props)
    media.className = 'sai-hn2hxz5f__slide-media'
    slide.appendChild(media)
    if (asset.type === 'video' && props?.showPlayPause !== false) {
      const { playBtn, muteBtn } = createVideoControls(media)
      slide.appendChild(playBtn)
      slide.appendChild(muteBtn)
    }
    return slide
  }

  function buildLightboxItemEl(asset) {
    if (asset.type === 'unavailable') return null
    if (asset.type === 'video') {
      const wrap = document.createElement('div')
      wrap.className = 'sai-hn2hxz5f__lightbox-video-wrap'
      const video = document.createElement('video')
      video.src = asset.url
      video.autoplay = true
      video.muted = true
      video.loop = true
      video.playsInline = true
      video.controls = false
      if (asset.thumb) video.poster = asset.thumb
      video.addEventListener('loadeddata', () => wrap.classList.add('sai-hn2hxz5f--loaded'), {
        once: true,
      })
      wrap.appendChild(video)
      const { playBtn, muteBtn } = createVideoControls(video)
      wrap.appendChild(playBtn)
      wrap.appendChild(muteBtn)
      return wrap
    }
    const img = document.createElement('img')
    img.src = asset.url
    img.alt = asset.alt || ''
    img.loading = 'lazy'
    if (asset.width) img.width = asset.width
    if (asset.height) img.height = asset.height
    img.addEventListener('load', () => img.classList.add('sai-hn2hxz5f--loaded'), { once: true })
    return img
  }

  // ── Filter logic ──

  function filterAssets(assets, activeFilters) {
    const keys = Object.keys(activeFilters)
    if (keys.length === 0) return assets
    return assets.filter((asset) => {
      if (asset.type === 'unavailable') return false
      const tags = asset.tags || {}
      return keys.every((key) => tags[key] === undefined || tags[key] === activeFilters[key])
    })
  }

  /**
   * Build a map of dimension -> entries from the filterTags declaration on a slot.
   * Handles both old format (string[]) and new format ({value, displayConfig}[]).
   * Prunes keys where no asset actually has that tag dimension.
   */
  function buildFilterTags(assets, rawFilterTags) {
    if (!rawFilterTags || typeof rawFilterTags !== 'object') return {}
    const result = {}
    for (const key of Object.keys(rawFilterTags)) {
      let hasKey = false
      for (const asset of assets) {
        if (asset.type !== 'unavailable' && asset.tags?.[key] !== undefined) {
          hasKey = true
          break
        }
      }
      if (!hasKey) continue
      const values = rawFilterTags[key]
      if (!Array.isArray(values) || values.length < 1) continue
      result[key] = values.map((v) =>
        typeof v === 'string' ? { value: v, displayConfig: null } : v,
      )
    }
    return result
  }

  if (!customElements.get(TAG)) {
    class SaiProductGallery extends HTMLElement {
      connectedCallback() {
        if (this._initialized) return
        this._initialized = true
        this._track = noopTrack
        this._analyticsReady = false
        this._activeIndex = 0
        this._assets = []
        this._filteredAssets = []
        this._activeFilters = {}
        this._pendingFilters = {}
        this._filterTags = {}
        this._pool = null
        this._currentVariantId = this.dataset.variantId || null

        this._props = {
          autoplay: this.dataset.autoplay === 'true',
          autoplayInterval: Number.parseInt(this.dataset.autoplayInterval, 10) || 5,
          swipeEnabled: this.dataset.swipeEnabled !== 'false',
          showZoomControls: this.dataset.showZoomControls !== 'false',
          autoplayVideo: this.dataset.autoplayVideo !== 'false',
          showPlayPause: this.dataset.showPlayPause !== 'false',
        }

        this._selfBootstrap()
        this._applyProps()
        this._initFilters()
        this._initMobile()
        this._initLightbox()
        this._initVariantObserver()
      }

      _applyProps() {
        if (!this._props.showZoomControls) {
          const zooms = this.querySelectorAll('.sai-hn2hxz5f__zoom')
          for (const z of zooms) z.style.display = 'none'
        }
        if (!this._props.swipeEnabled) {
          const track = this.querySelector('.sai-hn2hxz5f__track')
          if (track) {
            track.style.overflowX = 'hidden'
            track.style.touchAction = 'pan-y'
          }
        }
      }

      disconnectedCallback() {
        this._teardownVariantObserver()
        if (this._autoplayTimer) clearInterval(this._autoplayTimer)
      }

      setAnalytics(track) {
        this._track = typeof track === 'function' ? safeTrack(track) : noopTrack
        this._analyticsReady = true
      }

      applyVariant(presentation, slotContent, pool) {
        const content = presentation && typeof presentation === 'object' ? presentation : {}
        const resolvedPool =
          pool !== undefined
            ? pool
            : slotContent && typeof slotContent === 'object'
              ? slotContent
              : {}

        if (resolvedPool?.assets) {
          this._applyPool(resolvedPool)
          this._rebuildGallery()
        }
      }

      _selfBootstrap() {
        const container = this.parentElement
        if (!container) return
        const pool = readSnippetPool(container)
        if (pool?.assets) this._applyPool(pool)
      }

      _applyPool(pool) {
        this._pool = pool
        const slot = resolveSlot(pool, this._currentVariantId)
        const slotVariant = resolveSlotVariant(slot)
        if (slotVariant?.assets) {
          this._assets = resolveAssets(pool, slotVariant.assets)
          this._filteredAssets = this._assets.filter((a) => a.type !== 'unavailable')
        }
        this._filterTags = buildFilterTags(this._assets, slot ? slot.filterTags : null)
        this._activeFilters = this._loadFilters()
        this._pendingFilters = {}
        this._applyFilters()
        this._renderFilterControls()
      }

      // ── Filters ──

      _initFilters() {
        this.addEventListener('click', (e) => {
          if (e.target.closest('[data-action="toggle-filters"]')) {
            this._pendingFilters = Object.assign({}, this._activeFilters)
            this._renderFilterControls()
            this._openFilterPanel()
            this._track(`${FEATURE_SLUG}:filter_open`, {})
          }
        })

        document.addEventListener('click', (e) => {
          const dialog = this._filterDialog || this.querySelector('.sai-hn2hxz5f__filter-dialog')
          if (!dialog || !dialog.contains(e.target)) return

          if (e.target.closest('[data-action="close-filters"]')) {
            this._closeFilterPanel()
          }
          if (e.target.closest('[data-action="apply-filters"]')) {
            this._applyPendingFilters()
          }
          if (e.target.closest('[data-action="clear-filters"]')) {
            this._pendingFilters = {}
            this._activeFilters = {}
            this._applyFilters()
            this._saveFilters()
            this._closeFilterPanel()
            this._renderFilterControls()
            this._updateClearButton()
            this._track(`${FEATURE_SLUG}:filter_clear`, {})
          }

          const item = e.target.closest('.sai-hn2hxz5f__filter-card, .sai-hn2hxz5f__filter-pill')
          if (item) {
            const dim = item.dataset.filterKey
            const val = item.dataset.filterValue
            if (!dim) return
            if (this._pendingFilters[dim] === val) {
              delete this._pendingFilters[dim]
            } else {
              this._pendingFilters[dim] = val
            }
            this._updateFilterItems()
            this._updateClearButton()
          }
        })
      }

      _applyPendingFilters() {
        this._activeFilters = Object.assign({}, this._pendingFilters)
        this._applyFilters()
        this._saveFilters()
        this._closeFilterPanel()
        this._track(`${FEATURE_SLUG}:filter_apply`, {
          active_filters: Object.assign({}, this._activeFilters),
        })
      }

      _updateFilterItems() {
        const root = this._filterDialog || this
        const items = root.querySelectorAll(
          '.sai-hn2hxz5f__filter-card, .sai-hn2hxz5f__filter-pill',
        )
        for (const item of items) {
          const dim = item.dataset.filterKey
          const val = item.dataset.filterValue
          const isActive = this._pendingFilters[dim] === val
          if (item.classList.contains('sai-hn2hxz5f__filter-card')) {
            item.classList.toggle('sai-hn2hxz5f__filter-card--active', isActive)
          } else {
            item.classList.toggle('sai-hn2hxz5f__filter-pill--active', isActive)
          }
        }
        this._updateTabChecks()
      }

      _updateTabChecks() {
        const tabsContainer = this._filterDialog
          ? this._filterDialog.querySelector('.sai-hn2hxz5f__filter-tabs')
          : this.querySelector('.sai-hn2hxz5f__filter-tabs')
        if (!tabsContainer) return
        for (const tab of tabsContainer.querySelectorAll('.sai-hn2hxz5f__filter-tab')) {
          const dim = tab.dataset.filterTabDim
          const check = tab.querySelector('.sai-hn2hxz5f__filter-tab-check')
          if (check) check.textContent = this._pendingFilters[dim] ? '✓' : ''
        }
      }

      _updateClearButton() {
        const panel = this._filterDialog || this.querySelector('.sai-hn2hxz5f__filter-dialog')
        const clearBtn = panel
          ? panel.querySelector('.sai-hn2hxz5f__filter-panel-clear')
          : this.querySelector('.sai-hn2hxz5f__filter-panel-clear')
        if (clearBtn) {
          clearBtn.style.display = Object.keys(this._pendingFilters).length > 0 ? '' : 'none'
        }
      }

      _openFilterPanel() {
        const dialog = this.querySelector('.sai-hn2hxz5f__filter-dialog')
        if (!dialog) return
        this._filterDialog = dialog
        document.body.style.overflow = 'hidden'
        dialog.showModal()
        this._updateClearButton()

        if (!dialog._closeHandler) {
          dialog._closeHandler = (e) => {
            if (e.target === dialog) this._closeFilterPanel()
          }
          dialog.addEventListener('click', dialog._closeHandler)
        }
      }

      _closeFilterPanel() {
        const dialog = this._filterDialog || this.querySelector('.sai-hn2hxz5f__filter-dialog')
        if (!dialog) return
        dialog.close()
        document.body.style.overflow = ''
      }

      _renderFilterControls() {
        const panel = this._filterDialog || this.querySelector('.sai-hn2hxz5f__filter-dialog')
        const filtersContainer = panel
          ? panel.querySelector('.sai-hn2hxz5f__filters')
          : this.querySelector('.sai-hn2hxz5f__filters')
        const tabsContainer = panel
          ? panel.querySelector('.sai-hn2hxz5f__filter-tabs')
          : this.querySelector('.sai-hn2hxz5f__filter-tabs')
        const filterBtns = this.querySelectorAll('.sai-hn2hxz5f__select-model')
        if (!filtersContainer) return

        const dims = Object.entries(this._filterTags)
        if (dims.length === 0) {
          for (const btn of filterBtns) btn.removeAttribute('data-has-filters')
          return
        }
        for (const btn of filterBtns) btn.setAttribute('data-has-filters', '')

        const dcImages = this._pool?.displayConfigImages || {}

        /* Build tabs */
        if (tabsContainer) {
          tabsContainer.innerHTML = ''
          for (let i = 0; i < dims.length; i++) {
            const [dim] = dims[i]
            const tab = document.createElement('button')
            tab.className = 'sai-hn2hxz5f__filter-tab'
            if (i === 0) tab.classList.add('sai-hn2hxz5f__filter-tab--active')
            tab.type = 'button'
            tab.dataset.filterTabDim = dim
            tab.textContent = dim
            const check = document.createElement('span')
            check.className = 'sai-hn2hxz5f__filter-tab-check'
            check.textContent = ''
            tab.appendChild(check)
            tabsContainer.appendChild(tab)
          }

          tabsContainer.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('.sai-hn2hxz5f__filter-tab')
            if (!tabBtn) return
            const dim = tabBtn.dataset.filterTabDim
            if (!dim) return
            for (const t of tabsContainer.querySelectorAll('.sai-hn2hxz5f__filter-tab')) {
              t.classList.toggle('sai-hn2hxz5f__filter-tab--active', t.dataset.filterTabDim === dim)
            }
            const body = panel ? panel.querySelector('.sai-hn2hxz5f__filters') : filtersContainer
            if (body) {
              for (const c of body.querySelectorAll('.sai-hn2hxz5f__filter-content')) {
                c.classList.toggle(
                  'sai-hn2hxz5f__filter-content--active',
                  c.dataset.filterContentDim === dim,
                )
              }
            }
          })
        }

        /* Build content panels per dimension */
        filtersContainer.innerHTML = ''
        for (let i = 0; i < dims.length; i++) {
          const [dim, values] = dims[i]
          if (!Array.isArray(values) || values.length < 1) continue

          const content = document.createElement('div')
          content.className = 'sai-hn2hxz5f__filter-content'
          if (i === 0) content.classList.add('sai-hn2hxz5f__filter-content--active')
          content.dataset.filterContentDim = dim

          const hasVisual = values.some(
            (e) => e.displayConfig?.kind === 'image' || e.displayConfig?.kind === 'swatch',
          )

          if (hasVisual) {
            const grid = document.createElement('div')
            grid.className = 'sai-hn2hxz5f__filter-grid'

            for (const entry of values) {
              const val = entry.value
              const dc = entry.displayConfig
              const card = document.createElement('button')
              card.className = 'sai-hn2hxz5f__filter-card'
              card.type = 'button'
              card.dataset.filterKey = dim
              card.dataset.filterValue = val

              if (dc?.kind === 'image' && dc.value?.imageGid) {
                const img = document.createElement('img')
                img.className = 'sai-hn2hxz5f__filter-card-image'
                img.alt = val
                const imageUrl = dcImages[dc.value.imageGid]
                if (imageUrl) img.src = imageUrl
                card.appendChild(img)
              } else if (dc?.kind === 'swatch' && dc.value?.color) {
                const swatch = document.createElement('span')
                swatch.className = 'sai-hn2hxz5f__filter-card-swatch'
                swatch.style.backgroundColor = dc.value.color
                card.appendChild(swatch)
              }

              const label = document.createElement('span')
              label.className = 'sai-hn2hxz5f__filter-card-label'
              label.textContent = dc?.kind === 'text' && dc.value?.text ? dc.value.text : val
              card.appendChild(label)

              grid.appendChild(card)
            }

            content.appendChild(grid)
          } else {
            const pills = document.createElement('div')
            pills.className = 'sai-hn2hxz5f__filter-pills'

            for (const entry of values) {
              const val = entry.value
              const dc = entry.displayConfig
              const pill = document.createElement('button')
              pill.className = 'sai-hn2hxz5f__filter-pill'
              pill.type = 'button'
              pill.dataset.filterKey = dim
              pill.dataset.filterValue = val
              pill.textContent = dc?.kind === 'text' && dc.value?.text ? dc.value.text : val
              pills.appendChild(pill)
            }

            content.appendChild(pills)
          }

          filtersContainer.appendChild(content)
        }
      }

      _applyFilters() {
        this._filteredAssets = filterAssets(this._assets, this._activeFilters)
        if (this._filteredAssets.length === 0) {
          this._filteredAssets = this._assets
          this._activeFilters = {}
        }
        this._showGallery()
        this._rebuildGalleryWithAssets(this._filteredAssets)
      }

      _saveFilters() {
        try {
          if (Object.keys(this._activeFilters).length === 0) {
            localStorage.removeItem(FILTER_STORAGE_KEY)
          } else {
            localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(this._activeFilters))
          }
        } catch (_) {
          /* storage full or unavailable */
        }
      }

      _loadFilters() {
        try {
          const stored = localStorage.getItem(FILTER_STORAGE_KEY)
          if (!stored) return {}
          const filters = JSON.parse(stored)
          if (!filters || typeof filters !== 'object') return {}
          const valid = {}
          for (const [key, val] of Object.entries(filters)) {
            const entries = this._filterTags[key]
            if (!entries) continue
            const match = entries.some((e) => (typeof e === 'string' ? e === val : e.value === val))
            if (match) valid[key] = val
          }
          return valid
        } catch (_) {
          return {}
        }
      }

      _showGallery() {
        const desktop = this.querySelector('.sai-hn2hxz5f__desktop')
        const mobile = this.querySelector('.sai-hn2hxz5f__mobile')
        if (desktop) desktop.style.removeProperty('display')
        if (mobile) mobile.style.removeProperty('display')
      }

      // ── Mobile swipe progress ──

      _initMobile() {
        const track = this.querySelector('.sai-hn2hxz5f__track')
        if (!track) return
        let scrollTimeout
        track.addEventListener(
          'scroll',
          () => {
            clearTimeout(scrollTimeout)
            scrollTimeout = setTimeout(() => {
              const slideWidth = track.firstElementChild ? track.firstElementChild.offsetWidth : 1
              const newIndex = Math.round(track.scrollLeft / slideWidth)
              if (
                newIndex !== this._activeIndex &&
                newIndex >= 0 &&
                newIndex < this._filteredAssets.length
              ) {
                for (const v of track.querySelectorAll('video')) v.pause()
                const activeSlide = track.children[newIndex]
                const activeVideo = activeSlide?.querySelector('video')
                if (activeVideo && this._props.autoplayVideo) activeVideo.play().catch(() => {})
                this._activeIndex = newIndex
                this._updateProgress(newIndex)
                this._track(`${FEATURE_SLUG}:image_view`, { index: newIndex, source: 'swipe' })
              }
            }, 50)
          },
          { passive: true },
        )

        if (this._props.autoplay && this._filteredAssets.length > 1) {
          this._autoplayTimer = setInterval(() => {
            const count = this._filteredAssets.length
            if (count <= 1) return
            const next = (this._activeIndex + 1) % count
            this._activeIndex = next
            const slideWidth = track.firstElementChild ? track.firstElementChild.offsetWidth : 1
            track.scrollTo({ left: slideWidth * next, behavior: 'smooth' })
            this._updateProgress(next)
          }, this._props.autoplayInterval * 1000)
        }
      }

      _updateProgress(index) {
        const bar = this.querySelector('.sai-hn2hxz5f__progress-bar')
        const count = this._filteredAssets.length
        if (!bar || count <= 1) return
        bar.style.width = `${(index / (count - 1)) * 100}%`
      }

      // ── Lightbox ──

      _initLightbox() {
        this.addEventListener('click', (e) => {
          if (e.target.closest('[data-action="open-lightbox"]')) {
            this._openLightbox()
            return
          }

          // The whole gallery image is a zoom affordance, not just the zoom
          // button — a bare click on any media block (desktop stack or mobile
          // slide) opens the lightbox. Buttons/links are excluded so the filter
          // button and video play/mute keep their own behaviour; unavailable
          // placeholder blocks are skipped. Mobile swipe is native scroll,
          // which never fires click.
          const block = e.target.closest('.sai-hn2hxz5f__image-block, .sai-hn2hxz5f__slide')
          if (
            block &&
            !block.classList.contains('sai-hn2hxz5f__image-block--unavailable') &&
            !block.classList.contains('sai-hn2hxz5f__slide--unavailable') &&
            !e.target.closest('button, a')
          ) {
            this._openLightbox()
          }
        })
        const dialog = this.querySelector('.sai-hn2hxz5f__lightbox')
        const closeBtn = this.querySelector('[data-action="close-lightbox"]')
        if (!dialog) return
        if (closeBtn) closeBtn.addEventListener('click', () => this._closeLightbox())
        dialog.addEventListener('click', (e) => {
          if (e.target === dialog) this._closeLightbox()
        })
      }

      _openLightbox() {
        const dialog = this.querySelector('.sai-hn2hxz5f__lightbox')
        const scroll = this.querySelector('.sai-hn2hxz5f__lightbox-scroll')
        if (!dialog || !scroll) return
        const assets = this._filteredAssets.length > 0 ? this._filteredAssets : this._assets
        scroll.innerHTML = ''
        for (const asset of assets) {
          const el = buildLightboxItemEl(asset)
          if (el) scroll.appendChild(el)
        }
        document.body.style.overflow = 'hidden'
        requestAnimationFrame(() => {
          dialog.showModal()
          this._lightboxOpenTime = Date.now()
          this._track(`${FEATURE_SLUG}:lightbox_open`, { asset_count: assets.length })
        })
      }

      _closeLightbox() {
        const dialog = this.querySelector('.sai-hn2hxz5f__lightbox')
        if (!dialog) return
        for (const v of dialog.querySelectorAll('video')) v.pause()
        dialog.close()
        document.body.style.overflow = ''
        const dwell = this._lightboxOpenTime ? Date.now() - this._lightboxOpenTime : 0
        this._track(`${FEATURE_SLUG}:lightbox_close`, { dwell_ms: dwell })
      }

      // ── Variant change ──

      _initVariantObserver() {
        const checkVariant = () => {
          const params = new URLSearchParams(window.location.search)
          const variantId = params.get('variant')
          if (variantId && variantId !== this._currentVariantId) {
            this._currentVariantId = variantId
            this._onVariantChange(variantId)
          }
        }

        if (!window.__sai_hn2hxz5f_history_patched__) {
          window.__sai_hn2hxz5f_history_patched__ = true
          const origPush = history.pushState.bind(history)
          const origReplace = history.replaceState.bind(history)
          window.__sai_hn2hxz5f_variant_handlers__ = []
          history.pushState = (...args) => {
            origPush(...args)
            for (const h of window.__sai_hn2hxz5f_variant_handlers__) h()
          }
          history.replaceState = (...args) => {
            origReplace(...args)
            for (const h of window.__sai_hn2hxz5f_variant_handlers__) h()
          }
          window.addEventListener('popstate', () => {
            for (const h of window.__sai_hn2hxz5f_variant_handlers__) h()
          })
        }
        window.__sai_hn2hxz5f_variant_handlers__.push(checkVariant)
        this._checkVariant = checkVariant
      }

      _teardownVariantObserver() {
        if (this._checkVariant && window.__sai_hn2hxz5f_variant_handlers__) {
          const idx = window.__sai_hn2hxz5f_variant_handlers__.indexOf(this._checkVariant)
          if (idx !== -1) window.__sai_hn2hxz5f_variant_handlers__.splice(idx, 1)
        }
      }

      _onVariantChange(variantId) {
        if (!this._pool) return
        const slot = resolveSlot(this._pool, variantId)
        const slotVariant = resolveSlotVariant(slot)
        if (!slotVariant?.assets) return
        const assets = resolveAssets(this._pool, slotVariant.assets)
        if (assets.length === 0) return
        this._assets = assets
        this._activeFilters = {}
        this._pendingFilters = {}
        this._filterTags = buildFilterTags(this._assets, slot ? slot.filterTags : null)
        this._activeIndex = 0
        this._rebuildGallery()
        const empty = this.querySelector('.sai-hn2hxz5f__empty')
        if (empty) empty.style.display = 'none'
        this._showGallery()
      }

      _rebuildGallery() {
        this._filteredAssets = filterAssets(this._assets, this._activeFilters)
        this._renderFilterControls()
        this._rebuildGalleryWithAssets(this._filteredAssets)
      }

      _rebuildGalleryWithAssets(assets) {
        const desktop = this.querySelector('.sai-hn2hxz5f__desktop')
        if (desktop) {
          const blocks = desktop.querySelectorAll('.sai-hn2hxz5f__image-block')
          for (let i = blocks.length - 1; i >= 0; i--) blocks[i].remove()
          const frag = document.createDocumentFragment()
          for (let j = 0; j < assets.length; j++) {
            frag.appendChild(buildImageBlockEl(assets[j], j, j === 0, this._props))
          }
          desktop.appendChild(frag)
        }

        const track = this.querySelector('.sai-hn2hxz5f__track')
        if (track) {
          track.innerHTML = ''
          for (let k = 0; k < assets.length; k++) {
            track.appendChild(buildSlideEl(assets[k], k, k === 0, this._props))
          }
          track.scrollLeft = 0
        }
        this._activeIndex = 0
        this._updateProgress(0)
      }
    }
    customElements.define(TAG, SaiProductGallery)
  }

  // ── Bind ──

  function bindAllContainers() {
    const snippetApi = window.__spectrumAi?.snippet
    if (!snippetApi || typeof snippetApi.bind !== 'function') return
    const containers = document.querySelectorAll(
      `[data-spectrum-instance-id][data-spectrum-snippet-id="${SNIPPET_ID}"]`,
    )
    for (const node of containers) {
      const handles = snippetApi.bind(
        node,
        ({ variant, entry, pools, variants, currentVariantId }) => {
          const resolvedVariant = variant ?? variants?.find((v) => v.variantId === currentVariantId)
          if (!resolvedVariant?.content) return
          const root = node.querySelector(TAG)
          if (!root) return
          const snippetPool = readSnippetPool(node)
          root.applyVariant(resolvedVariant.content, entry?.content ?? {}, snippetPool)
        },
      )
      const root = node.querySelector(TAG)
      if (root && handles) root.setAnalytics(handles.track)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindAllContainers, { once: true })
  } else {
    bindAllContainers()
  }

  // ── Test harness export ──
  if (typeof globalThis !== 'undefined' && globalThis.__SAI_TEST_HARNESS__ === true) {
    globalThis.__saiHn2hxz5f = {
      readSnippetPool,
      safeTrack,
      resolveSlot,
      resolveSlotVariant,
      resolveAssets,
      filterAssets,
      buildFilterTags,
      createMediaElement,
      buildImageBlockEl,
      buildSlideEl,
      buildLightboxItemEl,
    }
  }
})()
