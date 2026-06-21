// VisualPrompt — Express server
// /proxy, /api/*, /__vp/*, /snap, static serving. Two target modes: local (dev server) / proxy (external).
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

// ───────────────────────────────────────────────────────────── .env loader
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
    /* ignore if .env is missing */
  }
}
loadEnv()

// ───────────────────────────────────────────────────────────── config loader
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
// /proxy must forward the raw body to upstream as-is, so exclude it from JSON parsing.
const jsonParser = express.json({ limit: '4mb' })
app.use((req, res, next) => {
  if (req.path.startsWith('/proxy')) return next()
  jsonParser(req, res, next)
})

// Collect the raw request body into a Buffer (for forwarding non-GET proxy requests)
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined))
    req.on('error', reject)
  })
}

// /api allows CORS — so the browser extension can POST fixpoints from arbitrary sites.
app.use('/api', (req, res, next) => {
  res.set('access-control-allow-origin', '*')
  res.set('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS')
  res.set('access-control-allow-headers', 'content-type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// ───────────────────────────────────────────────────────── injected scripts
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

// Static serving of snapshot resources
app.use('/snap', express.static(SNAP_ROOT, { fallthrough: true, maxAge: '1h' }))

// ───────────────────────────────────────────────── script injection callback
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
  // Use an empty data: icon to block the default /favicon.ico (404 on our origin) request.
  const faviconGuard = $('link[rel*="icon"]').length ? '' : `<link rel="icon" href="data:,">`
  head.prepend(
    `<script>window.__VP_BASE__=${baseJson};</script>` +
      `<meta name="referrer" content="no-referrer">` +
      faviconGuard +
      `<script>${getShim()}</script>`,
  )
  body.append(`<script>${getInspector()}</script>`)
}

// ───────────────────────────────────────────────── config API
app.get('/api/config', async (_req, res) => {
  res.json({
    targets: CONFIG.targets || [],
    defaultTarget: CONFIG.defaultTarget || null,
    renderer: await renderAvailable(),
  })
})

// ───────────────────────────────────────────────── screenshot (requirement 2: download)
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

// ───────────────────────────────────────────────── proxy endpoint (all methods)
app.all('/proxy', async (req, res) => {
  const target = req.query.url
  if (!target || !/^https?:\/\//i.test(String(target))) {
    return res.status(400).type('text/plain; charset=utf-8').send('Bad url')
  }
  const baseUrl = String(target)
  const fresh = req.query.fresh === '1'
  const render = req.query.render === '1'
  const isGet = req.method === 'GET' || req.method === 'HEAD'

  // Snapshot/render apply only to document (GET) loads. API calls (POST, etc.) are always forwarded live.
  // Prefer local snapshot
  if (isGet && !fresh && hasSnapshot(baseUrl)) {
    try {
      const html = readSnapshotHtml(baseUrl)
      res.set('x-vp-source', 'local')
      res.set('access-control-allow-origin', '*')
      return res.type('text/html; charset=utf-8').send(serveLocalHtml(html, baseUrl, injectScripts))
    } catch {
      /* fallback: live */
    }
  }

  // Render mode: fetch the fully-rendered DOM via a headless browser and rewrite it (SPA/hard sites)
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
            `<h2>Render failed</h2><p>${escapeHtml(baseUrl)}</p><pre>${escapeHtml(String(err && err.message))}</pre></body>`,
        )
    }
  }

  // Headers to forward upstream — drop host/hop-by-hop headers, forward the rest as-is
  // (preserving content-type/authorization/cookie/accept etc. keeps login and API calls working)
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

  // Handle redirects ourselves + upstream timeout (prevent infinite waits)
  const FETCH_TIMEOUT = parseInt(process.env.PROXY_FETCH_TIMEOUT || '15000', 10)
  const doFetch = (u) => {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT)
    return fetch(u, { method: req.method, headers: fwdHeaders, body, redirect: 'manual', signal: ac.signal })
      .finally(() => clearTimeout(t))
  }

  const isAbort = (e) => e && (e.name === 'AbortError' || /abort/i.test(String(e.message)))
  const errCode = (e) => String((e && e.cause && e.cause.code) || (e && e.message) || '')
  // Fallback candidates — try only based on the error type (avoid pointless retries on unreachable hosts)
  function altCandidates(u, err) {
    const cands = []
    try {
      const uo = new URL(u)
      const code = errCode(err)
      const labels = uo.hostname.split('.').length
      const isDns = /ENOTFOUND|EAI_AGAIN/.test(code)
      const isCert = /CERT|TLS|SSL|ALTNAME/i.test(code)
      // www. fallback: only on apex DNS resolution failure / certificate mismatch
      if ((isDns || isCert) && !/^www\./i.test(uo.hostname) && labels >= 2 && labels <= 3) {
        const w = new URL(u); w.hostname = 'www.' + uo.hostname; cands.push(w.href)
      }
      // http:// fallback: only on certificate/protocol errors (meaningless for timeouts/connection refused)
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
    // On timeout, give up immediately (retrying would still be slow) → 504
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
            `<h2>Failed to load page</h2><p>${escapeHtml(baseUrl)}</p>` +
            `<pre>${escapeHtml(aborted ? `Timed out (${FETCH_TIMEOUT}ms)` : String(lastErr && lastErr.message))}</pre></body>`,
        )
    }
  }

  const finalUrl = upstream.url || fetchedUrl
  const ct = upstream.headers.get('content-type') || ''
  res.set('access-control-allow-origin', '*')
  res.set('x-vp-source', 'live')
  // Preserve the upstream status code (login failure 401, beacon 204, etc.). Cookies are rewritten before forwarding.
  res.status(upstream.status)
  try {
    const sc = upstream.headers.getSetCookie && upstream.headers.getSetCookie()
    if (sc && sc.length) res.set('set-cookie', sc.map(rewriteSetCookie))
  } catch {}

  // Redirects (3xx): rewrite Location to go through the proxy so the browser follows it directly.
  // → cookies for each hop are stored correctly and post-login navigation works.
  if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
    res.set('location', rwAbs(upstream.headers.get('location'), finalUrl))
    return res.end()
  }

  // Determine content type. Prefer the browser-supplied request destination (Sec-Fetch-Dest) above all.
  // This is the most reliable: even if .css is served as a JS module (like Vite), dest=script means we serve JS.
  // Fall back to content-type/extension only when dest is absent (curl, etc.).
  const dest = (req.get('sec-fetch-dest') || '').toLowerCase()
  let upath = ''
  try { upath = new URL(finalUrl).pathname } catch {}

  // If the response is HTML (404/SPA fallback/error page), don't force it to JS/CSS even for script/style requests.
  // (Running HTML as JS throws "Unexpected token '<'" → pass the original through so it fails honestly)
  const ctIsHtml = /text\/html|application\/xhtml/i.test(ct)

  let kind = null // 'js' | 'css' | 'html' | null (= raw buffer)
  if (dest === 'script' || dest === 'serviceworker' || dest === 'worker') {
    kind = ctIsHtml ? null : 'js'
  } else if (dest === 'style') {
    kind = ctIsHtml ? null : 'css'
  } else if (dest === 'document' || dest === 'iframe' || dest === 'frame') {
    kind = 'html'
  } else if (!dest) {
    // non-browser / no destination → prefer content-type, fall back to extension
    if (isJsContentType(ct)) kind = 'js'
    else if (/text\/css|\/css/i.test(ct)) kind = 'css'
    else if (/text\/html|application\/xhtml/i.test(ct)) kind = 'html'
    else if (/\.(mjs|js)(\?|$)/i.test(upath)) kind = 'js'
    else if (/\.css(\?|$)/i.test(upath)) kind = 'css'
  }
  // Everything else (image/font/fetch=empty/json/audio/video etc.) stays kind=null → pass the original through

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
    // Pass the raw buffer through (images/fonts/audio/video/JSON etc.).
    // Forward Range-related and cache headers from upstream, which are essential for media streaming.
    // (A 206 without Content-Range is treated as invalid by browsers → audio/video playback fails)
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

// ───────────────────────────────────────────────── snapshot API
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

// ───────────────────────────────────────────────── login session API
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

// ───────────────────────────────────────────────── AI edit (preview)
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

// ───────────────────────────────────────────────── production static serving
if (isProd) {
  const DIST = path.join(ROOT, 'dist')
  app.use(express.static(DIST))
  app.get('*', (req, res, next) => {
    if (/^\/(proxy|api|__vp|snap)/.test(req.path)) return next()
    res.sendFile(path.join(DIST, 'index.html'))
  })
}

// Set-Cookie rewrite — so session cookies are stored/sent even through the proxy (localhost).
// Remove Domain (default to the proxy host), set Path to / (sent on all /proxy requests),
// remove Secure on the http proxy, and SameSite=None→Lax (works without Secure).
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
