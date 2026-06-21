// verify/run.mjs — loads a set of representative sites through the VP proxy to verify stability/interaction.
// Results are appended incrementally to results.jsonl (resumable). Failures are classified by category.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VP = process.env.VP || 'http://localhost:3001'
const CONC = parseInt(process.env.CONC || '8', 10)
const LIMIT = parseInt(process.env.LIMIT || '1000', 10)
const SITE_TIMEOUT = 28000

const SITES_FILE = process.env.SITES_FILE || 'sites.txt'
const OUT_FILE = process.env.OUT_FILE || 'results.jsonl'
const sites = fs.readFileSync(path.join(__dirname, SITES_FILE), 'utf8')
  .split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, LIMIT)

const resultsPath = path.join(__dirname, OUT_FILE)
// Resume: skip domains already processed
const done = new Set()
if (fs.existsSync(resultsPath)) {
  for (const line of fs.readFileSync(resultsPath, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { done.add(JSON.parse(line).domain) } catch {}
  }
}
const todo = sites.filter(d => !done.has(d))
const out = fs.createWriteStream(resultsPath, { flags: 'a' })
log(`total ${sites.length} / remaining ${todo.length} / concurrency ${CONC}`)

function log(m) { process.stdout.write(`[verify] ${m}\n`) }

const ERR_PAGE = /Failed to load page|Render failed|Bad url|Proxy error/

async function checkSite(browser, domain) {
  const url = 'https://' + domain
  const proxied = VP + '/proxy?url=' + encodeURIComponent(url)
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  })
  const page = await ctx.newPage()
  const rec = { domain, reqTotal: 0, reqFail: 0, proxyResFail: 0, errs: [] }
  page.on('request', () => { rec.reqTotal++ })
  page.on('requestfailed', (r) => {
    rec.reqFail++
    if (/\/proxy\?url=/.test(r.url())) rec.proxyResFail++
  })
  page.on('response', (r) => {
    if (r.status() >= 400 && /\/proxy\?url=/.test(r.url())) { rec.reqFail++; rec.proxyResFail++ }
  })
  page.on('pageerror', (e) => { if (rec.errs.length < 5) rec.errs.push(String(e.message).slice(0, 160)) })
  page.on('console', (m) => { if (m.type() === 'error' && rec.errs.length < 5) rec.errs.push('c:' + m.text().slice(0, 150)) })

  let status = 0, gotoErr = null
  try {
    const resp = await page.goto(proxied, { waitUntil: 'domcontentloaded', timeout: 20000 })
    status = resp ? resp.status() : 0
  } catch (e) {
    gotoErr = String(e.message).slice(0, 160)
  }
  // Wait for settling (briefly)
  try { await page.waitForLoadState('networkidle', { timeout: 4000 }) } catch {}
  await page.waitForTimeout(700)

  let probe = {}
  try {
    probe = await page.evaluate(() => {
      const body = document.body ? (document.body.innerText || '') : ''
      const q = (s) => document.querySelectorAll(s).length
      const root = document.querySelector('#__next,#root,#app,[data-reactroot]')
      let fiber = false
      if (root) for (const k in root) { if (k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$')) { fiber = true; break } }
      const fw = (window.__NEXT_DATA__ || document.querySelector('#__next')) ? 'next'
        : window.__NUXT__ ? 'nuxt'
        : window.Vue || document.querySelector('[data-v-app]') ? 'vue'
        : document.querySelector('[ng-version]') ? 'angular'
        : root ? 'spa' : ''
      // Next App Router: if flight data was not consumed, hydration failed
      let nextDead = false
      try { if (self.__next_f && Array.isArray(self.__next_f) && self.__next_f.push === Array.prototype.push && self.__next_f.length > 0) nextDead = true } catch {}
      return {
        bodyLen: body.trim().length,
        els: q('*'), links: q('a[href]'),
        buttons: q('button,[role=button],input[type=submit],input[type=button]'),
        inputs: q('input,textarea,select'),
        fw, fiber, nextDead,
        title: (document.title || '').slice(0, 80),
        isErrPage: /Failed to load page|Render failed/.test(body),
      }
    })
  } catch (e) {
    probe.evalErr = String(e.message).slice(0, 100)
  }

  await ctx.close().catch(() => {})

  // ── Classification
  let category, ok = false, note = ''
  const interactiveEls = (probe.links || 0) + (probe.buttons || 0) + (probe.inputs || 0)
  if (gotoErr) { category = 'CONN_FAIL'; note = gotoErr }
  else if (status >= 400 || status === 0) { category = 'CONN_FAIL'; note = 'status ' + status }
  else if (probe.isErrPage) { category = 'CONN_FAIL'; note = 'proxy error page' }
  else if ((probe.bodyLen || 0) < 8 && (probe.els || 0) < 15) { category = 'BLANK'; note = `body=${probe.bodyLen} els=${probe.els}` }
  else if (probe.nextDead || (probe.fw && ['next', 'nuxt', 'vue', 'angular', 'spa'].includes(probe.fw) && !probe.fiber && interactiveEls === 0 && (probe.bodyLen || 0) < 40)) {
    category = 'HYDRATION_FAIL'; note = `fw=${probe.fw} fiber=${probe.fiber} nextDead=${probe.nextDead}`
  }
  else if (rec.proxyResFail > 8 && rec.proxyResFail > rec.reqTotal * 0.35) { category = 'CRAWL_DEGRADED'; note = `${rec.proxyResFail}/${rec.reqTotal} resources failed` }
  else if (interactiveEls === 0 && (probe.bodyLen || 0) < 30) { category = 'LIKELY_BROKEN'; note = `interactive=0 body=${probe.bodyLen}` }
  else { category = 'OK'; ok = true }

  const result = {
    domain, ok, category, status,
    bodyLen: probe.bodyLen || 0, els: probe.els || 0,
    interactiveEls, fw: probe.fw || '', fiber: !!probe.fiber,
    reqTotal: rec.reqTotal, proxyResFail: rec.proxyResFail,
    title: probe.title || '', note,
    errs: rec.errs.slice(0, 3),
  }
  out.write(JSON.stringify(result) + '\n')
  return result
}

// Worker pool
const browser = await chromium.launch({ headless: true })
let idx = 0, okN = 0, failN = 0
const counts = {}
async function worker(wid) {
  while (idx < todo.length) {
    const d = todo[idx++]
    const n = idx
    let r
    try {
      r = await Promise.race([
        checkSite(browser, d),
        new Promise((_, rej) => setTimeout(() => rej(new Error('site-timeout')), SITE_TIMEOUT)),
      ])
    } catch (e) {
      r = { domain: d, ok: false, category: 'TIMEOUT', note: String(e.message), errs: [] }
      out.write(JSON.stringify(r) + '\n')
    }
    counts[r.category] = (counts[r.category] || 0) + 1
    if (r.ok) okN++; else failN++
    if (n % 20 === 0 || n === todo.length) {
      log(`${n}/${todo.length}  OK=${okN} FAIL=${failN}  latest: ${d} → ${r.category}`)
    }
  }
}
await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)))
await browser.close()
log('Done. Categories: ' + JSON.stringify(counts))
out.end()
