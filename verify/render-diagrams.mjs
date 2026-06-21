// render-diagrams.mjs — Mermaid 정의를 Playwright 로 렌더해 docs/images/*.svg 로 저장.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '..', 'docs', 'images')
fs.mkdirSync(OUT, { recursive: true })

const diagrams = {
  'architecture': `flowchart TB
  subgraph HOST["React Host App  (:5173 dev / dist prod)"]
    direction LR
    TBAR["Toolbar<br/>URL · mode · snapshot · session · pin-toggle"]
    APP["App.jsx<br/>relay + state store"]
    SIDE["SidePanel<br/>pins · views · inbox · export"]
  end
  subgraph FRAME["iframe.page-frame  (same-origin, proxied)"]
    SHIM["shim.js<br/>runtime hooks"]
    INSP["inspector.js<br/>pins · locators · clues"]
  end
  APP <== "postMessage<br/>(vp-host ⇄ vp)" ==> INSP
  subgraph SRV["Express Server  :3001"]
    PROXY["/proxy<br/>all methods · rewrite · inject"]
    APIS["/api/*<br/>config · snapshot · screenshot<br/>fixpoints · session · edit"]
  end
  FRAME == "/proxy?url=" ==> PROXY
  APP == "fetch" ==> APIS
  SRV --> RENDER["render.js<br/>Playwright Chromium"]
  SRV --> SESS["session.js<br/>login storageState"]
  SRV --> SNAP["snapshot.js<br/>offline crawl + AI edit"]
  SRV --> INBOX["inbox.js"]
  INBOX --> FP[("fixpoints/pending/<br/>fp-NNN.{json,md}")]
  EXT["Browser Extension (MV3)<br/>content + background"] == "real tab → POST" ==> APIS
  FP -.-> AGENT["Agent (Claude Code)<br/>reads pending → edits source → applied/"]`,

  'pin-flow': `sequenceDiagram
  actor U as User
  participant H as Host App
  participant I as Inspector
  participant S as Server (/api/fixpoints)
  participant F as fixpoints/pending
  U->>H: toggle UI-prompt mode
  H->>I: set-mode { on:true }
  I-->>U: hover highlight (cssPath)
  U->>I: click element
  I-->>U: popover (selector / xpath)
  U->>I: write prompt + Save
  I->>H: prompt-added { element, clues }
  H->>S: POST /api/fixpoints
  S->>F: write fp-NNN.json + fp-NNN.md
  Note over F: Agent picks up →<br/>finds source by search terms →<br/>edits → moves to applied/`,

  'collection-modes': `flowchart LR
  T{"Target site"}
  T -- "built / static / local dev" --> P["Proxy mode<br/>fetch→rewrite→inject"]
  T -- "SPA · bot-block · login<br/>(server-side)" --> R["Render mode<br/>Playwright + 🔐 session"]
  T -- "Next/Vite dev · logged-in tab<br/>hydration-hard" --> E["Browser Extension<br/>real tab"]
  P --> FP[("fixpoints")]
  R --> FP
  E --> FP
  FP --> AG["Agent edits real source"]`,

  'proxy-flow': `flowchart TB
  A["/proxy?url=…"] --> B{"local snapshot?<br/>(GET)"}
  B -- yes --> L["serve snapshot<br/>x-vp-source: local"]
  B -- no --> C{"render=1? (GET)"}
  C -- yes --> RR["Playwright render<br/>x-vp-source: render"]
  C -- no --> D["fetch upstream<br/>timeout 15s · redirect: manual<br/>forward method+body+headers"]
  D -- "throw" --> FB{"error type"}
  FB -- "ENOTFOUND / cert + apex" --> W["retry www."]
  FB -- "cert + https" --> HT["retry http://"]
  FB -- "abort / timeout" --> T504["504"]
  D -- "3xx" --> RL["rewrite Location<br/>+ rewrite Set-Cookie"]
  D -- "2xx/4xx/5xx" --> M{"Sec-Fetch-Dest"}
  M -- script --> JS["rewrite JS modules<br/>(+ prelude, keep bare specifiers)"]
  M -- style --> CSS["rewrite CSS"]
  M -- "document / iframe" --> HTML["rewrite HTML<br/>+ inject shim/inspector"]
  M -- "other (empty/img/media)" --> BUF["passthrough<br/>+ Range / cache headers"]
  W --> M
  HT --> M`,
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
</head><body><div id="box"></div></body></html>`, { waitUntil: 'networkidle' })

await page.waitForFunction(() => !!window.mermaid, { timeout: 20000 })
await page.evaluate(() => window.mermaid.initialize({
  startOnLoad: false, theme: 'base', securityLevel: 'loose',
  themeVariables: {
    fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: '14px',
    primaryColor: '#eef2ff', primaryBorderColor: '#6366f1', primaryTextColor: '#1e1b4b',
    lineColor: '#475569', secondaryColor: '#f1f5f9', tertiaryColor: '#ffffff',
  },
}))

for (const [name, code] of Object.entries(diagrams)) {
  try {
    const svg = await page.evaluate(async (c) => {
      const { svg } = await window.mermaid.render('d_' + Math.floor(performance.now()), c)
      return svg
    }, code)
    // 배경 흰색 보장 + 파일 저장
    const withBg = svg.replace('<svg ', '<svg style="background:#ffffff" ')
    fs.writeFileSync(path.join(OUT, name + '.svg'), withBg, 'utf8')
    console.log('✓', name + '.svg', `(${withBg.length} bytes)`)
  } catch (e) {
    console.log('✗', name, '—', String(e.message).slice(0, 160))
  }
}
await browser.close()
console.log('→ docs/images/ 저장 완료')
