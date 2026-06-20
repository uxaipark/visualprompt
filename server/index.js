// VisualPrompt — Express 서버
// /proxy, /api/*, /__vp/*, /snap, 정적 서빙. local(개발서버) / proxy(외부) 두 타깃 모드.
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  rewriteHtmlLive,
  serveLocalHtml,
  rewriteCss,
  rewriteJsModule,
  isJsContentType,
  rwAbs,
} from './proxy.js'
import {
  SNAP_ROOT,
  hasSnapshot,
  readSnapshotHtml,
  snapshotStatus,
  saveSnapshot,
  deleteSnapshot,
  editSnapshot,
} from './snapshot.js'
import {
  saveFixpoint,
  listFixpoints,
  applyFixpoint,
  deleteFixpoint,
} from './inbox.js'
import { renderHtml, screenshot, renderAvailable } from './render.js'
import {
  startLogin,
  saveLogin,
  cancelLogin,
  sessionStatus,
  clearSession,
} from './session.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

// ───────────────────────────────────────────────────────────── .env 로더
function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const key = m[1]
      if (key.startsWith('#')) continue
      let val = m[2]
      if (val[0] !== '"' && val[0] !== "'") val = val.replace(/\s+#.*$/, '').trim()
      if ((val[0] === '"' && val.at(-1) === '"') || (val[0] === "'" && val.at(-1) === "'")) {
        val = val.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = val
    }
  } catch {
    /* .env 없으면 무시 */
  }
}
loadEnv()

// ───────────────────────────────────────────────────────────── 설정 로더
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'fixpin.config.json'), 'utf8'))
  } catch {
    return { targets: [], defaultTarget: null }
  }
}
const CONFIG = loadConfig()

const PORT = process.env.PORT || 3001
const isProd = process.env.NODE_ENV === 'production'

const app = express()
// /proxy 는 원본 바디를 그대로 업스트림에 전달해야 하므로 JSON 파싱에서 제외한다.
const jsonParser = express.json({ limit: '4mb' })
app.use((req, res, next) => {
  if (req.path.startsWith('/proxy')) return next()
  jsonParser(req, res, next)
})

// 요청 원본 바디를 Buffer 로 수집 (비-GET 프록시 전달용)
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined))
    req.on('error', reject)
  })
}

// /api 는 CORS 허용 — 브라우저 확장이 임의 사이트에서 fixpoint 를 POST 할 수 있도록.
app.use('/api', (req, res, next) => {
  res.set('access-control-allow-origin', '*')
  res.set('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS')
  res.set('access-control-allow-headers', 'content-type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// ───────────────────────────────────────────────────────── 주입 스크립트
const PUBLIC_DIR = path.join(__dirname, 'public')
const SHIM_PATH = path.join(PUBLIC_DIR, 'shim.js')
const INSPECTOR_PATH = path.join(PUBLIC_DIR, 'inspector.js')

let _shimCache = readFileSafe(SHIM_PATH)
let _inspectorCache = readFileSafe(INSPECTOR_PATH)

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}
function getShim() {
  return isProd ? _shimCache : readFileSafe(SHIM_PATH)
}
function getInspector() {
  return isProd ? _inspectorCache : readFileSafe(INSPECTOR_PATH)
}

app.get('/__vp/shim.js', (_req, res) => {
  res.type('application/javascript').send(getShim())
})
app.get('/__vp/inspector.js', (_req, res) => {
  res.type('application/javascript').send(getInspector())
})

// 스냅샷 리소스 정적 서빙
app.use('/snap', express.static(SNAP_ROOT, { fallthrough: true, maxAge: '1h' }))

// ───────────────────────────────────────────────── 스크립트 주입 콜백
function injectScripts($, baseUrl) {
  let head = $('head')
  if (!head.length) {
    $('html').prepend('<head></head>')
    head = $('head')
    if (!head.length) {
      $.root().prepend('<head></head>')
      head = $('head')
    }
  }
  let body = $('body')
  if (!body.length) {
    $('html').append('<body></body>')
    body = $('body')
    if (!body.length) {
      $.root().append('<body></body>')
      body = $('body')
    }
  }
  const baseJson = JSON.stringify(baseUrl)
  // 빈 data: 아이콘으로 기본 /favicon.ico (우리 오리진 404) 요청을 막는다.
  const faviconGuard = $('link[rel*="icon"]').length ? '' : `<link rel="icon" href="data:,">`
  head.prepend(
    `<script>window.__VP_BASE__=${baseJson};</script>` +
      `<meta name="referrer" content="no-referrer">` +
      faviconGuard +
      `<script>${getShim()}</script>`,
  )
  body.append(`<script>${getInspector()}</script>`)
}

// ───────────────────────────────────────────────── 설정 API
app.get('/api/config', async (_req, res) => {
  res.json({
    targets: CONFIG.targets || [],
    defaultTarget: CONFIG.defaultTarget || null,
    renderer: await renderAvailable(),
  })
})

// ───────────────────────────────────────────────── 스크린샷 (요구2: 다운로드)
app.get('/api/screenshot', async (req, res) => {
  const url = String(req.query.url || '')
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'bad url' })
  try {
    const buf = await screenshot(url, { fullPage: req.query.full !== '0' })
    res.set('access-control-allow-origin', '*')
    res.type('image/png').send(buf)
  } catch (err) {
    res.status(err && err.code === 'NO_RENDERER' ? 501 : 502).json({ error: String(err && err.message) })
  }
})

