// server/session.js — login session capture.
// Opens a headed (visible) Chromium window so the user can log in themselves, then saves
// that origin's storageState (cookies + localStorage). Subsequent render/snapshot/screenshot runs use that session.
// ⚠ Session files hold credentials, so sessions/ is gitignored.
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

// storageState file path for render.js to use (null if none)
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

// ─────────────────────────────────────────── interactive login (2 steps)
let _counter = 0
const _live = new Map() // token -> { browser, context, url }

export async function startLogin(url) {
  let pw
  try {
    pw = await import('playwright')
  } catch {
    const e = new Error('Playwright is not installed.')
    e.code = 'NO_RENDERER'
    throw e
  }
  let browser
  try {
    browser = await pw.chromium.launch({ headless: false })
  } catch (err) {
    const e = new Error('Cannot open a browser window (no display?). ' + (err && err.message))
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
    const e = new Error('Login session expired or missing.')
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
