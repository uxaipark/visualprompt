// server/render.js — 헤드리스 Chromium 렌더 엔진.
// SPA/Figma/봇차단/로그인 사이트를 "진짜 브라우저"로 렌더해 완성된 DOM 을 떠 오고,
// 풀페이지 스크린샷을 찍는다. Playwright 가 없으면 graceful 하게 실패한다.
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
    const e = new Error('Playwright 가 설치되지 않았습니다. `npm i playwright && npx playwright install chromium`')
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
  // networkidle 우선, 실패 시 load 폴백 — 무한 polling SPA 대비
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: timeout || 30000 })
  } catch {
    await page.goto(url, { waitUntil: 'load', timeout: timeout || 30000 }).catch(() => {})
  }
  // 하이드레이션 여유
  await page.waitForTimeout(600)
}

// 저장된 로그인 세션이 있으면 자동 주입 (opts.noSession 으로 끌 수 있음)
function withSession(url, opts) {
  if (opts.noSession || opts.storageState) return opts
  const state = storageStateFor(url)
  return state ? { ...opts, storageState: state } : opts
}

// 렌더된 HTML(완성 DOM) + 최종 URL 반환
export async function renderHtml(url, opts = {}) {
  return withPage(async (page) => {
    await gotoSettled(page, url, opts.timeout)
    const html = await page.content()
    const finalUrl = page.url() || url
    return { html, finalUrl }
  }, withSession(url, opts))
}

// 풀페이지 PNG 스크린샷 버퍼
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
