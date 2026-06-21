// server/render.js — headless Chromium render engine.
// Renders SPA/Figma/bot-blocked/login sites in a "real browser" to grab the fully-built DOM
// and takes full-page screenshots. Fails gracefully when Playwright is unavailable.
import { storageStateFor } from './session.js'

let _pw = null
let _browser = null
let _available = null

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export async function renderAvailable() {
  if (_available != null) return _available
  try {
    _pw = await import('playwright')
    _available = true
  } catch {
    _available = false
  }
  return _available
}

async function getBrowser() {
  if (!(await renderAvailable())) {
    const e = new Error('Playwright is not installed. `npm i playwright && npx playwright install chromium`')
    e.code = 'NO_RENDERER'
    throw e
  }
  if (_browser && _browser.isConnected()) return _browser
  _browser = await _pw.chromium.launch({ headless: true })
  return _browser
}

async function withPage(fn, opts = {}) {
  const browser = await getBrowser()
  const context = await browser.newContext({
    userAgent: UA,
    locale: 'ko-KR',
    viewport: { width: opts.width || 1440, height: opts.height || 900 },
    deviceScaleFactor: 1,
    ...(opts.storageState ? { storageState: opts.storageState } : {}),
  })
  const page = await context.newPage()
  try {
    return await fn(page, context)
  } finally {
    await context.close().catch(() => {})
  }
}

async function gotoSettled(page, url, timeout) {
  // Prefer networkidle, fall back to load on failure — guards against infinitely polling SPAs
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: timeout || 30000 })
  } catch {
    await page.goto(url, { waitUntil: 'load', timeout: timeout || 30000 }).catch(() => {})
  }
  // Allow time for hydration
  await page.waitForTimeout(600)
}

// Auto-inject a saved login session if one exists (can be disabled via opts.noSession)
function withSession(url, opts) {
  if (opts.noSession || opts.storageState) return opts
  const state = storageStateFor(url)
  return state ? { ...opts, storageState: state } : opts
}

// Returns the rendered HTML (fully-built DOM) + final URL
export async function renderHtml(url, opts = {}) {
  return withPage(async (page) => {
    await gotoSettled(page, url, opts.timeout)
    const html = await page.content()
    const finalUrl = page.url() || url
    return { html, finalUrl }
  }, withSession(url, opts))
}

// Full-page PNG screenshot buffer
export async function screenshot(url, opts = {}) {
  return withPage(async (page) => {
    await gotoSettled(page, url, opts.timeout)
    const buf = await page.screenshot({ fullPage: opts.fullPage !== false, type: 'png' })
    return buf
  }, withSession(url, opts))
}

export async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {})
    _browser = null
  }
}
