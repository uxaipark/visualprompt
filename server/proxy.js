// server/proxy.js — URL 재작성 엔진.
// HTML/CSS/JS(ESM specifier·동적 import 포함) 의 모든 리소스 경로를 /proxy?url= 로
// 재작성하고, shim·inspector 스크립트를 주입한다. ui_editor 의 검증된 로직을 모듈화했다.
import * as cheerio from 'cheerio'

export const PROXY = '/proxy?url='

function isSpecial(u) {
  if (!u) return true
  return /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i.test(u.trim())
}

export function rwAbs(u, baseUrl) {
  if (u == null) return u
  const s = String(u)
  if (isSpecial(s)) return s
  if (s.startsWith(PROXY)) return s
  try {
    const abs = new URL(s, baseUrl)
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return s
    return PROXY + encodeURIComponent(abs.href)
  } catch {
    return s
  }
}

function rwSrcset(v, baseUrl) {
  if (!v) return v
  return v
    .split(',')
    .map((part) => {
      const seg = part.trim()
      if (!seg) return ''
      const sp = seg.split(/\s+/)
      sp[0] = rwAbs(sp[0], baseUrl)
      return sp.join(' ')
    })
    .filter(Boolean)
    .join(', ')
}

export function rewriteCss(css, baseUrl) {
  if (!css) return css
  let out = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => {
    return `url(${q}${rwAbs(u, baseUrl)}${q})`
  })
  out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => {
    return `@import ${q}${rwAbs(u, baseUrl)}${q}`
  })
  return out
}

// bare specifier( three, react, @scope/pkg, three/addons/... )는 import map/로더가
// 해석하므로 절대 재작성하지 않는다. /, ./, ../, http(s):// 로 시작하는 것만 프록시 경유.
function isResolvableSpecifier(spec) {
  return /^(\.{0,2}\/|https?:\/\/)/i.test(spec)
}
function rwSpec(spec, baseUrl) {
  return isResolvableSpecifier(spec) ? rwAbs(spec, baseUrl) : spec
}

// ────────────────────────────────────────── ES 모듈 specifier 재작성
function rewriteModuleSpecifiers(code, baseUrl) {
  if (!code) return code
  code = code.replace(
    /\b(import|export)([\w$*,{}\s]*?)\bfrom\s*(['"])([^'"\s]+)\3/g,
    (m, kw, binding, q, spec) => `${kw}${binding}from ${q}${rwSpec(spec, baseUrl)}${q}`,
  )
  code = code.replace(
    /\bimport\s*(['"])([^'"\s]+)\1/g,
    (m, q, spec) => `import ${q}${rwSpec(spec, baseUrl)}${q}`,
  )
  code = code.replace(
    /\bimport\s*\(\s*(['"])([^'"\s]+)\1\s*\)/g,
    (m, q, spec) => `import(${q}${rwSpec(spec, baseUrl)}${q})`,
  )
  return code
}

// 동적 import 우회 프렐류드 (중복 prepend 가드 포함)
const JS_IMPORT_PRELUDE = `(function(){
if (window.__vpImport) return;
var OWN = /^\\/(proxy|__vp|api|snap|@|node_modules|src)\\b/;
function R(u){
  try{
    if (typeof u !== 'string') return u;
    if (u.indexOf('/proxy?url=') === 0) return u;
    // bare specifier(import map 해석 대상)는 건드리지 않는다
    if (!/^(\\.{0,2}\\/|https?:\\/\\/)/i.test(u)) return u;
    var abs = new URL(u, location.href);
    if (abs.origin === location.origin){
      if (OWN.test(abs.pathname)) return u;
      var base = window.__VP_BASE__ || location.href;
      var real = new URL(abs.pathname + abs.search + abs.hash, base);
      return '/proxy?url=' + encodeURIComponent(real.href);
    }
    if (abs.protocol === 'http:' || abs.protocol === 'https:'){
      return '/proxy?url=' + encodeURIComponent(abs.href);
    }
    return u;
  }catch(e){ return u; }
}
window.__vpImport = function(u){ return import(R(u)); };
})();
`

export function rewriteJsModule(js, baseUrl) {
  if (!js) return js
  let out = rewriteModuleSpecifiers(js, baseUrl)
  out = out.replace(/\bimport\s*\(/g, '__vpImport(')
  return JS_IMPORT_PRELUDE + out
}

export function isJsContentType(ct) {
  return !!ct && /javascript|ecmascript/i.test(ct)
}

// ───────────────────────────────────────────────── HTML 재작성
const RW_TARGETS = [
  ['script[src]', 'src'],
  ['img[src]', 'src'],
  ['img[srcset]', 'srcset'],
  ['source[src]', 'src'],
  ['source[srcset]', 'srcset'],
  ['video[src]', 'src'],
  ['audio[src]', 'src'],
  ['track[src]', 'src'],
  ['embed[src]', 'src'],
  ['iframe[src]', 'src'],
  ['input[src]', 'src'],
  ['link[href]', 'href'],
]

// injectFn($, baseUrl) — head/body 에 shim·inspector 를 주입하는 콜백 (server/index.js 제공)
export function rewriteHtmlLive(html, baseUrl, injectFn) {
  html = html.replace(
    /<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi,
    '',
  )
  const $ = cheerio.load(html, { decodeEntities: false })
  $('[integrity]').removeAttr('integrity')

  for (const [sel, attr] of RW_TARGETS) {
    $(sel).each((_, el) => {
      const $el = $(el)
      const v = $el.attr(attr)
      if (v == null) return
      $el.attr(attr, attr === 'srcset' ? rwSrcset(v, baseUrl) : rwAbs(v, baseUrl))
    })
  }
  $('[style]').each((_, el) => {
    const $el = $(el)
    $el.attr('style', rewriteCss($el.attr('style'), baseUrl))
  })
  $('style').each((_, el) => {
    const $el = $(el)
    $el.text(rewriteCss($el.text(), baseUrl))
  })
  $('script[type="module"]').each((_, el) => {
    const $el = $(el)
    if ($el.attr('src')) return
    const code = $el.html()
    if (code) $el.text(rewriteModuleSpecifiers(code, baseUrl))
  })

  if (injectFn) injectFn($, baseUrl)
  return $.html()
}

// 로컬(스냅샷/같은출처) HTML — 재작성 없이 주입만
export function serveLocalHtml(html, baseUrl, injectFn) {
  const $ = cheerio.load(html, { decodeEntities: false })
  if (injectFn) injectFn($, baseUrl)
  return $.html()
}
