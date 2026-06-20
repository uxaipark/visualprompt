// server/inbox.js — fixpoint(수정 포인트) inbox.
// 핀 하나 = pending/fp-NNN.{json,md} 파일 하나. 서버에서 도는 에이전트(Claude Code 등)가
// pending 을 읽어 실제 소스를 고치고 applied 로 옮긴다.
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

// 다음 일련번호 — pending/applied 양쪽의 fp-NNN 중 최대 +1
function nextSeq() {
  let max = 0
  for (const dir of [PENDING, APPLIED]) {
    let names = []
    try {
      names = fs.readdirSync(dir)
    } catch {
      /* 없으면 0 */
    }
    for (const n of names) {
      const m = n.match(/^fp-(\d+)\./)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
  }
  return max + 1
}

const pad = (n) => String(n).padStart(3, '0')

// ─────────────────────────────────────── 검색어/힌트 도출 (exporters 와 동일 규칙)
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

// ─────────────────────────────────────── 단일 fixpoint markdown
function fixpointMarkdown(fp) {
  const el = fp.element || {}
  const clues = fp.clues || {}
  const L = []
  L.push(`# Fixpoint ${fp.id}`)
  L.push('')
  L.push(`> 상태: **pending** · 생성: ${fp.createdAt}`)
  L.push('')
  L.push(`## 수정 지시 (사용자 프롬프트)`)
  L.push('')
  L.push(fp.prompt || '(없음)')
  L.push('')
  L.push(`## 대상 요소`)
  L.push('')
  L.push(`- **태그**: \`${el.tag || ''}${el.id ? '#' + el.id : ''}\``)
  L.push(`- **selector**: \`${el.selector || ''}\``)
  L.push(`- **xpath**: \`${el.xpath || ''}\``)
  if (el.rect) L.push(`- **위치**: x=${el.rect.x} y=${el.rect.y} w=${el.rect.w} h=${el.rect.h}`)
  if (el.text) L.push(`- **텍스트**: ${el.text}`)
  L.push('')
  L.push(`## 페이지 / 뷰`)
  L.push('')
  L.push(`- **page**: \`${fp.page || ''}\``)
  if (fp.target?.mode) L.push(`- **mode**: ${fp.target.mode}${fp.target.repoRoot ? ` (repoRoot: \`${fp.target.repoRoot}\`)` : ''}`)
  if (fp.view) L.push(`- **view**: ${fp.view.title || ''}${fp.view.heading ? ' / ' + fp.view.heading : ''}`)
  if (clues.framework) L.push(`- **framework**: ${clues.framework}`)
  L.push('')
  L.push(`## 소스코드에서 찾을 단서`)
  L.push('')
  const fe = frontendSearchTerms(clues)
  if (fe.length) L.push(`- **프론트엔드 검색어**: ${fe.map((t) => `\`${t}\``).join(', ')}`)
  const be = backendApiPaths(clues)
  if (be.length) L.push(`- **백엔드 API 경로**: ${be.map((t) => `\`${t}\``).join(', ')}`)
  if (clues.bundles?.length) L.push(`- **번들**: ${clues.bundles.slice(0, 6).map((b) => `\`${b}\``).join(', ')}`)
  if (fp.fileHints?.length) L.push(`- **추정 파일**: ${fp.fileHints.map((f) => `\`${f}\``).join(', ')}`)
  L.push('')
  L.push('---')
  L.push('> 에이전트: 위 검색어로 레포에서 해당 소스를 찾아 "수정 지시"대로 고치고,')
  L.push('> 처리 후 이 파일을 `fixpoints/applied/` 로 옮기세요.')
  return L.join('\n')
}

// ─────────────────────────────────────── 파일 경로 힌트(local 모드)
// repoRoot 가 있으면 selector/단서를 단순 추론으로 후보 경로화 (확정 아님, 힌트)
function deriveFileHints(fp) {
  const hints = []
  const clues = fp.clues || {}
  for (const c of clues.components || []) hints.push(`**/${c}*.{jsx,tsx,vue,svelte}`)
  for (const t of clues.testids || []) hints.push(`grep: data-testid="${t}"`)
  return hints.slice(0, 8)
}

// ─────────────────────────────────────── 공개 API
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

// ─────────────────────────────────────── 에이전트 지침서
function writeAgentReadme() {
  const txt = `# 에이전트 작업 지침 (fixpoints inbox)

이 디렉토리는 **VisualPrompt** 가 수집한 "수정 포인트(fixpoint)" 의 inbox 입니다.

## 구조
- \`pending/\` — 아직 처리되지 않은 fixpoint. \`fp-NNN.json\` (구조화 데이터) + \`fp-NNN.md\` (사람/에이전트용 요약).
- \`applied/\` — 처리 완료해 옮겨진 fixpoint.

## 처리 절차
1. \`pending/\` 의 각 \`fp-NNN.md\` 를 읽는다.
2. "수정 지시" 와 "소스코드에서 찾을 단서"(검색어/추정 파일)를 사용해 레포에서 대상 소스를 찾는다.
   - 프론트엔드 검색어: \`data-testid=...\`, \`.class\`, \`#id\`, \`component:...\` 로 grep.
   - \`target.repoRoot\` 가 있으면 그 레포 안에서 찾는다 (local 모드).
3. 지시대로 소스를 수정한다. 타깃 요소만 정확히 고치고 무관한 코드는 건드리지 않는다.
4. 처리한 fixpoint 파일(\`.json\`, \`.md\`)을 \`applied/\` 로 옮긴다.

## json 스키마 핵심 필드
- \`prompt\`     — 사용자가 작성한 수정 지시
- \`element\`    — { tag, id, selector, xpath, rect, text, classes }
- \`clues\`      — { framework, testids, components, ids, labels, classes, bundles, api }
- \`sourceHints\`— { frontend: [...], backend: [...] }
- \`fileHints\`  — 추정 파일 glob/grep 후보
- \`target\`     — { mode: 'local'|'proxy', url, repoRoot }
`
  try {
    fs.writeFileSync(path.join(FIXPOINTS_ROOT, 'AGENT.md'), txt, 'utf8')
  } catch {
    /* ignore */
  }
}
