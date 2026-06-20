// server/session.js — 로그인 세션 수집.
// 헤드드(보이는) Chromium 창을 띄워 사용자가 직접 로그인하면, 그 origin 의
// storageState(쿠키+localStorage)를 저장한다. 이후 렌더/스냅샷/스크린샷은 그 세션으로 동작.
// ⚠ 세션 파일은 인증정보를 담으므로 sessions/ 는 .gitignore 대상이다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

export const SESSIONS_ROOT = path.join(ROOT, 'sessions')

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
function safeHost(url) {
  return hostOf(url).replace(/[^\w.-]+/g, '_')
}
function sessionPath(url) {
  return path.join(SESSIONS_ROOT, safeHost(url) + '.json')
}

export function hasSession(url) {
  try {
    return fs.existsSync(sessionPath(url))
  } catch {
    return false
  }
}

// render.js 가 사용할 storageState 파일 경로 (없으면 null)
export function storageStateFor(url) {
  return hasSession(url) ? sessionPath(url) : null
}

export function sessionStatus(url) {
  const exists = hasSession(url)
  if (!exists) return { exists: false, host: hostOf(url) }
  let savedAt = null
  try {
    savedAt = fs.statSync(sessionPath(url)).mtime.toISOString()
  } catch {}
  return { exists: true, host: hostOf(url), savedAt }
}

export function clearSession(url) {
  try {
    fs.rmSync(sessionPath(url))
    return true
  } catch {
    return false
  }
}

// ─────────────────────────────────────────── 인터랙티브 로그인 (2단계)
let _counter = 0
const _live = new Map() // token -> { browser, context, url }

export async function startLogin(url) {
  let pw
  try {
    pw = await import('playwright')
  } catch {
    const e = new Error('Playwright 가 설치되지 않았습니다.')
    e.code = 'NO_RENDERER'
    throw e
  }
  let browser
  try {
    browser = await pw.chromium.launch({ headless: false })
  } catch (err) {
    const e = new Error('브라우저 창을 띄울 수 없습니다(디스플레이 없음?). ' + (err && err.message))
    e.code = 'NO_DISPLAY'
    throw e
  }
  const context = await browser.newContext({
    userAgent: UA,
    locale: 'ko-KR',
    viewport: { width: 1280, height: 860 },
    ...(hasSession(url) ? { storageState: sessionPath(url) } : {}),
  })
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})

  const token = 'login_' + ++_counter
  _live.set(token, { browser, context, url })
  return { token, host: hostOf(url) }
}

export async function saveLogin(token) {
  const rec = _live.get(token)
  if (!rec) {
    const e = new Error('로그인 세션이 만료되었거나 없습니다.')
    e.code = 'NO_LOGIN'
    throw e
  }
  fs.mkdirSync(SESSIONS_ROOT, { recursive: true })
  const state = await rec.context.storageState()
  fs.writeFileSync(sessionPath(rec.url), JSON.stringify(state), 'utf8')
  await rec.browser.close().catch(() => {})
  _live.delete(token)
  return { ok: true, ...sessionStatus(rec.url) }
}

export async function cancelLogin(token) {
  const rec = _live.get(token)
  if (rec) {
    await rec.browser.close().catch(() => {})
    _live.delete(token)
  }
  return { ok: true }
}
