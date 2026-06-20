// content.js — 실제 탭에 주입되는 수집기. (iframe/프록시 없이 원본 페이지에서 직접 동작)
// FAB 토글 → hover 하이라이트 → 클릭 팝오버 → 핀 → fixpoint 를 background 통해 VP 서버로 전송.
(function () {
  if (window.__VPX_ACTIVE__) return
  window.__VPX_ACTIVE__ = true

  // ───────────────────────────────────────────── locator
  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s)
    return String(s).replace(/[^\w-]/g, '\\$&')
  }
  function cssPath(node) {
    if (!node || node.nodeType !== 1) return ''
    if (node.id) return '#' + cssEscape(node.id)
    var parts = []
    var cur = node
    while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 8) {
      var sel = cur.tagName.toLowerCase()
      if (cur.id) { parts.unshift('#' + cssEscape(cur.id)); break }
      var parent = cur.parentNode
      if (parent) {
        var same = []
        var kids = parent.children || []
        for (var i = 0; i < kids.length; i++) if (kids[i].tagName === cur.tagName) same.push(kids[i])
        if (same.length > 1) sel += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')'
      }
      parts.unshift(sel)
      cur = parent
    }
    return parts.join(' > ')
  }
  function xPath(node) {
    if (!node || node.nodeType !== 1) return ''
    if (node.id) return '//*[@id="' + node.id + '"]'
    var parts = []
    var cur = node
    while (cur && cur.nodeType === 1 && cur !== document.documentElement.parentNode) {
      var ix = 1, sib = cur.previousElementSibling
      while (sib) { if (sib.tagName === cur.tagName) ix++; sib = sib.previousElementSibling }
      parts.unshift(cur.tagName.toLowerCase() + '[' + ix + ']')
      cur = cur.parentNode
      if (cur === document) break
    }
    return '/' + parts.join('/')
  }
  function describe(node) {
    var rect = node.getBoundingClientRect()
    var attrs = {}
    for (var i = 0; i < node.attributes.length; i++) attrs[node.attributes[i].name] = node.attributes[i].value
    var text = (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120)
    return {
      tag: node.tagName.toLowerCase(),
      id: node.id || '',
      classes: classList(node),
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
  function classList(node) {
    var raw = node.className && node.className.baseVal !== undefined ? node.className.baseVal : String(node.className || '')
    return raw.split(/\s+/).filter(Boolean)
  }

  // ───────────────────────────────────────────── clues
  function detectFramework() {
    if (window.__NEXT_DATA__ || document.querySelector('#__next')) return 'next'
    if (window.__NUXT__) return 'nuxt'
    if (document.querySelector('[ng-version]')) return 'angular'
    if (document.querySelector('[class*="svelte-"]')) return 'svelte'
    if (window.Vue || document.querySelector('[data-v-app]')) return 'vue'
    if (document.querySelector('[data-reactroot], #root, #app')) return 'react'
    return ''
  }
  var INTERESTING_DATA = /(testid|test|qa|cy|component|comp|name|id|view|page|route|track|section)/i
  function meaningfulClasses(node) {
    var out = []
    classList(node).forEach(function (c) {
      if (!c || c.length < 2 || c.length > 40) return
      if (/^__vpx/.test(c)) return
      if (/^\d/.test(c) || /\d{5,}/.test(c)) return
      if (/^css-[a-z0-9]+$/i.test(c)) return
      out.push(c)
    })
    return out
  }
  function push(arr, v) {
    if (v == null) return
    v = String(v).trim()
    if (v && arr.indexOf(v) < 0) arr.push(v)
  }
  function sourceClues(node) {
    var testids = [], components = [], classes = [], ids = [], labels = []
    var cur = node, hops = 0
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
        var nm = cur.getAttribute('name'); if (nm) push(ids, nm)
        var al = cur.getAttribute('aria-label'); if (al) push(labels, al)
        var role = cur.getAttribute('role'); if (role) push(labels, 'role=' + role)
      }
      meaningfulClasses(cur).forEach(function (c) { push(classes, c) })
      cur = cur.parentNode; hops++
    }
    return {
      framework: detectFramework(),
      testids: testids, components: components, ids: ids, labels: labels,
      classes: classes.slice(0, 16),
      bundles: bundleScripts(),
      api: recentApiCalls(),
    }
  }
  function bundleScripts() {
    var out = []
    var s = document.querySelectorAll('script[src]')
    for (var i = 0; i < s.length && out.length < 12; i++) {
      var src = s[i].getAttribute('src') || s[i].src
      if (src && /\.js($|\?)/i.test(src)) out.push(src)
    }
    return out
  }
  // PerformanceObserver 로 API 호출 수집 (shim 없이)
  var API = []
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        if (e.initiatorType === 'xmlhttprequest' || e.initiatorType === 'fetch') {
          API.push({ url: e.name, t: e.startTime })
          if (API.length > 100) API.shift()
        }
      })
    }).observe({ type: 'resource', buffered: true })
  } catch (e) {}
  function isApiUrl(u) {
    try {
      var url = new URL(u, location.href), p = url.pathname
      if (/\.(js|mjs|css|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|ico|map)$/i.test(p)) return false
      if (/\.json($|\?)/i.test(u)) return true
      if (url.search) return true
      return /\/(api|graphql|rest|v\d+|rpc|trpc|query|data)\b/i.test(p)
    } catch (e) { return false }
  }
  function recentApiCalls() {
    var out = []
    for (var i = API.length - 1; i >= 0 && out.length < 12; i--) {
      if (!isApiUrl(API[i].url)) continue
      var p = API[i].url
      try { p = new URL(API[i].url, location.href).pathname } catch (e) {}
      out.push({ method: 'GET', url: API[i].url, path: p })
    }
    return out
  }

  // ───────────────────────────────────────────── 오버레이
  var hl = mk('div', '__vpx_hl', true)
  var tip = mk('div', '__vpx_tip', true)
  var fab = mk('button', '__vpx_fab', true)
  fab.textContent = '📌'
  fab.title = 'VisualPrompt 수집 모드'
  var toast = mk('div', '__vpx_toast', true)
  function mk(tag, id, attach) {
    var n = document.createElement(tag)
    n.id = id
    if (attach) document.documentElement.appendChild(n)
    return n
  }
  function showToast(text, ms) {
    toast.textContent = text
    toast.classList.add('show')
    clearTimeout(showToast._t)
    showToast._t = setTimeout(function () { toast.classList.remove('show') }, ms || 2200)
  }

  var mode = false
  function setMode(on) {
    mode = !!on
    document.documentElement.classList.toggle('__vpx_mode', mode)
    fab.classList.toggle('on', mode)
    if (!mode) { hl.style.display = 'none'; tip.style.display = 'none' }
    showToast(mode ? '수집 모드 ON — 요소를 클릭하세요' : '수집 모드 OFF')
  }
  fab.addEventListener('click', function (e) { e.stopPropagation(); setMode(!mode) })

  function isOverlay(n) {
    return !!(n.closest && (n.closest('#__vpx_pop') || n.closest('.__vpx_pin') || n.id === '__vpx_fab' ||
      n.id === '__vpx_hl' || n.id === '__vpx_tip' || n.id === '__vpx_toast'))
  }

  document.addEventListener('mousemove', function (e) {
    if (!mode) return
    var t = e.target
    if (!t || t.nodeType !== 1 || isOverlay(t)) { hl.style.display = 'none'; tip.style.display = 'none'; return }
    var r = t.getBoundingClientRect()
    hl.style.display = 'block'
    hl.style.left = r.left + 'px'; hl.style.top = r.top + 'px'
    hl.style.width = r.width + 'px'; hl.style.height = r.height + 'px'
    tip.style.display = 'block'
    tip.textContent = cssPath(t)
    tip.style.left = r.left + 'px'; tip.style.top = Math.max(0, r.top - 22) + 'px'
  }, true)

  document.addEventListener('click', function (e) {
    if (!mode) return
    var t = e.target
    if (isOverlay(t)) return
    e.preventDefault(); e.stopPropagation()
    openPopover(t)
  }, true)

  // ───────────────────────────────────────────── 팝오버 + 핀
  var pop = null, popNode = null, pins = [], pinSeq = 0
  function openPopover(node) {
    closePopover()
    var d = describe(node)
    pop = mk('div', '__vpx_pop')
    var sel = document.createElement('div'); sel.className = '__vpx_sel'; sel.textContent = d.selector + '\n' + d.xpath
    var ta = document.createElement('textarea'); ta.placeholder = '이 요소에 적용할 수정 프롬프트…'
    var row = document.createElement('div'); row.className = '__vpx_row'
    var cancel = document.createElement('button'); cancel.textContent = '취소'; cancel.onclick = closePopover
    var save = document.createElement('button'); save.className = '__vpx_save'; save.textContent = '저장'
    save.onclick = function () { doSave(node, ta.value) }
    row.appendChild(cancel); row.appendChild(save)
    pop.appendChild(sel); pop.appendChild(ta); pop.appendChild(row)
    document.documentElement.appendChild(pop)
    popNode = node
    positionPopover()
    pop.style.display = 'block'
    ta.focus()
    ta.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); doSave(node, ta.value) }
      else if (ev.key === 'Escape') { ev.preventDefault(); closePopover() }
    })
  }
  function positionPopover() {
    if (!pop || !popNode) return
    var r = popNode.getBoundingClientRect()
    var top = r.bottom + 6, left = r.left
    if (left + 320 > window.innerWidth) left = window.innerWidth - 328
    if (top + 200 > window.innerHeight) top = Math.max(6, r.top - 206)
    pop.style.left = Math.max(6, left) + 'px'
    pop.style.top = Math.max(6, top) + 'px'
  }
  function closePopover() {
    if (pop && pop.parentNode) pop.parentNode.removeChild(pop)
    pop = null; popNode = null
  }

  function doSave(node, text) {
    text = (text || '').trim()
    if (!text) { closePopover(); return }
    var d = describe(node)
    var clues = sourceClues(node)
    var id = 'px_' + (++pinSeq)
    addPin(id, node)
    closePopover()
    sendFixpoint({
      prompt: text,
      page: location.href,
      element: d,
      clues: clues,
      view: { title: document.title, heading: headingText(), url: location.href },
      target: { mode: 'extension', url: location.href },
    })
  }
  function headingText() {
    var h = document.querySelector('h1, h2, [role=heading]')
    return h ? (h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80) : ''
  }

  function addPin(id, node) {
    var pin = mk('div', '')
    pin.className = '__vpx_pin'
    pin.textContent = '📌'
    var badge = document.createElement('div'); badge.className = '__vpx_badge'; badge.textContent = String(pins.length + 1)
    pin.appendChild(badge)
    document.documentElement.appendChild(pin)
    pins.push({ id: id, node: node, pinEl: pin })
  }

  function tick() {
    for (var i = 0; i < pins.length; i++) {
      var p = pins[i]
      if (!p.node || !document.contains(p.node)) { p.pinEl.style.display = 'none'; continue }
      var r = p.node.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) { p.pinEl.style.display = 'none'; continue }
      p.pinEl.style.display = 'block'
      p.pinEl.style.left = (r.left + r.width - 4) + 'px'
      p.pinEl.style.top = (r.top + 14) + 'px'
    }
    if (pop && popNode && document.contains(popNode)) positionPopover()
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  window.addEventListener('resize', positionPopover)

  // ───────────────────────────────────────────── 서버 전송
  function sendFixpoint(payload) {
    showToast('전송 중…')
    try {
      chrome.runtime.sendMessage({ type: 'vp-fixpoint', payload: payload }, function (resp) {
        if (chrome.runtime.lastError) { showToast('전송 실패: ' + chrome.runtime.lastError.message, 3500); return }
        if (resp && resp.ok) showToast('✅ 적재됨: ' + (resp.result && resp.result.id || 'fixpoint'))
        else showToast('전송 실패: ' + (resp && (resp.error || resp.status) || '서버 확인'), 3500)
      })
    } catch (e) { showToast('전송 실패: ' + e.message, 3500) }
  }

  // ───────────────────────────────────────────── popup 통신
  chrome.runtime.onMessage.addListener(function (msg, _s, sendResponse) {
    if (!msg) return
    if (msg.type === 'vp-get-mode') { sendResponse({ on: mode }); return }
    if (msg.type === 'vp-set-mode') { setMode(msg.on); sendResponse({ on: mode }); return }
  })
})()