// ───────────────────────────────────────────────── 프록시 엔드포인트 (모든 메서드)
app.all('/proxy', async (req, res) => {
  const target = req.query.url
  if (!target || !/^https?:\/\//i.test(String(target))) {
    return res.status(400).type('text/plain; charset=utf-8').send('Bad url')
  }
  const baseUrl = String(target)
  const fresh = req.query.fresh === '1'
  const render = req.query.render === '1'
  const isGet = req.method === 'GET' || req.method === 'HEAD'

  // 스냅샷/렌더는 문서(GET) 로드에만 적용. API 호출(POST 등)은 항상 실시간 전달.
  // 로컬 스냅샷 우선
  if (isGet && !fresh && hasSnapshot(baseUrl)) {
    try {
      const html = readSnapshotHtml(baseUrl)
      res.set('x-vp-source', 'local')
      res.set('access-control-allow-origin', '*')
      return res.type('text/html; charset=utf-8').send(serveLocalHtml(html, baseUrl, injectScripts))
    } catch {
      /* 폴백: 실시간 */
    }
  }

  // 렌더 모드: 헤드리스 브라우저로 완성 DOM 을 떠 와서 재작성 (SPA/하드 사이트)
  if (isGet && render) {
    try {
      const { html, finalUrl } = await renderHtml(baseUrl)
      res.set('access-control-allow-origin', '*')
      res.set('x-vp-source', 'render')
      return res.type('text/html; charset=utf-8').send(rewriteHtmlLive(html, finalUrl, injectScripts))
    } catch (err) {
      return res
        .status(err && err.code === 'NO_RENDERER' ? 501 : 502)
        .type('text/html; charset=utf-8')
        .send(
          `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem">` +
            `<h2>렌더 실패</h2><p>${escapeHtml(baseUrl)}</p><pre>${escapeHtml(String(err && err.message))}</pre></body>`,
        )
    }
  }

  // 업스트림으로 전달할 헤더 — 호스트/홉바이홉 헤더는 제외, 나머지는 그대로 전달
  // (content-type/authorization/cookie/accept 등이 보존되어 로그인·API 호출이 동작)
  const fwdHeaders = {}
  const DROP = new Set([
    'host', 'connection', 'content-length', 'accept-encoding',
    'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user',
  ])
  for (const [k, v] of Object.entries(req.headers)) {
    if (DROP.has(k.toLowerCase())) continue
    fwdHeaders[k] = v
  }
  if (!fwdHeaders['user-agent']) {
    fwdHeaders['user-agent'] =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  }

  let body
  if (!isGet) {
    try {
      body = await readRawBody(req)
    } catch {
      body = undefined
    }
  }

  // 리다이렉트를 직접 처리 + 업스트림 타임아웃(무한 대기 방지)
  const FETCH_TIMEOUT = parseInt(process.env.PROXY_FETCH_TIMEOUT || '15000', 10)
  const doFetch = (u) => {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT)
    return fetch(u, { method: req.method, headers: fwdHeaders, body, redirect: 'manual', signal: ac.signal })
      .finally(() => clearTimeout(t))
  }

  const isAbort = (e) => e && (e.name === 'AbortError' || /abort/i.test(String(e.message)))
  const errCode = (e) => String((e && e.cause && e.cause.code) || (e && e.message) || '')
  // 폴백 후보 — 에러 종류에 맞춰서만 시도(불통 호스트에 헛된 재시도 방지)
  function altCandidates(u, err) {
    const cands = []
    try {
      const uo = new URL(u)
      const code = errCode(err)
      const labels = uo.hostname.split('.').length
      const isDns = /ENOTFOUND|EAI_AGAIN/.test(code)
      const isCert = /CERT|TLS|SSL|ALTNAME/i.test(code)
      // www. 폴백: apex DNS 미해석/인증서 불일치일 때만
      if ((isDns || isCert) && !/^www\./i.test(uo.hostname) && labels >= 2 && labels <= 3) {
        const w = new URL(u); w.hostname = 'www.' + uo.hostname; cands.push(w.href)
      }
      // http:// 폴백: 인증서/프로토콜 오류일 때만 (타임아웃·연결거부엔 무의미)
      if (isCert && uo.protocol === 'https:') {
        const h = new URL(u); h.protocol = 'http:'; cands.push(h.href)
      }
    } catch {}
    return cands
  }

  let upstream
  let fetchedUrl = baseUrl
  let lastErr
  try {
    upstream = await doFetch(baseUrl)
  } catch (err) {
    lastErr = err
    // 타임아웃이면 즉시 포기(재시도해도 느림) → 504
    const cands = (isGet && !isAbort(err)) ? altCandidates(baseUrl, err) : []
    for (const alt of cands) {
      try {
        upstream = await doFetch(alt)
        fetchedUrl = alt
        break
      } catch (e2) { lastErr = e2 }
    }
    if (!upstream) {
      const aborted = isAbort(lastErr)
      return res
        .status(aborted ? 504 : 502)
        .type('text/html; charset=utf-8')
        .send(
          `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem">` +
            `<h2>페이지를 불러오지 못했습니다</h2><p>${escapeHtml(baseUrl)}</p>` +
            `<pre>${escapeHtml(aborted ? `시간 초과 (${FETCH_TIMEOUT}ms)` : String(lastErr && lastErr.message))}</pre></body>`,
        )
    }
  }

  const finalUrl = upstream.url || fetchedUrl
  const ct = upstream.headers.get('content-type') || ''
  res.set('access-control-allow-origin', '*')
  res.set('x-vp-source', 'live')
  // 업스트림 상태코드 보존 (로그인 실패 401, 비콘 204 등). 쿠키는 재작성해 전달.
  res.status(upstream.status)
  try {
    const sc = upstream.headers.getSetCookie && upstream.headers.getSetCookie()
    if (sc && sc.length) res.set('set-cookie', sc.map(rewriteSetCookie))
  } catch {}

  // 리다이렉트(3xx): Location 을 프록시 경유로 바꿔 브라우저가 직접 따라가게 한다.
  // → 각 홉의 쿠키가 정상 저장되고 로그인 후 이동이 동작.
  if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
    res.set('location', rwAbs(upstream.headers.get('location'), finalUrl))
    return res.end()
  }

  // 콘텐츠 종류 판별. 브라우저가 알려주는 요청 목적지(Sec-Fetch-Dest)를 최우선으로 쓴다.
  // 이게 가장 신뢰할 수 있다: Vite 처럼 .css 를 JS 모듈로 서빙해도 dest=script 면 JS 로 줘야 한다.
  // dest 가 없을 때(curl 등)만 content-type/확장자로 폴백.
  const dest = (req.get('sec-fetch-dest') || '').toLowerCase()
  let upath = ''
  try { upath = new URL(finalUrl).pathname } catch {}

  // 응답이 HTML 이면(404/SPA 폴백/에러 페이지) script/style 요청이라도 JS/CSS 로 강제하지 않는다.
  // (HTML 을 JS 로 실행하면 "Unexpected token '<'" 가 난다 → 원본 그대로 통과시켜 정직하게 실패)
  const ctIsHtml = /text\/html|application\/xhtml/i.test(ct)

  let kind = null // 'js' | 'css' | 'html' | null(=원본 버퍼)
  if (dest === 'script' || dest === 'serviceworker' || dest === 'worker') {
    kind = ctIsHtml ? null : 'js'
  } else if (dest === 'style') {
    kind = ctIsHtml ? null : 'css'
  } else if (dest === 'document' || dest === 'iframe' || dest === 'frame') {
    kind = 'html'
  } else if (!dest) {
    // 비-브라우저/목적지 없음 → content-type 우선, 확장자 폴백
    if (isJsContentType(ct)) kind = 'js'
    else if (/text\/css|\/css/i.test(ct)) kind = 'css'
    else if (/text\/html|application\/xhtml/i.test(ct)) kind = 'html'
    else if (/\.(mjs|js)(\?|$)/i.test(upath)) kind = 'js'
    else if (/\.css(\?|$)/i.test(upath)) kind = 'css'
  }
  // 그 외(image/font/fetch=empty/json/audio/video 등)는 kind=null → 원본 그대로 통과

  try {
    if (kind === 'css') {
      const css = await upstream.text()
      return res.type('text/css; charset=utf-8').send(rewriteCss(css, finalUrl))
    }
    if (kind === 'js') {
      const js = await upstream.text()
      return res.type('text/javascript; charset=utf-8').send(rewriteJsModule(js, finalUrl))
    }
    if (kind === 'html') {
      const html = await upstream.text()
      return res.type('text/html; charset=utf-8').send(rewriteHtmlLive(html, finalUrl, injectScripts))
    }
    // 원본 버퍼 그대로 통과(이미지/폰트/오디오/비디오/JSON 등).
    // 미디어 스트리밍에 필수인 Range 관련 헤더와 캐시 헤더를 업스트림에서 전달한다.
    // (Content-Range 없는 206 은 브라우저가 무효 처리 → 오디오/비디오 재생 실패)
    const PASS_HEADERS = [
      'content-range', 'accept-ranges', 'content-disposition',
      'cache-control', 'etag', 'last-modified', 'expires', 'vary', 'content-language',
    ]
    for (const h of PASS_HEADERS) {
      const v = upstream.headers.get(h)
      if (v) res.set(h, v)
    }
    const buf = Buffer.from(await upstream.arrayBuffer())
    if (ct) res.set('content-type', ct)
    return res.send(buf)
  } catch (err) {
    return res.status(502).type('text/plain; charset=utf-8').send('Proxy error: ' + String(err && err.message))
  }
})

