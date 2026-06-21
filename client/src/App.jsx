import React, { useCallback, useEffect, useRef, useState } from 'react'
import Toolbar from './Toolbar.jsx'
import SidePanel from './SidePanel.jsx'
import { buildMarkdown, buildJson, download, downloadScreenshot } from './lib/exporters.js'

function proxyUrl(u, render) {
  return '/proxy?url=' + encodeURIComponent(u) + (render ? '&render=1' : '')
}

function sameView(a, b) {
  if (!a || !b) return false
  return (
    a.page === b.page &&
    (a.title || '') === (b.title || '') &&
    (a.heading || '') === (b.heading || '') &&
    (a.url || '') === (b.url || '') &&
    JSON.stringify(a.trigger || null) === JSON.stringify(b.trigger || null)
  )
}

export default function App() {
  const [url, setUrl] = useState('')
  const [promptMode, setPromptMode] = useState(false)
  const [pinsVisible, setPinsVisible] = useState(true)
  const [renderMode, setRenderMode] = useState(false)
  const [entries, setEntries] = useState([])
  const [views, setViews] = useState([])
  const [snapshot, setSnapshot] = useState(null)
  const [session, setSession] = useState(null)
  const [loginToken, setLoginToken] = useState(null)
  const [fixpoints, setFixpoints] = useState({ pending: [], applied: [] })
  const [config, setConfig] = useState({ targets: [], renderer: false })
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState(null)

  const iframeRef = useRef(null)
  const currentViewRef = useRef(null)
  const entriesRef = useRef(entries)
  const urlRef = useRef(url)
  const renderRef = useRef(renderMode)
  const promptModeRef = useRef(promptMode)
  const pinsVisibleRef = useRef(pinsVisible)
  const snapshotRef = useRef(snapshot)
  entriesRef.current = entries
  urlRef.current = url
  renderRef.current = renderMode
  promptModeRef.current = promptMode
  pinsVisibleRef.current = pinsVisible
  snapshotRef.current = snapshot

  // ── Load config
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => {
        setConfig(c)
        if (c.defaultTarget) {
          const t = (c.targets || []).find((x) => x.id === c.defaultTarget)
          if (t && t.url) loadUrl(t.url, t)
        }
      })
      .catch(() => {})
    refreshFixpoints()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Current target (local/proxy) meta — attached to fixpoint
  const targetRef = useRef(null)

  // ── Send message to inspector
  const post = useCallback((type, payload) => {
    const win = iframeRef.current && iframeRef.current.contentWindow
    if (!win) return
    win.postMessage(Object.assign({ source: 'vp-host', type }, payload || {}), '*')
  }, [])

  // ── Load fixpoint inbox
  async function refreshFixpoints() {
    try {
      const r = await fetch('/api/fixpoints')
      setFixpoints(await r.json())
    } catch {
      /* ignore */
    }
  }

  // ── Receive inspector messages
  useEffect(() => {
    function onMsg(e) {
      const d = e.data
      if (!d || d.source !== 'vp') return
      switch (d.type) {
        case 'ready': {
          currentViewRef.current = null
          const items = entriesRef.current
            .filter((x) => x.page === urlRef.current)
            .map((x) => ({ id: x.id, element: x.element, prompt: x.prompt }))
          if (items.length) post('restore', { items })
          post('set-mode', { on: promptModeRef.current })
          post('set-pins', { on: pinsVisibleRef.current })
          break
        }
        case 'view-change': {
          const v = { ...d.view, page: urlRef.current }
          currentViewRef.current = v
          setViews((prev) => {
            const last = prev[prev.length - 1]
            if (sameView(last, v)) {
              const copy = prev.slice()
              copy[copy.length - 1] = v
              return copy
            }
            return [...prev, v]
          })
          break
        }
        case 'prompt-added': {
          const view = currentViewRef.current
          const entry = {
            id: d.id,
            prompt: d.prompt,
            element: d.element,
            clues: d.clues,
            page: urlRef.current,
            view: view ? { title: view.title, heading: view.heading, url: view.url } : null,
            snapshot: snapshotRef.current && snapshotRef.current.exists ? snapshotRef.current : null,
          }
          setEntries((prev) => [...prev, entry])
          // ★ Drop fixpoint file into server inbox (req1: stage doc on server → agent pickup)
          dropFixpoint(entry)
          break
        }
        case 'prompt-updated':
          setEntries((prev) => prev.map((x) => (x.id === d.id ? { ...x, prompt: d.prompt } : x)))
          break
        case 'prompt-deleted':
          setEntries((prev) => prev.filter((x) => x.id !== d.id))
          break
        case 'selected':
          break
        case 'navigate':
          if (d.url) loadUrl(d.url, targetRef.current)
          break
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post])

  async function dropFixpoint(entry) {
    try {
      const r = await fetch('/api/fixpoints', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: entry.prompt,
          page: entry.page,
          element: entry.element,
          clues: entry.clues,
          view: entry.view,
          target: targetRef.current
            ? { mode: targetRef.current.mode || 'proxy', url: targetRef.current.url, repoRoot: targetRef.current.repoRoot }
            : { mode: 'proxy' },
          snapshot: entry.snapshot,
        }),
      })
      const j = await r.json()
      if (j.ok) {
        setEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, fixpointId: j.id } : x)))
        refreshFixpoints()
      }
    } catch {
      /* Ignore if server is down — download path still works */
    }
  }

  // ── Load URL
  const loadUrl = useCallback((u, target) => {
    setUrl(u)
    urlRef.current = u
    targetRef.current = target || { mode: 'proxy', url: u }
    refreshSnapshot(u)
    refreshSession(u)
    const f = iframeRef.current
    if (f) f.src = proxyUrl(u, renderRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function reload() {
    const f = iframeRef.current
    if (f && urlRef.current) f.src = proxyUrl(urlRef.current, renderRef.current) + '&_=' + Date.now()
  }

  function toggleRender(on) {
    setRenderMode(on)
    renderRef.current = on
    if (urlRef.current) reload()
  }

  function toggleMode(on) {
    setPromptMode(on)
    post('set-mode', { on })
  }

  function togglePins(on) {
    setPinsVisible(on)
    pinsVisibleRef.current = on
    post('set-pins', { on })
  }

  // ── Snapshot
  async function refreshSnapshot(u) {
    try {
      const r = await fetch('/api/snapshot?url=' + encodeURIComponent(u))
      setSnapshot(await r.json())
    } catch {
      setSnapshot(null)
    }
  }
  async function snapshotSave() {
    if (!urlRef.current) return
    setBusy(true)
    setBanner({ kind: '', text: renderRef.current ? 'Saving render snapshot…' : 'Saving snapshot…' })
    try {
      const r = await fetch('/api/snapshot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: urlRef.current, render: renderRef.current }),
      })
      const j = await r.json()
      if (r.ok) {
        setSnapshot(j)
        setBanner({ kind: 'ok', text: `Snapshot saved (${j.resourceCount ?? 0} resources)` })
        reload()
      } else {
        setBanner({ kind: 'err', text: 'Save failed: ' + (j.error || r.status) })
      }
    } catch (e) {
      setBanner({ kind: 'err', text: 'Save failed: ' + e.message })
    } finally {
      setBusy(false)
    }
  }
  async function snapshotDelete() {
    if (!urlRef.current) return
    setBusy(true)
    try {
      await fetch('/api/snapshot?url=' + encodeURIComponent(urlRef.current), { method: 'DELETE' })
      await refreshSnapshot(urlRef.current)
      setBanner({ kind: 'ok', text: 'Snapshot deleted' })
    } finally {
      setBusy(false)
    }
  }

  // ── Login session (req: collect screens after login)
  async function refreshSession(u) {
    try {
      const r = await fetch('/api/session?url=' + encodeURIComponent(u))
      setSession(await r.json())
    } catch {
      setSession(null)
    }
  }
  async function loginStart() {
    if (!urlRef.current) return
    setBanner({ kind: '', text: 'Opening browser window… log in there, then click "Save session".' })
    try {
      const r = await fetch('/api/session/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: urlRef.current }),
      })
      const j = await r.json()
      if (r.ok && j.token) {
        setLoginToken(j.token)
        setBanner({ kind: 'ok', text: 'Log in via the browser window, then click "Save session".' })
      } else {
        setBanner({ kind: 'err', text: 'Login window failed: ' + (j.error || r.status) })
      }
    } catch (e) {
      setBanner({ kind: 'err', text: 'Login window failed: ' + e.message })
    }
  }
  async function loginSave() {
    if (!loginToken) return
    try {
      const r = await fetch('/api/session/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: loginToken }),
      })
      const j = await r.json()
      setLoginToken(null)
      if (r.ok) {
        setBanner({ kind: 'ok', text: `Session saved (${j.host}) — you can now collect logged-in screens in render mode.` })
        refreshSession(urlRef.current)
        if (renderRef.current) reload()
      } else {
        setBanner({ kind: 'err', text: 'Session save failed: ' + (j.error || r.status) })
      }
    } catch (e) {
      setBanner({ kind: 'err', text: 'Session save failed: ' + e.message })
    }
  }
  async function sessionClear() {
    if (!urlRef.current) return
    await fetch('/api/session?url=' + encodeURIComponent(urlRef.current), { method: 'DELETE' })
    refreshSession(urlRef.current)
    setBanner({ kind: 'ok', text: 'Session deleted' })
  }

  // ── Pin actions
  const focus = (id) => post('focus', { id })
  const edit = (id) => post('edit', { id })
  const del = (id) => post('delete', { id })

  // ── Export (req2: screenshot + MD + JSON download)
  function exportMd() {
    download('ui-prompts.md', buildMarkdown(entries, url, views), 'text/markdown')
  }
  function exportJson() {
    download('ui-prompts.json', JSON.stringify(buildJson(entries, url, views), null, 2), 'application/json')
  }
  async function exportScreenshot() {
    if (!url) return
    setBanner({ kind: '', text: 'Generating screenshot…' })
    try {
      await downloadScreenshot(url)
      setBanner({ kind: 'ok', text: 'Screenshot downloaded' })
    } catch (e) {
      setBanner({ kind: 'err', text: 'Screenshot failed: ' + e.message })
    }
  }
  function exportAll() {
    exportMd()
    exportJson()
    exportScreenshot()
  }

  // ── AI apply (req3: edit crawled source → preview)
  async function aiApply(entry) {
    if (!snapshotRef.current || !snapshotRef.current.exists) {
      setBanner({ kind: 'err', text: 'Save a local snapshot first (AI apply targets the snapshot).' })
      return
    }
    setBanner({ kind: '', text: 'AI editing…' })
    try {
      const r = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: entry.page || url, selector: entry.element?.selector, prompt: entry.prompt }),
      })
      const j = await r.json()
      if (r.ok) {
        setBanner({ kind: 'ok', text: 'AI edit applied — reloading page' })
        reload()
      } else {
        setBanner({ kind: 'err', text: 'AI edit failed: ' + (j.error || r.status) })
      }
    } catch (e) {
      setBanner({ kind: 'err', text: 'AI edit failed: ' + e.message })
    }
  }
  async function aiApplyAll() {
    for (const e of entries.filter((x) => (x.page || url) === url)) {
      // eslint-disable-next-line no-await-in-loop
      await aiApply(e)
    }
  }

  // ── fixpoint inbox actions
  async function applyFixpoint(id) {
    await fetch(`/api/fixpoints/${id}/apply`, { method: 'POST' })
    refreshFixpoints()
  }
  async function deleteFixpoint(id) {
    await fetch(`/api/fixpoints/${id}`, { method: 'DELETE' })
    refreshFixpoints()
  }

  return (
    <div className="app">
      <Toolbar
        url={url}
        targets={config.targets}
        onLoad={loadUrl}
        onReload={reload}
        promptMode={promptMode}
        onToggleMode={toggleMode}
        pinsVisible={pinsVisible}
        onTogglePins={togglePins}
        renderMode={renderMode}
        rendererAvailable={config.renderer}
        onToggleRender={toggleRender}
        snapshot={snapshot}
        onSnapshotSave={snapshotSave}
        onSnapshotDelete={snapshotDelete}
        onScreenshot={exportScreenshot}
        session={session}
        loginToken={loginToken}
        onLoginStart={loginStart}
        onLoginSave={loginSave}
        onSessionClear={sessionClear}
        busy={busy}
      />
      <div className="body">
        <main className="stage">
          {url ? (
            <iframe ref={iframeRef} className="page-frame" title="page" src={proxyUrl(url, renderMode)} />
          ) : (
            <div className="placeholder">
              <h1>VisualPrompt</h1>
              <p>Enter a URL to load a page, then turn on the <b>UI Prompt</b> switch and pin edit prompts onto elements.</p>
              <p className="muted">For hard sites (SPA / login / bot blocking), turn on the <b>🎭 Render</b> toggle before loading.</p>
            </div>
          )}
        </main>
        <SidePanel
          entries={entries}
          views={views}
          fixpoints={fixpoints}
          onFocus={focus}
          onEdit={edit}
          onDelete={del}
          onExportMd={exportMd}
          onExportJson={exportJson}
          onExportAll={exportAll}
          onAiApply={aiApply}
          onAiApplyAll={aiApplyAll}
          onApplyFixpoint={applyFixpoint}
          onDeleteFixpoint={deleteFixpoint}
          banner={banner}
        />
      </div>
    </div>
  )
}
