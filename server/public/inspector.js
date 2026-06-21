// inspector.js — IIFE injected at the end of <body>.
// Hover highlight, click selection, prompt popover, numbered pins, locator capture,
// click-driven view tracking, source-code clue gathering, and postMessage communication with the host.
(function () {
  if (window.__VP_ACTIVE__) return

  // Only run in the top-level proxy frame (ignore nested/child iframes)
  try {
    var fe = window.frameElement
    if (!fe || !/\bpage-frame\b/.test(fe.className || '')) return
  } catch (e) {
    return
  }
  window.__VP_ACTIVE__ = true

  var BASE = window.__VP_BASE__ || location.href
  var rw = window.__VP_RW__ || function (u) { return u }
  var unrw = window.__VP_UNRW__ || function (u) { return u }

  // ───────────────────────────────────────────── Overlay DOM + styles
  var style = document.createElement('style')
  style.textContent = [
    '.__vp_mode, .__vp_mode * { cursor: crosshair !important; }',
    '#__vp_hl { position: fixed; z-index: 2147483640; pointer-events: none; border: 2px solid #2563eb; background: rgba(37,99,235,.12); border-radius: 3px; display: none; }',
    '#__vp_tip { position: fixed; z-index: 2147483641; pointer-events: none; background: #111827; color: #fff; font: 11px/1.4 ui-monospace,monospace; padding: 3px 6px; border-radius: 4px; max-width: 360px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: none; }',
    '.__vp_pin { position: fixed; z-index: 2147483642; width: 22px; height: 22px; transform: translate(-50%,-100%); cursor: pointer; font-size: 16px; line-height: 22px; text-align: center; filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); }',
    '.__vp_pin .__vp_badge { position: absolute; top: -6px; right: -8px; background: #ef4444; color: #fff; font: 700 9px/14px sans-serif; min-width: 14px; height: 14px; border-radius: 8px; padding: 0 3px; }',
    '#__vp_pop { position: fixed; z-index: 2147483645; width: 320px; background: #fff; color: #111; border: 1px solid #d1d5db; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.25); font: 13px/1.4 system-ui,sans-serif; display: none; }',
    '#__vp_pop .__vp_sel { font: 11px/1.4 ui-monospace,monospace; background: #f3f4f6; padding: 6px 8px; border-radius: 6px; margin: 8px; word-break: break-all; max-height: 64px; overflow: auto; }',
    '#__vp_pop textarea { width: calc(100% - 16px); margin: 0 8px; box-sizing: border-box; min-height: 70px; resize: vertical; border: 1px solid #d1d5db; border-radius: 6px; padding: 6px; font: 13px/1.4 system-ui,sans-serif; }',
    '#__vp_pop .__vp_row { display: flex; gap: 6px; justify-content: flex-end; padding: 8px; }',
    '#__vp_pop button { font: 12px system-ui,sans-serif; padding: 5px 10px; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; cursor: pointer; }',
    '#__vp_pop button.__vp_save { background: #2563eb; color: #fff; border-color: #2563eb; }',
    '#__vp_pop button.__vp_del { background: #fee2e2; color: #b91c1c; border-color: #fca5a5; margin-right: auto; }',
  ].join('\n')
  document.documentElement.appendChild(style)

  var hl = el('div', { id: '__vp_hl' })
  var tip = el('div', { id: '__vp_tip' })
  document.documentElement.appendChild(hl)
  document.documentElement.appendChild(tip)

  function el(tag, attrs) {
    var n = document.createElement(tag)
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k])
    return n
  }

  // ───────────────────────────────────────────── Locators
  function cssPath(node) {
    if (!node || node.nodeType !== 1) return ''
    if (node.id) return '#' + cssEscape(node.id)
    var parts = []
    var cur = node
    while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 8) {
      var sel = cur.tagName.toLowerCase()
      if (cur.id) {
        parts.unshift('#' + cssEscape(cur.id))
        break
      }
      var parent = cur.parentNode
      if (parent) {
        var same = []
        var kids = parent.children || []
        for (var i = 0; i < kids.length; i++) {
          if (kids[i].tagName === cur.tagName) same.push(kids[i])
        }
        if (same.length > 1) {
          var idx = same.indexOf(cur) + 1
          sel += ':nth-of-type(' + idx + ')'
        }
      }
      parts.unshift(sel)
      cur = parent
    }
    return parts.join(' > ')
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s)
    return String(s).replace(/[^\w-]/g, '\\$&')
  }

  function xPath(node) {
    if (!node || node.nodeType !== 1) return ''
    if (node.id) return '//*[@id="' + node.id + '"]'
    var parts = []
    var cur = node
    while (cur && cur.nodeType === 1 && cur !== document.documentElement.parentNode) {
      var ix = 1
      var sib = cur.previousElementSibling
      while (sib) {
        if (sib.tagName === cur.tagName) ix++
        sib = sib.previousElementSibling
      }
      parts.unshift(cur.tagName.toLowerCase() + '[' + ix + ']')
      cur = cur.parentNode
      if (cur === document) break
    }
    return '/' + parts.join('/')
  }

  function describe(node) {
    var rect = node.getBoundingClientRect()
    var attrs = {}
    for (var i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i]
      attrs[a.name] = a.value
    }
    var text = (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120)
    return {
      tag: node.tagName.toLowerCase(),
      id: node.id || '',
      classes: (node.className && node.className.baseVal !== undefined
        ? node.className.baseVal
        : String(node.className || '')
      )
        .split(/\s+/)
        .filter(Boolean),
      selector: cssPath(node),
      xpath: xPath(node),
      text: text,
      attributes: attrs,
      rect: {
        x: Math.round(rect.left + window.scrollX),
        y: Math.round(rect.top + window.scrollY),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
    }
  }

  // ───────────────────────────────────────────── View-tracking state
  var vIdx = 0
  var lastClickInfo = null
  var lastClickAt = 0
  var mutCount = 0
  var clickMutBase = 0
  var lastViewKey = ''

  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      mutCount += (muts[i].addedNodes ? muts[i].addedNodes.length : 0)
      mutCount += (muts[i].removedNodes ? muts[i].removedNodes.length : 0)
    }
  }).observe(document.documentElement, { subtree: true, childList: true })

  function actionable(node) {
    var cur = node
    var hops = 0
    while (cur && cur.nodeType === 1 && hops < 8) {
      var tag = cur.tagName.toLowerCase()
      if (tag === 'a' || tag === 'button' || tag === 'summary') return cur
      var role = cur.getAttribute && cur.getAttribute('role')
      if (role && /^(button|tab|menuitem|link|option)$/.test(role)) return cur
      if (cur.hasAttribute && (cur.hasAttribute('onclick') || cur.hasAttribute('tabindex'))) return cur
      cur = cur.parentNode
      hops++
    }
    return node
  }

  function clickInfo(node) {
    if (!node || node.nodeType !== 1) return null
    return {
      tag: node.tagName.toLowerCase(),
      text: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      selector: cssPath(node),
      label:
        (node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title'))) || '',
    }
  }

  function headingText() {
    var h = document.querySelector('h1, h2, [role=heading]')
    return h ? (h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80) : ''
  }

  function upstreamUrl() {
    try {
      return new URL(location.pathname + location.search + location.hash, BASE).href
    } catch (e) {
      return BASE
    }
  }

  function detectFramework() {
    if (window.__NEXT_DATA__ || document.querySelector('#__next')) return 'next'
    if (window.__NUXT__) return 'nuxt'
    if (document.querySelector('[ng-version]')) return 'angular'
    if (window.__svelte || document.querySelector('[class*="svelte-"]')) return 'svelte'
    if (window.Vue || document.querySelector('[data-v-app]')) return 'vue'
    if (document.querySelector('[data-reactroot], #root, #app')) return 'react'
    return ''
  }

  function isApiUrl(u) {
    try {
      var url = new URL(u, location.href)
      var p = url.pathname
      if (/\.(js|mjs|css|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|ico|map)$/i.test(p)) return false
      if (/\.json($|\?)/i.test(u)) return true
      if (url.search) return true
      return /\/(api|graphql|rest|v\d+|rpc|trpc|query|data)\b/i.test(p)
    } catch (e) {
      return false
    }
  }

  function recentApiCalls(windowMs) {
    windowMs = windowMs || 8000
    var net = window.__VP_NET__ || []
    var now = performance.now()
    var out = []
    for (var i = net.length - 1; i >= 0 && out.length < 12; i--) {
      var n = net[i]
      if (now - n.t > windowMs) break
      if (!isApiUrl(n.url)) continue
      var p = n.url
      try { p = new URL(n.url, location.href).pathname } catch (e) {}
      out.push({ method: n.method, url: n.url, path: p })
    }
    return out
  }

  function bundleScripts() {
    var out = []
    var scripts = document.querySelectorAll('script[src]')
    for (var i = 0; i < scripts.length && out.length < 12; i++) {
      var src = unrw(scripts[i].getAttribute('src') || scripts[i].src)
      if (src && /\.js($|\?)/i.test(src)) out.push(src)
    }
    return out
  }

  var INTERESTING_DATA = /(testid|test|qa|cy|component|comp|name|id|view|page|route|track|section)/i

  function meaningfulClasses(node) {
    var cls = (node.className && node.className.baseVal !== undefined
      ? node.className.baseVal
      : String(node.className || '')
    ).split(/\s+/)
    var out = []
    for (var i = 0; i < cls.length; i++) {
      var c = cls[i]
      if (!c || c.length < 2 || c.length > 40) continue
      if (/^(vp-|__vp)/.test(c)) continue
      if (/^\d/.test(c) || /\d{5,}/.test(c)) continue
      if (/^css-[a-z0-9]+$/i.test(c)) continue
      out.push(c)
    }
    return out
  }

  function sourceClues(node) {
    var testids = [], components = [], classes = [], ids = [], labels = []
    var cur = node
    var hops = 0
    while (cur && cur.nodeType === 1 && hops < 6) {
      if (cur.attributes) {
        for (var i = 0; i < cur.attributes.length; i++) {
          var a = cur.attributes[i]
          if (/^data-/.test(a.name) && INTERESTING_DATA.test(a.name)) {
            if (/testid|test|qa|cy/i.test(a.name)) push(testids, a.value)
            else if (/component|comp/i.test(a.name)) push(components, a.value)
            else push(classes, a.name.replace(/^data-/, '') + ':' + a.value)
          }
        }
        if (cur.id) push(ids, cur.id)
        var nm = cur.getAttribute('name')
        if (nm) push(ids, nm)
        var al = cur.getAttribute('aria-label')
        if (al) push(labels, al)
        var role = cur.getAttribute('role')
        if (role) push(labels, 'role=' + role)
      }
      var mc = meaningfulClasses(cur)
      for (var j = 0; j < mc.length; j++) push(classes, mc[j])
      cur = cur.parentNode
      hops++
    }
    return {
      framework: detectFramework(),
      testids: testids,
      components: components,
      ids: ids,
      labels: labels,
      classes: classes.slice(0, 16),
      bundles: bundleScripts(),
      api: recentApiCalls(),
    }
  }

  function push(arr, v) {
    if (v == null) return
    v = String(v).trim()
    if (!v) return
    if (arr.indexOf(v) < 0) arr.push(v)
  }

  // ───────────────────────────────────────────── View reporting
  function postView(trigger, reason) {
    var title = document.title || ''
    var heading = headingText()
    var url = upstreamUrl()
    var key = title + '|' + heading + '|' + url
    if (key === lastViewKey) return
    lastViewKey = key
    send('view-change', {
      view: {
        index: ++vIdx,
        title: title,
        heading: heading,
        url: url,
        reason: reason,
        trigger: trigger || null,
        framework: detectFramework(),
        apiCalls: recentApiCalls(),
        at: Date.now(),
      },
    })
  }

  function recentClick() {
    return performance.now() - lastClickAt < 2000 ? lastClickInfo : null
  }

  function afterClickCheck() {
    if (mutCount - clickMutBase > 6) {
      postView(lastClickInfo, 'click')
    }
  }

  function trackNavClick(target) {
    lastClickInfo = clickInfo(actionable(target))
    lastClickAt = performance.now()
    clickMutBase = mutCount
    setTimeout(afterClickCheck, 450)
    setTimeout(afterClickCheck, 1000)
  }

  var titleEl = document.querySelector('title')
  if (titleEl) {
    new MutationObserver(function () {
      postView(recentClick(), 'title')
    }).observe(titleEl, { childList: true })
  }

  ;['pushState', 'replaceState'].forEach(function (name) {
    var orig = history[name]
    if (!orig) return
    history[name] = function () {
      var r = orig.apply(history, arguments)
      setTimeout(function () { postView(recentClick(), name.toLowerCase()) }, 0)
      return r
    }
  })
  window.addEventListener('popstate', function () { postView(recentClick(), 'popstate') })
  window.addEventListener('hashchange', function () { postView(recentClick(), 'hashchange') })

  // ───────────────────────────────────────────── Prompt mode + pins
  var promptMode = false
  var pinsVisible = true
  var pins = []
  var pop = null
  var popState = null

  function setMode(on) {
    promptMode = !!on
    document.documentElement.classList.toggle('__vp_mode', promptMode)
    if (!promptMode) {
      hl.style.display = 'none'
      tip.style.display = 'none'
    }
  }

  document.addEventListener(
    'mousemove',
    function (e) {
      if (!promptMode) return
      var t = e.target
      if (!t || t.nodeType !== 1 || isOverlay(t)) {
        hl.style.display = 'none'
        tip.style.display = 'none'
        return
      }
      var r = t.getBoundingClientRect()
      hl.style.display = 'block'
      hl.style.left = r.left + 'px'
      hl.style.top = r.top + 'px'
      hl.style.width = r.width + 'px'
      hl.style.height = r.height + 'px'
      tip.style.display = 'block'
      tip.textContent = cssPath(t)
      tip.style.left = r.left + 'px'
      tip.style.top = Math.max(0, r.top - 22) + 'px'
    },
    true,
  )

  function isOverlay(node) {
    return !!(node.closest && (node.closest('#__vp_pop') || node.closest('.__vp_pin') || node.id === '__vp_hl' || node.id === '__vp_tip'))
  }

  document.addEventListener(
    'click',
    function (e) {
      var t = e.target
      if (isOverlay(t)) return

      if (promptMode) {
        e.preventDefault()
        e.stopPropagation()
        openPopover(t, null)
        return
      }

      var a = t.closest && t.closest('a[href]')
      if (a) {
        var href = a.getAttribute('href') || ''
        if (href && !/^(#|javascript:)/i.test(href)) {
          e.preventDefault()
          var abs = unrw(a.href)
          try { abs = new URL(unrw(a.getAttribute('href')), BASE).href } catch (er) {}
          send('navigate', { url: abs })
          return
        }
      }
      trackNavClick(t)
    },
    true,
  )

  // ───────────────────────────────────────────── Popover
  function openPopover(node, existing) {
    closePopover()
    var d = describe(node)
    pop = el('div', { id: '__vp_pop' })
    var sel = el('div', { class: '__vp_sel' })
    sel.textContent = d.selector + '\n' + d.xpath
    var ta = el('textarea')
    ta.placeholder = 'Edit prompt for this element…'
    if (existing) ta.value = existing.item.prompt || ''
    var row = el('div', { class: '__vp_row' })

    if (existing) {
      var del = el('button', { class: '__vp_del' })
      del.textContent = 'Delete'
      del.onclick = function () { deletePin(existing.id); closePopover() }
      row.appendChild(del)
    }
    var cancel = el('button')
    cancel.textContent = 'Cancel'
    cancel.onclick = closePopover
    var save = el('button', { class: '__vp_save' })
    save.textContent = 'Save'
    save.onclick = function () { doSave(node, ta.value, existing) }
    row.appendChild(cancel)
    row.appendChild(save)

    pop.appendChild(sel)
    pop.appendChild(ta)
    pop.appendChild(row)
    document.documentElement.appendChild(pop)

    popState = { node: node }
    positionPopover()
    pop.style.display = 'block'
    ta.focus()

    ta.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); doSave(node, ta.value, existing) }
      else if (ev.key === 'Escape') { ev.preventDefault(); closePopover() }
    })
  }

  function positionPopover() {
    if (!pop || !popState) return
    var r = popState.node.getBoundingClientRect()
    var top = r.bottom + 6
    var left = r.left
    if (left + 320 > window.innerWidth) left = window.innerWidth - 328
    if (top + 200 > window.innerHeight) top = Math.max(6, r.top - 206)
    pop.style.left = Math.max(6, left) + 'px'
    pop.style.top = Math.max(6, top) + 'px'
  }

  function closePopover() {
    if (pop && pop.parentNode) pop.parentNode.removeChild(pop)
    pop = null
    popState = null
  }

  function doSave(node, text, existing) {
    text = (text || '').trim()
    if (!text) { closePopover(); return }
    if (existing) {
      existing.item.prompt = text
      send('prompt-updated', { id: existing.id, prompt: text })
    } else {
      var id = 'p_' + (++pinSeq)
      var d = describe(node)
      var item = { id: id, prompt: text, element: d, clues: sourceClues(node) }
      var pin = makePin(id, node, pins.length + 1)
      pins.push({ id: id, item: item, node: node, pinEl: pin })
      send('prompt-added', { id: id, prompt: text, element: d, clues: item.clues })
    }
    closePopover()
  }

  var pinSeq = 0

  function makePin(id, node, number) {
    var pin = el('div', { class: '__vp_pin' })
    pin.textContent = '📌'
    var badge = el('div', { class: '__vp_badge' })
    badge.textContent = String(number)
    pin.appendChild(badge)
    pin.dataset.vpId = id
    pin.onclick = function (e) {
      e.stopPropagation()
      var rec = findRec(id)
      if (rec) { send('selected', { id: id }); openPopover(rec.node, rec) }
    }
    document.documentElement.appendChild(pin)
    return pin
  }

  function findRec(id) {
    for (var i = 0; i < pins.length; i++) if (pins[i].id === id) return pins[i]
    return null
  }

  function deletePin(id) {
    var rec = findRec(id)
    if (!rec) return
    if (rec.pinEl && rec.pinEl.parentNode) rec.pinEl.parentNode.removeChild(rec.pinEl)
    pins = pins.filter(function (p) { return p.id !== id })
    renumber()
    send('prompt-deleted', { id: id })
  }

  function renumber() {
    for (var i = 0; i < pins.length; i++) {
      var b = pins[i].pinEl && pins[i].pinEl.querySelector('.__vp_badge')
      if (b) b.textContent = String(i + 1)
    }
  }

  // ───────────────────────────────────────────── rAF position-tracking loop
  function tick() {
    if (!pinsVisible) {
      for (var k = 0; k < pins.length; k++) if (pins[k].pinEl) pins[k].pinEl.style.display = 'none'
      requestAnimationFrame(tick)
      return
    }
    for (var i = 0; i < pins.length; i++) {
      var p = pins[i]
      if (!p.node || !document.contains(p.node)) {
        if (p.pinEl) p.pinEl.style.display = 'none'
        continue
      }
      var r = p.node.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) {
        p.pinEl.style.display = 'none'
        continue
      }
      p.pinEl.style.display = 'block'
      p.pinEl.style.left = (r.left + r.width - 4) + 'px'
      p.pinEl.style.top = (r.top + 14) + 'px'
    }
    if (popState && popState.node && document.contains(popState.node)) positionPopover()
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  // ───────────────────────────────────────────── Restore
  function restoreItem(item, retries) {
    retries = retries == null ? 12 : retries
    var node = locate(item.element)
    if (node) {
      var rec = findRec(item.id)
      if (rec) { rec.node = node; return }
      var pin = makePin(item.id, node, pins.length + 1)
      pins.push({ id: item.id, item: item, node: node, pinEl: pin })
      renumber()
      return
    }
    if (retries > 0) setTimeout(function () { restoreItem(item, retries - 1) }, 500)
  }

  function locate(desc) {
    if (!desc) return null
    if (desc.selector) {
      try { var n = document.querySelector(desc.selector); if (n) return n } catch (e) {}
    }
    if (desc.xpath) {
      try {
        var r = document.evaluate(desc.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
        if (r && r.singleNodeValue) return r.singleNodeValue
      } catch (e) {}
    }
    return null
  }

  function clearAll() {
    for (var i = 0; i < pins.length; i++) {
      if (pins[i].pinEl && pins[i].pinEl.parentNode) pins[i].pinEl.parentNode.removeChild(pins[i].pinEl)
    }
    pins = []
    closePopover()
  }

  // ───────────────────────────────────────────── Host communication
  function send(type, payload) {
    try {
      parent.postMessage(Object.assign({ source: 'vp', type: type }, payload || {}), '*')
    } catch (e) {}
  }

  window.addEventListener('message', function (e) {
    var d = e.data
    if (!d || d.source !== 'vp-host') return
    switch (d.type) {
      case 'set-mode':
        setMode(d.on)
        break
      case 'set-pins':
        pinsVisible = !!d.on
        break
      case 'focus': {
        var rec = findRec(d.id)
        if (rec && rec.node) {
          rec.node.scrollIntoView({ behavior: 'smooth', block: 'center' })
          flash(rec.node)
        }
        break
      }
      case 'edit': {
        var r2 = findRec(d.id)
        if (r2) openPopover(r2.node, r2)
        break
      }
      case 'delete':
        deletePin(d.id)
        break
      case 'restore':
        if (Array.isArray(d.items)) d.items.forEach(function (it) { restoreItem(it, 12) })
        break
      case 'clear':
        clearAll()
        break
    }
  })

  function flash(node) {
    var r = node.getBoundingClientRect()
    hl.style.display = 'block'
    hl.style.left = r.left + 'px'
    hl.style.top = r.top + 'px'
    hl.style.width = r.width + 'px'
    hl.style.height = r.height + 'px'
    setTimeout(function () { if (!promptMode) hl.style.display = 'none' }, 800)
  }

  window.addEventListener('resize', positionPopover)

  // ───────────────────────────────────────────── boot
  send('ready', { url: upstreamUrl(), title: document.title })
  postView(null, 'load')
  setTimeout(function () { postView(null, 'load') }, 1200)
})()
