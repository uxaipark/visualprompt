// shim.js — runtime-hooking IIFE injected as the first script in <head>.
// Rewrites fetch/XHR/sendBeacon/element URL properties/setAttribute, and
// spoofs the history path to prevent the SPA router's initial 404 flash.
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

  // ── Network log (clues for the backend)
  var NET = (window.__VP_NET__ = window.__VP_NET__ || [])
  function logNet(method, url) {
    try {
      NET.push({ method: method || 'GET', url: String(url), t: performance.now() })
      if (NET.length > 200) NET.shift()
    } catch (e) {}
  }

  // ── Disable Service Workers
  // Under the proxy, SW scripts are bound to our origin/scope and can't work, and they're irrelevant to UI capture.
  // A broken SW could disrupt the page via caching, so we make register a no-op and unregister existing ones.
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

  // ── History path spoofing: swap the wrapper path (/proxy) for the original path
  try {
    var b = new URL(BASE)
    var want = b.pathname + b.search + b.hash
    var cur = location.pathname + location.search + location.hash
    if (want && want !== cur) {
      history.replaceState(history.state, '', want)
    }
  } catch (e) {}

  // ── fetch hook
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

  // ── XMLHttpRequest.open hook
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

  // ── sendBeacon hook
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

  // ── history.pushState / replaceState — swallow cross-origin SecurityError
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

  // ── Patch element URL property setters/getters
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

  // ── setAttribute patch — only src/srcset/(non-anchor) href
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