// ───────────────────────────────────────────────── 스냅샷 API
app.get('/api/snapshot', (req, res) => {
  const url = String(req.query.url || '')
  if (!url) return res.status(400).json({ error: 'no url' })
  res.json(snapshotStatus(url))
})
app.post('/api/snapshot', async (req, res) => {
  const url = req.body && req.body.url
  if (!url || !/^https?:\/\//i.test(String(url))) return res.status(400).json({ error: 'bad url' })
  try {
    res.json(await saveSnapshot(String(url), { render: !!(req.body && req.body.render) }))
  } catch (err) {
    res.status(502).json({ error: String(err && err.message) })
  }
})
app.delete('/api/snapshot', (req, res) => {
  const url = String(req.query.url || '')
  if (!url) return res.status(400).json({ error: 'no url' })
  const ok = deleteSnapshot(url)
  res.json({ ok, ...snapshotStatus(url) })
})

// ───────────────────────────────────────────────── 로그인 세션 API
const SESSION_ERROR_STATUS = { NO_RENDERER: 501, NO_DISPLAY: 501, NO_LOGIN: 410 }
app.get('/api/session', (req, res) => {
  const url = String(req.query.url || '')
  if (!url) return res.status(400).json({ error: 'no url' })
  res.json(sessionStatus(url))
})
app.post('/api/session/login', async (req, res) => {
  const url = req.body && req.body.url
  if (!url || !/^https?:\/\//i.test(String(url))) return res.status(400).json({ error: 'bad url' })
  try {
    res.json(await startLogin(String(url)))
  } catch (err) {
    res.status(SESSION_ERROR_STATUS[err && err.code] || 502).json({ error: String(err && err.message), code: err && err.code })
  }
})
app.post('/api/session/save', async (req, res) => {
  const token = req.body && req.body.token
  if (!token) return res.status(400).json({ error: 'no token' })
  try {
    res.json(await saveLogin(String(token)))
  } catch (err) {
    res.status(SESSION_ERROR_STATUS[err && err.code] || 502).json({ error: String(err && err.message), code: err && err.code })
  }
})
app.post('/api/session/cancel', async (req, res) => {
  const token = req.body && req.body.token
  res.json(await cancelLogin(String(token || '')))
})
app.delete('/api/session', (req, res) => {
  const url = String(req.query.url || '')
  if (!url) return res.status(400).json({ error: 'no url' })
  const ok = clearSession(url)
  res.json({ ok, ...sessionStatus(url) })
})

// ───────────────────────────────────────────────── fixpoint inbox API
app.get('/api/fixpoints', (_req, res) => {
  res.json(listFixpoints())
})
app.post('/api/fixpoints', (req, res) => {
  const b = req.body || {}
  if (!b.prompt || !b.element) return res.status(400).json({ error: 'prompt, element required' })
  try {
    res.json(saveFixpoint(b))
  } catch (err) {
    res.status(500).json({ error: String(err && err.message) })
  }
})
app.post('/api/fixpoints/:id/apply', (req, res) => {
  res.json(applyFixpoint(String(req.params.id)))
})
app.delete('/api/fixpoints/:id', (req, res) => {
  res.json(deleteFixpoint(String(req.params.id)))
})

// ───────────────────────────────────────────────── AI edit (미리보기)
const EDIT_ERROR_STATUS = { NO_API_KEY: 401, NO_SNAPSHOT: 409, NO_ELEMENT: 404, TOO_LARGE: 413, EMPTY: 502 }
app.post('/api/edit', async (req, res) => {
  const { url, selector, prompt } = req.body || {}
  if (!url || !selector || !prompt) return res.status(400).json({ error: 'url, selector, prompt required' })
  try {
    res.json(await editSnapshot({ url: String(url), selector: String(selector), prompt: String(prompt) }))
  } catch (err) {
    const status = EDIT_ERROR_STATUS[err && err.code] || 500
    res.status(status).json({ error: (err && err.code) || String(err && err.message), message: String(err && err.message) })
  }
})

// ───────────────────────────────────────────────── 프로덕션 정적 서빙
if (isProd) {
  const DIST = path.join(ROOT, 'dist')
  app.use(express.static(DIST))
  app.get('*', (req, res, next) => {
    if (/^\/(proxy|api|__vp|snap)/.test(req.path)) return next()
    res.sendFile(path.join(DIST, 'index.html'))
  })
}

// Set-Cookie 재작성 — 프록시(localhost) 에서도 세션 쿠키가 저장/전송되도록.
// Domain 제거(프록시 호스트로 기본화), Path 를 / 로(모든 /proxy 요청에 전송),
// http 프록시에선 Secure 제거, SameSite=None→Lax(Secure 없이 동작).
function rewriteSetCookie(line) {
  let out = String(line)
  out = out.replace(/;\s*Domain=[^;]*/gi, '')
  out = out.replace(/;\s*Path=[^;]*/gi, '')
  out = out.replace(/;\s*Secure/gi, '')
  out = out.replace(/;\s*SameSite=None/gi, '; SameSite=Lax')
  out += '; Path=/'
  return out
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c])
}

app.listen(PORT, () => {
  console.log(`[vp] server on http://localhost:${PORT}  (prod=${isProd})`)
})
