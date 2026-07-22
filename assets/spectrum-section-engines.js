/**
 * Shared section-engine runtime for the section library.
 *
 * One always-installed asset carrying three self-contained engines —
 * countdown, count-up, ticker — that any curated section can opt into by
 * emitting the family's stamp attribute on its instance root and a
 * `<script src="spectrum-section-engines.js" defer>`. The asset is installed
 * on every theme through the runtime-infra channel but only fetched on pages
 * that carry a consumer script tag.
 *
 * Two invariants make this asset safe to ship always-latest bytes against
 * installed-and-frozen section markup:
 *
 *   (a) Integer contract stamps. Each instance root carries an integer stamp
 *       (`data-sai-cd-engine="1"` etc). The engine holds a supported-set per
 *       family; an unknown / newer / non-integer stamp means "this engine
 *       can't drive that instance" — the instance is skipped and its SSR
 *       value stays on screen. Behaviour for a shipped stamp never changes;
 *       a breaking change is a new stamp. Mirrors the motion loader's
 *       `classifyMotionVersion` tier-C degrade.
 *
 *   (b) Append-only appearance boundary. The engines write ONLY text content,
 *       instance-scoped data attributes, and CSS custom properties. They never
 *       inject stylesheets and never set inline style properties — all
 *       appearance rules live in the consuming section's own CSS, keyed on the
 *       data attributes the engine flips. (This is why pause / expiry / hide
 *       are data-attribute state flips, not inline `style.display` /
 *       `animation-play-state` writes.)
 *
 * Kill switch: `window.__spectrumAi.sections.config.disabled === true` disables
 * every engine (absent = enabled — the motion `resolveKillSwitch` shape). A
 * killed or engine-absent page keeps its SSR render: countdown digits show the
 * authored start value and never tick, count-up shows final values, ticker
 * renders a static wrapped row.
 *
 * Runs in exactly one place: a browser DOM, loaded as a `<script src>` from a
 * merchant theme. No `typeof window` / `typeof document` guards (there is no
 * non-window path); IntersectionObserver / ResizeObserver / matchMedia ARE
 * feature-detected for legacy-browser degrade. Every consumer `<script>` tag
 * executes, so the IIFE opens with an idempotent boot guard.
 *
 * Test surface: when `globalThis.__SAI_TEST_HARNESS__ === true` the IIFE
 * exposes its pure helpers on `globalThis.__spectrumSectionEnginesTest`.
 * Production never sets the flag, so production never carries the global.
 */
