// server/snapshot.js — full-resource offline snapshot save/read/delete + AI edit (preview).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as cheerio from 'cheerio'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

export const SNAP_ROOT = path.join(ROOT, 'snapshots')

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

export function keyForUrl(url) {
  return crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 16)
}

function dirForUrl(url) {
  return path.join(SNAP_ROOT, keyForUrl(url))
}
function htmlPathFor(url) {
  return path.join(dirForUrl(url), 'index.html')
}
function manifestPathFor(url) {
  return path.join(dirForUrl(url), 'manifest.json')
}

export function hasSnapshot(url) {
  try {
    return fs.existsSync(htmlPathFor(url))
  } catch {
    return false
  }
}

export function readSnapshotHtml(url) {
  return fs.readFileSync(htmlPathFor(url), 'utf8')
}

function readManifest(url) {
  try {
    return JSON.parse(fs.readFileSync(manifestPathFor(url), 'utf8'))
  } catch {
    return null
  }
}
function writeManifest(url, manifest) {
  fs.writeFileSync(manifestPathFor(url), JSON.stringify(manifest, null, 2), 'utf8')
}

export function snapshotStatus(url) {
  const exists = hasSnapshot(url)
  const key = keyForUrl(url)
  if (!exists) return { exists: false, key, url }
  const m = readManifest(url) || {}
  return {
    exists: true,
    key,
    url,
    dir: dirForUrl(url),
    htmlPath: htmlPathFor(url),
    savedAt: m.savedAt || null,
    resourceCount: m.resourceCount || 0,
    edits: m.edits || [],
  }
}

const RES_SELECTORS = [
  ['script[src]', 'src'],
  ['link[href]', 'href'],
  ['img[src]', 'src'],
  ['source[src]', 'src'],
  ['video[src]', 'src'],
  ['audio[src]', 'src'],
]

function localNameFor(absUrl, idx) {
  let ext = ''
  try {
    const u = new URL(absUrl)
    ext = path.extname(u.pathname)
  } catch {
    /* ignore */
  }
  if (!ext || ext.length > 6) ext = '.bin'
  const h = crypto.createHash('sha1').update(absUrl).digest('hex').slice(0, 12)
  return `r${idx}_${h}${ext}`
}

export async function saveSnapshot(url, opts = {}) {
  const dir = dirForUrl(url)
  ensureDir(dir)
  const resDir = path.join(dir, 'res')
  ensureDir(resDir)

  let finalUrl = url
  let html
  let mode = 'fetch'
  if (opts.render) {
    // Render mode: crawl the fully-built DOM with a headless browser (SPA/Figma/tough sites)
    const { renderHtml } = await import('./render.js')
    const r = await renderHtml(url)
    html = r.html
    finalUrl = r.finalUrl || url
    mode = 'render'
  } else {
    const ac = new AbortController()
    const tmo = setTimeout(() => ac.abort(), 20000)
    let resp
    try {
      resp = await fetch(url, {
        redirect: 'follow',
        signal: ac.signal,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en;q=0.9',
        },
      })
    } finally {
      clearTimeout(tmo)
    }
    if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`)
    finalUrl = resp.url || url
    html = await resp.text()
  }

  html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '')
  const $ = cheerio.load(html, { decodeEntities: false })
  $('[integrity]').removeAttr('integrity')

  const key = keyForUrl(url)
  const snapBase = `/snap/${key}/res/`
  let idx = 0
  const tasks = []

  for (const [sel, attr] of RES_SELECTORS) {
    $(sel).each((_, el) => {
      const $el = $(el)
      const v = $el.attr(attr)
      if (!v || /^(data:|blob:|javascript:|#)/i.test(v)) return
      let abs
      try {
        abs = new URL(v, finalUrl).href
      } catch {
        return
      }
      if (!/^https?:/i.test(abs)) return
      const name = localNameFor(abs, idx++)
      $el.attr(attr, snapBase + name)
      tasks.push({ abs, file: path.join(resDir, name) })
    })
  }

  let saved = 0
  await Promise.all(
    tasks.map(async (t) => {
      const ac = new AbortController()
      const tmo = setTimeout(() => ac.abort(), 15000)
      try {
        const r = await fetch(t.abs, { headers: { 'user-agent': 'Mozilla/5.0 VP-Snapshot' }, signal: ac.signal })
        if (!r.ok) return
        const buf = Buffer.from(await r.arrayBuffer())
        fs.writeFileSync(t.file, buf)
        saved++
      } catch {
        /* tolerate missing resources/timeouts */
      } finally {
        clearTimeout(tmo)
      }
    }),
  )

  fs.writeFileSync(htmlPathFor(url), $.html(), 'utf8')
  writeManifest(url, {
    url,
    finalUrl,
    key,
    mode,
    savedAt: new Date().toISOString(),
    resourceCount: saved,
    edits: [],
  })
  return { ok: true, ...snapshotStatus(url) }
}

export function deleteSnapshot(url) {
  const dir = dirForUrl(url)
  try {
    fs.rmSync(dir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────── AI edit (Anthropic SDK, preview)
class EditError extends Error {
  constructor(code, message) {
    super(message || code)
    this.code = code
  }
}

export async function editSnapshot({ url, selector, prompt }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new EditError('NO_API_KEY', 'ANTHROPIC_API_KEY is not set.')
  if (!hasSnapshot(url)) throw new EditError('NO_SNAPSHOT', 'No local snapshot. Save one first.')

  const html = readSnapshotHtml(url)
  const $ = cheerio.load(html, { decodeEntities: false })
  let target
  try {
    target = $(selector).first()
  } catch {
    throw new EditError('NO_ELEMENT', 'Invalid selector: ' + selector)
  }
  if (!target || target.length === 0) {
    throw new EditError('NO_ELEMENT', 'Element not found: ' + selector)
  }
  const original = $.html(target)
  if (original.length > 200_000) throw new EditError('TOO_LARGE', 'Target element is too large.')

  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })

  const sys =
    'You are a precise HTML editor. Modify the single given element outerHTML per the user instruction ' +
    'and return only the modified outerHTML. Output HTML only, with no explanation or code fences. ' +
    'Change the structure (tags/attributes) only as much as the instruction requires, and preserve classes/identifiers where possible.'
  const user = `Target element outerHTML:\n${original}\n\nEdit instruction:\n${prompt}\n\nOutput only the modified outerHTML:`

  let resp
  try {
    resp = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      system: sys,
      messages: [{ role: 'user', content: user }],
    })
  } catch (err) {
    throw new EditError('EMPTY', 'AI call failed: ' + String(err && err.message))
  }

  let edited = ''
  for (const block of resp.content || []) {
    if (block.type === 'text') edited += block.text
  }
  edited = edited.trim().replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim()
  if (!edited) throw new EditError('EMPTY', 'Empty AI response.')

  target.replaceWith(edited)
  fs.writeFileSync(htmlPathFor(url), $.html(), 'utf8')

  const manifest = readManifest(url) || { url, key: keyForUrl(url), edits: [] }
  manifest.edits = manifest.edits || []
  manifest.edits.push({ selector, prompt, at: new Date().toISOString() })
  writeManifest(url, manifest)

  return { ok: true, selector, before: original, after: edited }
}
