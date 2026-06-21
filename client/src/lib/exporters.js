// exporters.js — Convert collected pins into a modification harness (markdown/json) + screenshot download.

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
  lines.push(`# UI Modification Harness`)
  lines.push('')
  lines.push(`- Base page: \`${pageUrl || '(none)'}\``)
  lines.push(`- Pin count: ${entries.length}`)
  lines.push(`- Generated: ${new Date().toISOString()}`)
  lines.push('')

  if (views && views.length) {
    lines.push(`## 🧭 Navigation history (click → screen)`)
    lines.push('')
    views.forEach((v, i) => {
      const trig = v.trigger ? `Click: "${v.trigger.text || v.trigger.label || v.trigger.selector}"` : `(${v.reason || 'load'})`
      lines.push(`${i + 1}. **${v.title || '(no title)'}** — ${trig}`)
      if (v.heading) lines.push(`   - Heading: ${v.heading}`)
      if (v.url) lines.push(`   - URL: \`${v.url}\``)
      if (v.framework) lines.push(`   - Framework: ${v.framework}`)
      if (v.apiCalls && v.apiCalls.length) {
        lines.push(`   - API calls: ${v.apiCalls.map((a) => `\`${a.method} ${a.path}\``).join(', ')}`)
      }
    })
    lines.push('')
  }

  lines.push(`## Pins`)
  lines.push('')
  entries.forEach((e, i) => {
    const el = e.element || {}
    lines.push(`### ${i + 1}. ${el.tag || 'element'}${el.id ? '#' + el.id : ''}`)
    lines.push('')
    lines.push(`- **Prompt**: ${e.prompt}`)
    if (e.view) {
      lines.push(`- **Screen (view)**: ${e.view.title || ''}${e.view.heading ? ' / ' + e.view.heading : ''}`)
    }
    lines.push(`- **selector**: \`${el.selector || ''}\``)
    lines.push(`- **xpath**: \`${el.xpath || ''}\``)
    if (el.rect) lines.push(`- **Position**: x=${el.rect.x} y=${el.rect.y} w=${el.rect.w} h=${el.rect.h}`)
    if (el.text) lines.push(`- **Text**: ${el.text}`)

    const clues = e.clues
    if (clues) {
      lines.push(`- **Source-code clues**:`)
      if (clues.framework) lines.push(`  - Framework: ${clues.framework}`)
      const fe = frontendSearchTerms(clues)
      if (fe.length) lines.push(`  - Frontend search terms (find in code): ${fe.map((t) => `\`${t}\``).join(', ')}`)
      if (clues.bundles && clues.bundles.length) {
        lines.push(`  - Bundles: ${clues.bundles.slice(0, 6).map((b) => `\`${b}\``).join(', ')}`)
      }
      const be = backendApiPaths(clues)
      if (be.length) lines.push(`  - Backend API paths (find in server code): ${be.map((t) => `\`${t}\``).join(', ')}`)
    }
    lines.push('')
  })

  lines.push('---')
  lines.push('> For the frontend, locate source code using the "search terms" above; for the backend, use the "API paths". Edit only the targets.')
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

// Browser download helper
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

// Download server-rendered screenshot PNG (req2)
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
