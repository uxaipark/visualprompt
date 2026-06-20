// exporters.js — 수집된 핀들을 수정 하니스(markdown/json)로 변환 + 스크린샷 다운로드.

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

export function buildMarkdown(entries, pageUrl, views = []) {
  const lines = []
  lines.push(`# UI 수정 하니스 (Modification Harness)`)
  lines.push('')
  lines.push(`- 기준 페이지: \`${pageUrl || '(none)'}\``)
  lines.push(`- 핀 개수: ${entries.length}`)
  lines.push(`- 생성: ${new Date().toISOString()}`)
  lines.push('')

  if (views && views.length) {
    lines.push(`## 🧭 탐색 기록 (클릭 → 화면)`)
    lines.push('')
    views.forEach((v, i) => {
      const trig = v.trigger ? `클릭: "${v.trigger.text || v.trigger.label || v.trigger.selector}"` : `(${v.reason || 'load'})`
      lines.push(`${i + 1}. **${v.title || '(제목 없음)'}** — ${trig}`)
      if (v.heading) lines.push(`   - 헤딩: ${v.heading}`)
      if (v.url) lines.push(`   - URL: \`${v.url}\``)
      if (v.framework) lines.push(`   - 프레임워크: ${v.framework}`)
      if (v.apiCalls && v.apiCalls.length) {
        lines.push(`   - 호출 API: ${v.apiCalls.map((a) => `\`${a.method} ${a.path}\``).join(', ')}`)
      }
    })
    lines.push('')
  }

  lines.push(`## 핀 목록`)
  lines.push('')
  entries.forEach((e, i) => {
    const el = e.element || {}
    lines.push(`### ${i + 1}. ${el.tag || 'element'}${el.id ? '#' + el.id : ''}`)
    lines.push('')
    lines.push(`- **프롬프트**: ${e.prompt}`)
    if (e.view) {
      lines.push(`- **화면(뷰)**: ${e.view.title || ''}${e.view.heading ? ' / ' + e.view.heading : ''}`)
    }
    lines.push(`- **selector**: \`${el.selector || ''}\``)
    lines.push(`- **xpath**: \`${el.xpath || ''}\``)
    if (el.rect) lines.push(`- **위치**: x=${el.rect.x} y=${el.rect.y} w=${el.rect.w} h=${el.rect.h}`)
    if (el.text) lines.push(`- **텍스트**: ${el.text}`)

    const clues = e.clues
    if (clues) {
      lines.push(`- **소스코드 단서**:`)
      if (clues.framework) lines.push(`  - 프레임워크: ${clues.framework}`)
      const fe = frontendSearchTerms(clues)
      if (fe.length) lines.push(`  - 프론트엔드 검색어(코드에서 찾기): ${fe.map((t) => `\`${t}\``).join(', ')}`)
      if (clues.bundles && clues.bundles.length) {
        lines.push(`  - 번들: ${clues.bundles.slice(0, 6).map((b) => `\`${b}\``).join(', ')}`)
      }
      const be = backendApiPaths(clues)
      if (be.length) lines.push(`  - 백엔드 API 경로(서버 코드에서 찾기): ${be.map((t) => `\`${t}\``).join(', ')}`)
    }
    lines.push('')
  })

  lines.push('---')
  lines.push('> 프론트엔드는 위 "검색어"로, 백엔드는 "API 경로"로 소스 코드를 찾아 타깃만 수정하세요.')
  return lines.join('\n')
}

export function buildJson(entries, pageUrl, views = []) {
  return {
    page: pageUrl || null,
    generatedAt: new Date().toISOString(),
    views: (views || []).map((v) => ({
      title: v.title,
      heading: v.heading,
      url: v.url,
      trigger: v.trigger || null,
      reason: v.reason,
      framework: v.framework,
      apiCalls: v.apiCalls || [],
    })),
    pins: entries.map((e) => ({
      id: e.id,
      prompt: e.prompt,
      page: e.page || null,
      view: e.view ? { title: e.view.title, heading: e.view.heading, url: e.view.url } : null,
      element: e.element || null,
      clues: e.clues || null,
      snapshot: e.snapshot || null,
      sourceHints: e.clues
        ? { frontend: frontendSearchTerms(e.clues), backend: backendApiPaths(e.clues) }
        : null,
    })),
  }
}

// 브라우저 다운로드 헬퍼
export function download(name, text, type) {
  const blob = new Blob([text], { type })
  triggerDownload(name, URL.createObjectURL(blob))
}

function triggerDownload(name, href) {
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

// 서버 렌더 스크린샷 PNG 다운로드 (요구2)
export async function downloadScreenshot(pageUrl) {
  const r = await fetch('/api/screenshot?url=' + encodeURIComponent(pageUrl))
  if (!r.ok) {
    let msg = r.status
    try {
      msg = (await r.json()).error || msg
    } catch {}
    throw new Error(String(msg))
  }
  const blob = await r.blob()
  const href = URL.createObjectURL(blob)
  const safe = pageUrl.replace(/[^\w.-]+/g, '_').slice(0, 60)
  triggerDownload(`screenshot_${safe}.png`, href)
}
