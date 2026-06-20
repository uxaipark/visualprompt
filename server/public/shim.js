// shim.js — <head> 첫 스크립트로 주입되는 런타임 후킹 IIFE.
// fetch/XHR/sendBeacon/element URL 프로퍼티/setAttribute 를 재작성하고,
// history 경로 스푸핑으로 SPA 라우터의 초기 404 플래시를 막는다.
(function () {
  if (window.__VP_SHIM__) return
  window.__VP_SHIM__ = true

  var BASE = window.__VP_BASE__ || location.href
  var PROXY = '/proxy?url='

  function isSpecial(u) {
    if (!u) return true
    return /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i.test(String(u).trim())
  }

  function rw(u) {
    if (u == null) return u
    var s = String(u)
    if (isSpecial(s)) return s
    if (s.indexOf(PROXY) === 0) return s
    try {
      var abs = new URL(s, BASE)
      if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return s
      return PROXY + encodeURIComponent(abs.href)
    } catch (e) {
      return s
    }
  }

  function unrw(v) {
    if (v == null) return v
    var s = String(v)
    var i = s.indexOf(PROXY)
    if (i < 0) return s
    try {
      var enc = s.slice(i + PROXY.length)
      var amp = enc.indexOf('&')
      if (amp >= 0) enc = enc.slice(0, amp)
      return decodeURIComponent(enc)
    } catch (e) {
      return s
    }
  }

  function rwSrcset(v) {
    if (!v) return v
    return String(v)
      .split(',')
      .map(function (part) {
        var seg = part.trim()
        if (!seg) return ''
        var sp = seg.split(/\s+/)
        sp[0] = rw(sp[0])
        return sp.join(' ')
      })
      .filter(Boolean)
      .join(', ')
  }

  window.__VP_RW__ = rw
  window.__VP_UNRW__ = unrw

  // ── 네트워크 로그 (백엔드 단서용)
  var NET = (window.__VP_NET__ = window.__VP_NET__ || [])
  function logNet(method, url) {
    try {
      NET.push({ method: method || 'GET', url: String(url), t: performance.now() })
      if (NET.length > 200) NET.shift()
    } catch (e) {}
  }

  // ── Service Worker 무력화
  // 프록시에선 SW 스크립트가 우리 오리진/스코프로 묶여 동작 불가하고, UI 수집과 무관하다.
  // 깨진 SW 가 캐싱으로 페이지를 방해할 수 있어 register 를 no-op 으로 만들고 기존 등록을 해제한다.
  try {
    if (navigator.serviceWorker) {
      var swStub = {
        scope: location.href,
        installing: null, waiting: null, active: null,
        addEventListener: function () {}, removeEventListener: function () {},
        update: function () { return Promise.resolve() },
        unregister: function () { return Promise.resolve(true) },
      }
      try {
        Object.defineProperty(navigator.serviceWorker, 'register', {
          configurable: true,
          value: function () { return Promise.resolve(swStub) },
        })
      } catch (e2) {
        try { navigator.serviceWorker.register = function () { return Promise.resolve(swStub) } } catch (e3) {}
      }
      if (navigator.serviceWorker.getRegistrations) {
        navigator.serviceWorker
          .getRegistrations()
          .then(function (rs) { rs.forEach(function (r) { try { r.unregister() } catch (e) {} }) })
          .catch(function () {})
      }
    }
  } catch (e) {}

  // ── history 경로 스푸핑: 래퍼 경로(/proxy)를 원본 경로로 바꿔치기
  try {
    var b = new URL(BASE)
    var want = b.pathname + b.search + b.hash
    var cur = location.pathname + location.search + location.hash
    if (want && want !== cur) {
      history.replaceState(history.state, '', want)
    }
  } catch (e) {}

  // ── fetch 후킹
  if (window.fetch) {
    var _fetch = window.fetch.bind(window)
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string') {
          logNet(init && init.method, input)
          input = rw(input)
        } else if (input && input.url) {
          logNet(input.method, input.url)
          input = new Request(rw(input.url), input)
        }
      } catch (e) {}
      return _fetch(input, init)
    }
  }

  // ── XMLHttpRequest.open 후킹
  if (window.XMLHttpRequest) {
    var _open = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        logNet(method, url)
        arguments[1] = rw(url)
      } catch (e) {}
      return _open.apply(this, arguments)
    }
  }

  // ── sendBeacon 후킹
  if (navigator.sendBeacon) {
    var _beacon = navigator.sendBeacon.bind(navigator)
    navigator.sendBeacon = function (url, data) {
      try {
        logNet('POST', url)
        url = rw(url)
      } catch (e) {}
      return _beacon(url, data)
    }
  }

  // ── history.pushState / replaceState — 교차 출처 SecurityError 흡수
  function wrapHistory(name) {
    var orig = history[name]
    if (!orig) return
    history[name] = function (state, title, url) {
      try {
        return orig.call(history, state, title, url)
      } catch (e1) {
        try {
          return orig.call(history, state, title)
        } catch (e2) {
          return undefined
        }
      }
    }
  }
  wrapHistory('pushState')
  wrapHistory('replaceState')

  // ── 엘리먼트 URL 프로퍼티 세터/게터 패치
  function patchUrlProp(proto, prop, isSrcset) {
    if (!proto) return
    var desc = Object.getOwnPropertyDescriptor(proto, prop)
    if (!desc || !desc.set || !desc.get) return
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get: function () {
        var raw = desc.get.call(this)
        return isSrcset ? raw : unrw(raw)
      },
      set: function (v) {
        desc.set.call(this, isSrcset ? rwSrcset(v) : rw(v))
      },
    })
  }

  try { patchUrlProp(HTMLScriptElement.prototype, 'src') } catch (e) {}
  try { patchUrlProp(HTMLImageElement.prototype, 'src') } catch (e) {}
  try { patchUrlProp(HTMLImageElement.prototype, 'srcset', true) } catch (e) {}
  try { patchUrlProp(HTMLLinkElement.prototype, 'href') } catch (e) {}
  try { patchUrlProp(HTMLIFrameElement.prototype, 'src') } catch (e) {}
  try { patchUrlProp(HTMLMediaElement.prototype, 'src') } catch (e) {}
  try { patchUrlProp(HTMLSourceElement.prototype, 'src') } catch (e) {}
  try { patchUrlProp(HTMLSourceElement.prototype, 'srcset', true) } catch (e) {}

  // ── setAttribute 패치 — src/srcset/(앵커 아닌)href 만
  var _setAttr = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (name, value) {
    try {
      var n = String(name).toLowerCase()
      if (n === 'src') {
        value = rw(value)
      } else if (n === 'srcset') {
        value = rwSrcset(value)
      } else if (n === 'href' && this.tagName !== 'A') {
        value = rw(value)
      }
    } catch (e) {}
    return _setAttr.call(this, name, value)
  }
})()