;(() => {
  /**
   * Supported contract stamps per family. Append-only: adding a stamp is a
   * deliberate new-behaviour version, and old stamps are never dropped. An
   * instance whose stamp is not in its family set is skipped (SSR value stays).
   */
  const SUPPORTED_STAMPS = {
    cd: new Set([1]),
    countup: new Set([1]),
    ticker: new Set([1]),
  }

  const CD_SELECTOR = '[data-sai-cd-engine]'
  const COUNTUP_SELECTOR = '[data-sai-countup-engine]'
  const TICKER_SELECTOR = '[data-sai-ticker-engine]'

  const CD_INIT_FLAG = 'saiCdInit'
  const COUNTUP_INIT_FLAG = 'saiCountupInit'
  const TICKER_INIT_FLAG = 'saiTickerInit'

  const prefersReducedMotion = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  /**
   * Is `raw` a supported integer stamp for `family`? Missing attribute, a
   * non-integer, an out-of-set value (unknown / newer) all classify as
   * unsupported — the mirror of tier-C in the motion loader. `Number('')`,
   * `Number(null)` are 0, which is never in a supported set, so a blank or
   * absent stamp degrades safely.
   */
  function isStampSupported(raw, family) {
    const set = SUPPORTED_STAMPS[family]
    if (!set) return false
    const n = Number(raw)
    if (!Number.isInteger(n)) return false
    return set.has(n)
  }

  const pad2 = (n) => String(n).padStart(2, '0')

  /* ══════════════════ Countdown ══════════════════ */

  /** Milliseconds remaining, clamped at zero, broken into d/h/m/s. */
  function computeRemaining(targetMs, nowMs) {
    const total = Math.max(0, targetMs - nowMs)
    const seconds = Math.floor(total / 1000)
    return {
      total,
      days: Math.floor(seconds / 86400),
      hours: Math.floor((seconds % 86400) / 3600),
      minutes: Math.floor((seconds % 3600) / 60),
      seconds: seconds % 60,
    }
  }

  /**
   * End timestamp for a recurring daily / weekly window, or null when dormant.
   * Null when the schedule isn't configured, the anchor is still in the
   * future, or `now` sits in the gap between two occurrences. The active
   * window length is clamped to the cadence period, so an interval larger than
   * the period (e.g. 50h daily) acts as "always on" with a countdown that
   * resets at each period boundary.
   */
  function resolveRecurringEndAt(config, nowMs) {
    const { recurStartMs, intervalHours, cadence } = config
    if (!Number.isFinite(recurStartMs)) return null
    if (!Number.isFinite(intervalHours) || intervalHours <= 0) return null
    const period = cadence === 'weekly' ? 7 * 86_400_000 : 86_400_000
    const windowMs = Math.min(intervalHours * 3_600_000, period)
    if (nowMs < recurStartMs) return null
    const intoCurrent = (nowMs - recurStartMs) % period
    if (intoCurrent >= windowMs) return null
    return nowMs + (windowMs - intoCurrent)
  }

  /**
   * Resolve the countdown end timestamp for the instance's mode, or null when
   * the clock has no target (empty target string, non-positive duration,
   * dormant recurring window). `fixed_minutes` is fresh on every page load —
   * `now + minutes`, no anchor, no persistence.
   */
  function resolveCountdownTarget(config, nowMs) {
    if (config.mode === 'fixed_minutes') {
      const minutes = Number(config.durationMinutes)
      if (!Number.isFinite(minutes) || minutes <= 0) return null
      return nowMs + minutes * 60_000
    }
    if (config.mode === 'recurring') {
      return resolveRecurringEndAt(
        {
          recurStartMs: Date.parse(config.recurStartIso),
          intervalHours: Number(config.recurIntervalHours),
          cadence: config.recurCadence,
        },
        nowMs,
      )
    }
    // fixed_date (default). Empty / unparseable target → no clock.
    const t = Date.parse(config.targetIso)
    return Number.isFinite(t) ? t : null
  }

  /**
   * String presentation for the single-line formats (short / long / compact).
   * Cell formats (boxes / divider / minimal) are rendered per-unit instead —
   * see renderCountdown.
   */
  function formatCountdownString(parts, format, showSeconds) {
    const { days, hours, minutes, seconds } = parts
    if (format === 'long') {
      const out = []
      if (days > 0) out.push(`${days} day${days === 1 ? '' : 's'}`)
      if (hours > 0) out.push(`${hours} hour${hours === 1 ? '' : 's'}`)
      if (minutes > 0 || (days === 0 && hours === 0))
        out.push(`${minutes} minute${minutes === 1 ? '' : 's'}`)
      if (showSeconds && days === 0) out.push(`${seconds} second${seconds === 1 ? '' : 's'}`)
      return out.join(' ')
    }
    if (format === 'compact') {
      if (days > 0) {
        return showSeconds
          ? `${days}d ${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
          : `${days}d ${pad2(hours)}:${pad2(minutes)}`
      }
      return showSeconds
        ? `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
        : `${pad2(hours)}:${pad2(minutes)}`
    }
    // short (default)
    const out = []
    if (days > 0) out.push(`${days}d`)
    if (hours > 0 || days > 0) out.push(`${hours}h`)
    out.push(`${minutes}m`)
    if (showSeconds && days === 0) out.push(`${pad2(seconds)}s`)
    return out.join(' ')
  }

  /**
   * Paint the current parts into whatever markup the section emitted: per-unit
   * cells (`[data-sai-cd-unit]`) and/or a single-line text node
   * (`[data-sai-cd-text]`). Writes text content only.
   */
  function renderCountdown(root, parts, format, showSeconds) {
    for (const unit of ['days', 'hours', 'minutes', 'seconds']) {
      const cell = root.querySelector(`[data-sai-cd-unit="${unit}"]`)
      if (cell) cell.textContent = pad2(parts[unit])
    }
    const textEl = root.querySelector('[data-sai-cd-text]')
    if (textEl) textEl.textContent = formatCountdownString(parts, format, showSeconds)
  }

  function readCountdownConfig(root) {
    return {
      mode: root.getAttribute('data-sai-cd-mode') || 'fixed_date',
      targetIso: root.getAttribute('data-sai-cd-target') || '',
      durationMinutes: root.getAttribute('data-sai-cd-duration-min'),
      onZero: root.getAttribute('data-sai-cd-on-zero') || 'repeat',
      recurStartIso: root.getAttribute('data-sai-cd-recur-start') || '',
      recurIntervalHours: root.getAttribute('data-sai-cd-recur-interval-hours'),
      recurCadence: root.getAttribute('data-sai-cd-recur-cadence') || 'daily',
      showSeconds: root.getAttribute('data-sai-cd-show-seconds') !== 'false',
      format: root.getAttribute('data-sai-cd-format') || 'boxes',
      onExpire: root.getAttribute('data-sai-cd-on-expire') || 'hide',
      expireMessage: root.getAttribute('data-sai-cd-expire-message') || '',
    }
  }

  // The dismiss flag is the only piece of countdown state persisted client-side
  // (fixed_minutes + onZero=dismiss). Namespacing by instance id AND minutes
  // means editing the duration in Studio naturally resets every previously
  // dismissed visitor to a fresh timer.
  function dismissStorageKey(instanceId, minutes) {
    return `sai-section-cd-dismissed:${instanceId || 'default'}:${minutes}`
  }

  function resolveInstanceId(root) {
    const wrapper = root.closest('[data-spectrum-instance-id]')
    return wrapper?.getAttribute('data-spectrum-instance-id') || 'default'
  }

  function isDismissed(instanceId, minutes) {
    try {
      return window.localStorage.getItem(dismissStorageKey(instanceId, minutes)) === '1'
    } catch {
      return false
    }
  }

  function markDismissed(instanceId, minutes) {
    try {
      window.localStorage.setItem(dismissStorageKey(instanceId, minutes), '1')
    } catch {
      // Private browsing / quota — degrade to per-page-view behaviour.
    }
  }

  function setupCountdown(root) {
    const config = readCountdownConfig(root)
    const instanceId = resolveInstanceId(root)
    const durationMinutes = Number(config.durationMinutes)

    // A fixed_minutes visitor who dismissed a prior session stays dismissed:
    // no clock, no cells rewritten, SSR value simply sits there.
    if (
      config.mode === 'fixed_minutes' &&
      config.onZero === 'dismiss' &&
      isDismissed(instanceId, durationMinutes)
    ) {
      root.setAttribute('data-sai-cd-state', 'dismissed')
      return
    }

    let targetMs = resolveCountdownTarget(config, Date.now())
    // No target (empty date / dormant recurring window / zero duration): leave
    // the SSR value untouched — never fabricate a running clock.
    if (targetMs === null) return

    const applyExpiry = () => {
      if (config.onExpire === 'zeros') {
        renderCountdown(
          root,
          { total: 0, days: 0, hours: 0, minutes: 0, seconds: 0 },
          config.format,
          config.showSeconds,
        )
        root.setAttribute('data-sai-cd-state', 'expired')
        return
      }
      if (config.onExpire === 'message') {
        const msgEl = root.querySelector('[data-sai-cd-message]')
        if (msgEl) msgEl.textContent = config.expireMessage
        root.setAttribute('data-sai-cd-state', 'expired-message')
        return
      }
      root.setAttribute('data-sai-cd-state', 'expired-hidden')
    }

    const tick = () => {
      const parts = computeRemaining(targetMs, Date.now())
      if (parts.total > 0) {
        renderCountdown(root, parts, config.format, config.showSeconds)
        return
      }
      // Crossed zero. fixed_minutes/repeat snaps forward a fresh window and
      // keeps ticking; fixed_minutes/dismiss persists the flag; everything
      // else runs the configured expiry once.
      if (config.mode === 'fixed_minutes' && durationMinutes > 0 && config.onZero === 'repeat') {
        targetMs = Date.now() + durationMinutes * 60_000
        renderCountdown(
          root,
          computeRemaining(targetMs, Date.now()),
          config.format,
          config.showSeconds,
        )
        return
      }
      clearInterval(timer)
      if (config.mode === 'fixed_minutes' && config.onZero === 'dismiss') {
        markDismissed(instanceId, durationMinutes)
      }
      applyExpiry()
    }

    // Bind the interval before the first synchronous tick so an already-expired
    // target can clearInterval(timer) without reading it in its TDZ.
    const timer = setInterval(tick, 1000)
    tick()
  }

  /* ══════════════════ Count-up ══════════════════ */

  /**
   * Parse a merchant-authored stat string into its animatable parts.
   * "92%" → { prefix:'', value:92, suffix:'%', decimals:0, grouped:false }
   * "25,000+" → { prefix:'', value:25000, suffix:'+', decimals:0, grouped:true }
   * "$1,299.50" → { prefix:'$', value:1299.5, suffix:'', decimals:2, grouped:true }
   * Non-numeric input → value:null (caller renders it verbatim).
   */
  function parseCountTarget(raw) {
    const str = String(raw == null ? '' : raw)
    const match = str.match(/^(\D*?)([\d.,]+)(.*)$/)
    if (!match) return { prefix: '', value: null, suffix: str, decimals: 0, grouped: false }
    const [, prefix, numeric, suffix] = match
    const grouped = numeric.includes(',')
    const cleaned = numeric.replace(/,/g, '')
    const value = Number(cleaned)
    if (!Number.isFinite(value)) {
      return { prefix: '', value: null, suffix: str, decimals: 0, grouped: false }
    }
    const dot = cleaned.indexOf('.')
    const decimals = dot === -1 ? 0 : cleaned.length - dot - 1
    return { prefix, value, suffix, decimals, grouped }
  }

  function trimZeros(n, maxDecimals) {
    return Number(n.toFixed(maxDecimals)).toString()
  }

  function groupThousands(fixedStr) {
    const [intPart, fracPart] = fixedStr.split('.')
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return fracPart ? `${grouped}.${fracPart}` : grouped
  }

  /** Format a count tween value for display, honoring number_format. */
  function formatCountValue(n, format, decimals, grouped) {
    if (format === 'abbreviated') {
      const abs = Math.abs(n)
      if (abs >= 1e6) return `${trimZeros(n / 1e6, 1)}M`
      if (abs >= 1e3) return `${trimZeros(n / 1e3, 1)}K`
      return String(Math.round(n))
    }
    const fixed = format === 'integer' ? Math.round(n).toFixed(0) : n.toFixed(decimals)
    if (format === 'integer' || grouped) return groupThousands(fixed)
    return fixed
  }

  const easeOutCubic = (t) => 1 - (1 - t) ** 3

  function zeroStart(el) {
    const parsed = parseCountTarget(el.getAttribute('data-sai-count-target'))
    if (parsed.value === null) return el.textContent
    const format = el.getAttribute('data-sai-count-format') || 'auto'
    return (
      parsed.prefix + formatCountValue(0, format, parsed.decimals, parsed.grouped) + parsed.suffix
    )
  }

  function runCountUp(el, durationMs) {
    const raw = el.getAttribute('data-sai-count-target')
    const parsed = parseCountTarget(raw)
    const format = el.getAttribute('data-sai-count-format') || 'auto'
    if (parsed.value === null) return
    // 'auto' lands on the merchant's exact string so the animated result is
    // byte-identical to the server-rendered value (no end-of-count reformat
    // snap). 'integer' / 'abbreviated' are explicit reformat requests.
    const finalText =
      format === 'auto'
        ? raw
        : parsed.prefix +
          formatCountValue(parsed.value, format, parsed.decimals, parsed.grouped) +
          parsed.suffix
    if (prefersReducedMotion() || !durationMs || durationMs <= 0) {
      el.textContent = finalText
      return
    }
    const start = performance.now()
    const step = (now) => {
      const progress = Math.min(1, (now - start) / durationMs)
      const current = parsed.value * easeOutCubic(progress)
      el.textContent =
        parsed.prefix +
        formatCountValue(current, format, parsed.decimals, parsed.grouped) +
        parsed.suffix
      if (progress < 1) requestAnimationFrame(step)
      else el.textContent = finalText
    }
    requestAnimationFrame(step)
  }

  function setupCountUp(root) {
    const numbers = root.querySelectorAll('[data-sai-count-target]')
    if (numbers.length === 0) return
    const animate = root.getAttribute('data-sai-countup-animate') !== 'false'
    const duration = Number(root.getAttribute('data-sai-countup-duration')) || 2000
    if (!animate) return
    // Reset each number to its zero-start so the count visibly runs 0 → target
    // (SSR renders the final value for the no-JS / no-IO / reduced-motion case).
    for (const el of numbers) {
      if (!prefersReducedMotion()) el.textContent = zeroStart(el)
    }
    if (typeof IntersectionObserver === 'undefined') {
      for (const el of numbers) runCountUp(el, duration)
      return
    }
    const io = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          runCountUp(entry.target, duration)
          obs.unobserve(entry.target)
        }
      },
      { threshold: 0.4 },
    )
    for (const el of numbers) io.observe(el)
  }

  /* ══════════════════ Ticker ══════════════════ */

  /**
   * Marquee animation duration. `tickerSeconds` is "seconds for one
   * viewport-width of content to scroll past." The CSS animation translates
   * the two-copy track by -50% (one full copy width), so duration scales with
   * content length to keep pixels-per-second constant regardless of slide
   * count.
   */
  function computeDuration(tickerSeconds, copyWidth, viewportWidth) {
    if (!Number.isFinite(tickerSeconds) || tickerSeconds <= 0) return null
    if (!Number.isFinite(copyWidth) || copyWidth <= 0) return null
    if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return null
    return tickerSeconds * (copyWidth / viewportWidth)
  }

  function readNumberAttr(node, name, fallback) {
    const raw = node.getAttribute(name)
    if (raw === null || raw === '') return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  function readBoolAttr(node, name, fallback) {
    const value = node.getAttribute(name)
    if (value === 'true') return true
    if (value === 'false') return false
    return fallback
  }

  function setupTicker(root) {
    const viewport = root.querySelector('[data-sai-ticker-viewport]')
    const track = root.querySelector('[data-sai-ticker-track]')
    const firstCopy = root.querySelector('[data-sai-ticker-copy]')
    if (!viewport || !track || !firstCopy) return

    const pauseOnHover = readBoolAttr(root, 'data-sai-ticker-pause-on-hover', true)
    const reducedMotion =
      typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null

    // When natural content is shorter than the viewport, the duplicate-track
    // marquee would scroll empty space. Clone the ORIGINAL children snapshot
    // additively (1× per iteration) until the copy fills the viewport.
    // Snapshotting once matters: re-reading copy.children each iteration grows
    // the clone count exponentially (2,4,8…) and a zero-width child would lock
    // the page at 2^n clones before the safety cap.
    function fillCopiesToViewport() {
      const viewportWidth = viewport.getBoundingClientRect().width
      if (!viewportWidth) return
      const copies = root.querySelectorAll('[data-sai-ticker-copy]')
      for (const copy of copies) {
        const originals = Array.from(copy.children)
        if (originals.length === 0) continue
        // Measure the natural (1×) copy width ONCE. Reading getBoundingClientRect
        // inside an append loop forces a synchronous reflow every iteration
        // (layout thrash); measuring up front and appending in a single batch
        // reflows once. A zero-width copy means the children render at zero width
        // — bail rather than clone forever.
        const baseWidth = copy.getBoundingClientRect().width
        if (baseWidth <= 0) continue
        // Passes needed to cover the viewport: ceil(viewport / base) total,
        // minus the 1× already present. Capped at 32 (the old safety budget).
        const passesNeeded = Math.min(32, Math.ceil(viewportWidth / baseWidth) - 1)
        if (passesNeeded <= 0) continue
        const fragment = document.createDocumentFragment()
        for (let pass = 0; pass < passesNeeded; pass++) {
          for (const child of originals) {
            fragment.appendChild(child.cloneNode(true))
          }
        }
        copy.appendChild(fragment)
      }
    }

    function setDuration() {
      if (reducedMotion?.matches) return
      const tickerSeconds = readNumberAttr(root, 'data-sai-ticker-seconds', 30)
      const copyWidth = firstCopy.getBoundingClientRect().width
      const viewportWidth = viewport.getBoundingClientRect().width
      const duration = computeDuration(tickerSeconds, copyWidth, viewportWidth)
      if (duration === null) return
      // CSS custom property — the section's @keyframes rule reads it. Not an
      // inline appearance property, per the append-only appearance boundary.
      track.style.setProperty('--sai-ticker-duration', `${duration}s`)
    }

    fillCopiesToViewport()
    setDuration()

    // data-ready flips AFTER setDuration so the marquee starts at the right
    // speed instead of running at a CSS default and snap-restarting.
    root.setAttribute('data-ready', 'true')

    function onResize() {
      fillCopiesToViewport()
      setDuration()
    }
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(onResize)
      ro.observe(firstCopy)
      ro.observe(viewport)
    } else {
      window.addEventListener('resize', onResize)
    }

    const onMotionChange = () => {
      if (reducedMotion?.matches) {
        // Static strip: zero duration parks the marquee at frame 0.
        track.style.setProperty('--sai-ticker-duration', '0s')
      } else {
        setDuration()
      }
    }
    if (reducedMotion && typeof reducedMotion.addEventListener === 'function') {
      reducedMotion.addEventListener('change', onMotionChange)
    }
    onMotionChange()

    // Pause on focus / touch via a data-attribute flip (hover is pure CSS
    // `:hover`). The section CSS reads `[data-sai-ticker-paused="true"]` to
    // pause the animation — the engine never writes animation-play-state
    // inline, per the append-only appearance boundary.
    if (pauseOnHover) {
      const pause = () => root.setAttribute('data-sai-ticker-paused', 'true')
      const resume = () => root.removeAttribute('data-sai-ticker-paused')
      root.addEventListener('focusin', pause)
      root.addEventListener('focusout', resume)
      root.addEventListener('touchstart', pause, { passive: true })
      root.addEventListener('touchend', resume, { passive: true })
    }
  }

  /* ══════════════════ Test surface ══════════════════ */

  if (globalThis.__SAI_TEST_HARNESS__ === true) {
    globalThis.__spectrumSectionEnginesTest = {
      isStampSupported,
      computeRemaining,
      resolveRecurringEndAt,
      resolveCountdownTarget,
      formatCountdownString,
      dismissStorageKey,
      parseCountTarget,
      formatCountValue,
      groupThousands,
      easeOutCubic,
      computeDuration,
    }
  }

  /* ══════════════════ Boot ══════════════════ */

  // Idempotent boot guard: every consumer section emits its own
  // `<script src>` tag and each one executes (browsers cache the fetch, not
  // the execution). Only the first execution registers + boots.
  if (window.__spectrumSectionEngines) return
  window.__spectrumSectionEngines = { supportedStamps: SUPPORTED_STAMPS }

  // Kill switch — absent = enabled (the motion resolveKillSwitch shape).
  if (window.__spectrumAi?.sections?.config?.disabled === true) return

  function initFamily(selector, family, initFlag, setup) {
    for (const root of document.querySelectorAll(selector)) {
      if (root.dataset[initFlag] === 'true') continue
      // Skew gate: an instance stamped with a version this engine doesn't
      // support is skipped entirely — its SSR value stays on screen.
      if (!isStampSupported(root.getAttribute(selectorAttr(selector)), family)) continue
      root.dataset[initFlag] = 'true'
      setup(root)
    }
  }

  function selectorAttr(selector) {
    // '[data-sai-cd-engine]' → 'data-sai-cd-engine'
    return selector.slice(1, -1)
  }

  function boot() {
    initFamily(CD_SELECTOR, 'cd', CD_INIT_FLAG, setupCountdown)
    initFamily(COUNTUP_SELECTOR, 'countup', COUNTUP_INIT_FLAG, setupCountUp)
    initFamily(TICKER_SELECTOR, 'ticker', TICKER_INIT_FLAG, setupTicker)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
})()
