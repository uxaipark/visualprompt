// server/inbox.js — fixpoint (edit point) inbox.
// One pin = one pending/fp-NNN.{json,md} file pair. An agent running on the server (Claude Code, etc.)
// reads pending, edits the actual source, and moves it to applied.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

export const FIXPOINTS_ROOT = path.join(ROOT, 'fixpoints')
const PENDING = path.join(FIXPOINTS_ROOT, 'pending')
const APPLIED = path.join(FIXPOINTS_ROOT, 'applied')

function ensureDirs() {
  fs.mkdirSync(PENDING, { recursive: true })
  fs.mkdirSync(APPLIED, { recursive: true })
}

// Next sequence number — max fp-NNN across both pending/applied, +1
function nextSeq() {
  let max = 0
  for (const dir of [PENDING, APPLIED]) {
    let names = []
    try {
      names = fs.readdirSync(dir)
    } catch {
      /* none -> 0 */
    }
    for (const n of names) {
      const m = n.match(/^fp-(\d+)\./)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
  }
  return max + 1
}

const pad = (n) => String(n).padStart(3, '0')

// ─────────────────────────────────────── Search-term/hint derivation (same rules as exporters)
function frontendSearchTerms(clues) {
  if (!clues) return []
  const terms = []
  for (const t of clues.testids || []) terms.push(`data-testid="${t}"`)
  for (const c of clues.components || []) terms.push(`component:${c}`)
  for (const id of clues.ids || []) terms.push(`#${id}`)
  for (const l of clues.labels || []) terms.push(l)
  for (const c of (clues.classes || []).slice(0, 6)) terms.push(`.${c}`)
  return terms
}
function backendApiPaths(clues) {
  if (!clues || !clues.api) return []
  return clues.api.map((a) => `${a.method} ${a.path}`)
}

// ─────────────────────────────────────── Single fixpoint markdown
function fixpointMarkdown(fp) {
  const el = fp.element || {}
  const clues = fp.clues || {}
  const L = []
  L.push(`# Fixpoint ${fp.id}`)
  L.push('')
  L.push(`> status: **pending** · created: ${fp.createdAt}`)
  L.push('')
  L.push(`## Edit instruction (user prompt)`)
  L.push('')
  L.push(fp.prompt || '(none)')
  L.push('')
  L.push(`## Target element`)
  L.push('')
  L.push(`- **tag**: \`${el.tag || ''}${el.id ? '#' + el.id : ''}\``)
  L.push(`- **selector**: \`${el.selector || ''}\``)
  L.push(`- **xpath**: \`${el.xpath || ''}\``)
  if (el.rect) L.push(`- **position**: x=${el.rect.x} y=${el.rect.y} w=${el.rect.w} h=${el.rect.h}`)
  if (el.text) L.push(`- **text**: ${el.text}`)
  L.push('')
  L.push(`## Page / view`)
  L.push('')
  L.push(`- **page**: \`${fp.page || ''}\``)
  if (fp.target?.mode) L.push(`- **mode**: ${fp.target.mode}${fp.target.repoRoot ? ` (repoRoot: \`${fp.target.repoRoot}\`)` : ''}`)
  if (fp.view) L.push(`- **view**: ${fp.view.title || ''}${fp.view.heading ? ' / ' + fp.view.heading : ''}`)
  if (clues.framework) L.push(`- **framework**: ${clues.framework}`)
  L.push('')
  L.push(`## Source-code search clues`)
  L.push('')
  const fe = frontendSearchTerms(clues)
  if (fe.length) L.push(`- **Frontend search terms**: ${fe.map((t) => `\`${t}\``).join(', ')}`)
  const be = backendApiPaths(clues)
  if (be.length) L.push(`- **Backend API paths**: ${be.map((t) => `\`${t}\``).join(', ')}`)
  if (clues.bundles?.length) L.push(`- **Bundles**: ${clues.bundles.slice(0, 6).map((b) => `\`${b}\``).join(', ')}`)
  if (fp.fileHints?.length) L.push(`- **Candidate files**: ${fp.fileHints.map((f) => `\`${f}\``).join(', ')}`)
  L.push('')
  L.push('---')
  L.push('> Agent: find the source in the repo using the search terms above, edit per the "Edit instruction",')
  L.push('> then move this file to `fixpoints/applied/`.')
  return L.join('\n')
}

// ─────────────────────────────────────── File-path hints (local mode)
// If repoRoot is present, derive candidate paths from selector/clues via simple inference (hints, not definitive)
function deriveFileHints(fp) {
  const hints = []
  const clues = fp.clues || {}
  for (const c of clues.components || []) hints.push(`**/${c}*.{jsx,tsx,vue,svelte}`)
  for (const t of clues.testids || []) hints.push(`grep: data-testid="${t}"`)
  return hints.slice(0, 8)
}

// ─────────────────────────────────────── Public API
export function saveFixpoint(input) {
  ensureDirs()
  const seq = nextSeq()
  const id = `fp-${pad(seq)}`
  const fp = {
    id,
    createdAt: new Date().toISOString(),
    status: 'pending',
    prompt: input.prompt || '',
    page: input.page || null,
    target: input.target || null,
    view: input.view || null,
    element: input.element || null,
    clues: input.clues || null,
    sourceHints: input.clues
      ? { frontend: frontendSearchTerms(input.clues), backend: backendApiPaths(input.clues) }
      : null,
    snapshot: input.snapshot || null,
  }
  fp.fileHints = deriveFileHints(fp)

  const jsonPath = path.join(PENDING, `${id}.json`)
  const mdPath = path.join(PENDING, `${id}.md`)
  fs.writeFileSync(jsonPath, JSON.stringify(fp, null, 2), 'utf8')
  fs.writeFileSync(mdPath, fixpointMarkdown(fp), 'utf8')
  writeAgentReadme()
  return { ok: true, id, jsonPath, mdPath, fixpoint: fp }
}

function listDir(dir, status) {
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((n) => /^fp-\d+\.json$/.test(n))
    .map((n) => {
      try {
        const fp = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))
        return { ...fp, status }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function listFixpoints() {
  ensureDirs()
  return {
    pending: listDir(PENDING, 'pending'),
    applied: listDir(APPLIED, 'applied'),
  }
}

export function applyFixpoint(id) {
  ensureDirs()
  let moved = 0
  for (const ext of ['json', 'md']) {
    const from = path.join(PENDING, `${id}.${ext}`)
    const to = path.join(APPLIED, `${id}.${ext}`)
    if (fs.existsSync(from)) {
      fs.renameSync(from, to)
      moved++
    }
  }
  return { ok: moved > 0, id, moved }
}

export function deleteFixpoint(id) {
  let removed = 0
  for (const dir of [PENDING, APPLIED]) {
    for (const ext of ['json', 'md']) {
      const p = path.join(dir, `${id}.${ext}`)
      if (fs.existsSync(p)) {
        fs.rmSync(p)
        removed++
      }
    }
  }
  return { ok: removed > 0, id, removed }
}

// ─────────────────────────────────────── Agent instructions
function writeAgentReadme() {
  const txt = `# Agent instructions (fixpoints inbox)

This directory is the inbox of "fixpoints" (edit points) collected by **VisualPrompt**.

## Structure
- \`pending/\` — fixpoints not yet processed. \`fp-NNN.json\` (structured data) + \`fp-NNN.md\` (summary for humans/agents).
- \`applied/\` — fixpoints that have been processed and moved here.

## Processing steps
1. Read each \`fp-NNN.md\` in \`pending/\`.
2. Use the "Edit instruction" and the "Source-code search clues" (search terms/candidate files) to find the target source in the repo.
   - Frontend search terms: grep for \`data-testid=...\`, \`.class\`, \`#id\`, \`component:...\`.
   - If \`target.repoRoot\` is present, search within that repo (local mode).
3. Edit the source per the instruction. Change only the target element precisely and do not touch unrelated code.
4. Move the processed fixpoint files (\`.json\`, \`.md\`) to \`applied/\`.

## Key JSON schema fields
- \`prompt\`     — the edit instruction written by the user
- \`element\`    — { tag, id, selector, xpath, rect, text, classes }
- \`clues\`      — { framework, testids, components, ids, labels, classes, bundles, api }
- \`sourceHints\`— { frontend: [...], backend: [...] }
- \`fileHints\`  — candidate file glob/grep patterns
- \`target\`     — { mode: 'local'|'proxy', url, repoRoot }
`
  try {
    fs.writeFileSync(path.join(FIXPOINTS_ROOT, 'AGENT.md'), txt, 'utf8')
  } catch {
    /* ignore */
  }
}
