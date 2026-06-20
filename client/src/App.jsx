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

  // ── 설정 로드
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

  // 현재 타깃(local/proxy) 메타 — fixpoint 에 첨부
  const targetRef = useRef(null)

  // ── 인스펙터에 메시지 전송
  const post = useCallback((type, payload) => {
    const win = iframeRef.current && iframeRef.current.contentWindow
    if (!win) return
    win.postMessage(Object.assign({ source: 'vp-host', type }, payload || {}), '*')
  }, [])

  // ── fixpoint inbox 로드
  async function refreshFixpoints() {
    try {
      const r = await fetch('/api/fixpoints')
      setFixpoints(await r.json())
    } catch {
      /* ignore */
    }
  }

  // ── 인스펙터 메시지 수신
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
          // ★ 서버 inbox 에 fixpoint 파일 드롭 (요구1: 서버 내 문서 적재 → 에이전트 픽업)
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
      /* 서버 미동작 시 무시 — 다운로드 경로는 여전히 가능 */
    }
  }

  // ── URL 로드
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

  // ── 스냅샷
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
    setBanner({ kind: '', text: renderRef.current ? '렌더 스냅샷 저장 중…' : '스냅샷 저장 중…' })
    try {
      const r = await fetch('/api/snapshot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: urlRef.current, render: renderRef.current }),
      })
      const j = await r.json()
      if (r.ok) {
        setSnapshot(j)
        setBanner({ kind: 'ok', text: `스냅샷 저장 완료 (자원 ${j.resourceCount ?? 0}개)` })
        reload()
      } else {
        setBanner({ kind: 'err', text: '저장 실패: ' + (j.error || r.status) })
      }
    } catch (e) {
      setBanner({ kind: 'err', text: '저장 실패: ' + e.message })
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
      setBanner({ kind: 'ok', text: '스냅샷 삭제됨' })
    } finally {
      setBusy(false)
    }
  }

  // ── 로그인 세션 (요구: 로그인 후 화면 수집)
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
    setBanner({ kind: '', text: '브라우저 창을 여는 중… 창에서 로그인한 뒤 "세션 저장"을 누르세요.' })
    try {
      const r = await fetch('/api/session/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: urlRef.current }),
      })
      const j = await r.json()
      if (r.ok && j.token) {
        setLoginToken(j.token)
        setBanner({ kind: 'ok', text: '브라우저 창에서 로그인 후 "세션 저장"을 누르세요.' })
      } else {
        setBanner({ kind: 'err', text: '로그인 창 실패: ' + (j.error || r.status) })
      }
    } catch (e) {
      setBanner({ kind: 'err', text: '로그인 창 실패: ' + e.message })
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
        setBanner({ kind: 'ok', text: `세션 저장됨 (${j.host}) — 이제 렌더 모드로 로그인 화면을 수집할 수 있습니다.` })
        refreshSession(urlRef.current)
        if (renderRef.current) reload()
      } else {
        setBanner({ kind: 'err', text: '세션 저장 실패: ' + (j.error || r.status) })
      }
    } catch (e) {
      setBanner({ kind: 'err', text: '세션 저장 실패: ' + e.message })
    }
  }
  async function sessionClear() {
    if (!urlRef.current) return
    await fetch('/api/session?url=' + encodeURIComponent(urlRef.current), { method: 'DELETE' })
    refreshSession(urlRef.current)
    setBanner({ kind: 'ok', text: '세션 삭제됨' })
  }

  // ── 핀 조작
  const focus = (id) => post('focus', { id })
  const edit = (id) => post('edit', { id })
  const del = (id) => post('delete', { id })

  // ── 추출 (요구2: 스크린샷 + MD + JSON 다운로드)
  function exportMd() {
    download('ui-prompts.md', buildMarkdown(entries, url, views), 'text/markdown')
  }
  function exportJson() {
    download('ui-prompts.json', JSON.stringify(buildJson(entries, url, views), null, 2), 'application/json')
  }
  async function exportScreenshot() {
    if (!url) return
    setBanner({ kind: '', text: '스크린샷 생성 중…' })
    try {
      await downloadScreenshot(url)
      setBanner({ kind: 'ok', text: '스크린샷 다운로드됨' })
    } catch (e) {
      setBanner({ kind: 'err', text: '스크린샷 실패: ' + e.message })
    }
  }
  function exportAll() {
    exportMd()
    exportJson()
    exportScreenshot()
  }

  // ── AI 적용 (요구3: 크롤된 소스 수정 → 미리보기)
  async function aiApply(entry) {
    if (!snapshotRef.current || !snapshotRef.current.exists) {
      setBanner({ kind: 'err', text: '먼저 로컬 스냅샷을 저장하세요 (AI 적용은 스냅샷 대상).' })
      return
    }
    setBanner({ kind: '', text: 'AI 수정 중…' })
    try {
      const r = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: entry.page || url, selector: entry.element?.selector, prompt: entry.prompt }),
      })
      const j = await r.json()
      if (r.ok) {
        setBanner({ kind: 'ok', text: 'AI 수정 적용됨 — 페이지 리로드' })
        reload()
      } else {
        setBanner({ kind: 'err', text: 'AI 수정 실패: ' + (j.error || r.status) })
      }
    } catch (e) {
      setBanner({ kind: 'err', text: 'AI 수정 실패: ' + e.message })
    }
  }
  async function aiApplyAll() {
    for (const e of entries.filter((x) => (x.page || url) === url)) {
      // eslint-disable-next-line no-await-in-loop
      await aiApply(e)
    }
  }

  // ── fixpoint inbox 조작
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
              <p>URL 을 입력해 페이지를 불러온 뒤, <b>UI 프롬프트</b> 스위치를 켜고 요소에 수정 프롬프트를 핀으로 꽂으세요.</p>
              <p className="muted">하드 사이트(SPA·로그인·봇차단)는 <b>🎭 렌더</b> 토글을 켜고 불러오세요.</p>
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
