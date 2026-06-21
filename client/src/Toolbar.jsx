import React, { useState } from 'react'

export default function Toolbar({
  url,
  targets,
  onLoad,
  onReload,
  promptMode,
  onToggleMode,
  pinsVisible,
  onTogglePins,
  renderMode,
  rendererAvailable,
  onToggleRender,
  snapshot,
  onSnapshotSave,
  onSnapshotDelete,
  onScreenshot,
  session,
  loginToken,
  onLoginStart,
  onLoginSave,
  onSessionClear,
  busy,
}) {
  const [input, setInput] = useState(url || '')

  function submit(e) {
    e.preventDefault()
    let u = input.trim()
    if (!u) return
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u
    onLoad(u, { mode: 'proxy', url: u })
  }

  function pickTarget(e) {
    const id = e.target.value
    const t = (targets || []).find((x) => x.id === id)
    if (t && t.url) {
      setInput(t.url)
      onLoad(t.url, t)
    }
  }

  return (
    <header className="toolbar">
      <form className="url-form" onSubmit={submit}>
        <input
          className="url-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://example.com or enter a domain"
          spellCheck={false}
        />
        <button type="submit" className="btn">Load</button>
        <button type="button" className="btn ghost" title="Reload" onClick={onReload}>↻</button>
      </form>

      {targets && targets.length > 0 && (
        <select className="target-select" defaultValue="" onChange={pickTarget} title="Configured targets">
          <option value="" disabled>Target…</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>{t.label || t.id} ({t.mode})</option>
          ))}
        </select>
      )}

      <label
        className={'switch sm' + (renderMode ? ' on' : '') + (rendererAvailable ? '' : ' disabled')}
        title={rendererAvailable ? 'Render with a headless browser (handles SPA / login / bot blocking)' : 'Playwright not installed'}
      >
        <input
          type="checkbox"
          checked={renderMode}
          disabled={!rendererAvailable}
          onChange={(e) => onToggleRender(e.target.checked)}
        />
        <span className="knob" />
        <span className="switch-label">🎭 Render</span>
      </label>

      <div className="tb-spacer" />

      <div className="snap-controls">
        {loginToken ? (
          <button className="btn" onClick={onLoginSave} title="Click after logging in">✅ Save session</button>
        ) : session && session.exists ? (
          <>
            <span className="snap-badge" title={'Session saved: ' + (session.savedAt || '')}>🔓 {session.host}</span>
            <button className="btn ghost" disabled={!url} onClick={onSessionClear}>Clear session</button>
          </>
        ) : (
          <button className="btn ghost" disabled={!url} onClick={onLoginStart} title="Log in directly in the browser window → save session">🔐 Login</button>
        )}
      </div>

      <div className="snap-controls">
        {snapshot && snapshot.exists ? (
          <>
            <span className="snap-badge" title={snapshot.htmlPath || ''}>💾 Snapshot ({snapshot.resourceCount ?? 0})</span>
            <button className="btn ghost" disabled={busy} onClick={onSnapshotDelete}>Delete</button>
          </>
        ) : (
          <button className="btn ghost" disabled={busy || !url} onClick={onSnapshotSave}>
            {busy ? 'Saving…' : 'Save local'}
          </button>
        )}
      </div>

      <button
        className={'btn ghost' + (pinsVisible ? '' : ' active')}
        disabled={!url}
        onClick={() => onTogglePins(!pinsVisible)}
        title={pinsVisible ? 'Hide pins (when they obscure surroundings)' : 'Show pins'}
      >
        {pinsVisible ? '📌 Hide pins' : '📌 Show pins'}
      </button>

      <button className="btn ghost" disabled={!url} onClick={onScreenshot} title="Download a full-page screenshot of the current page">📸 Screenshot</button>

      <label className={'switch' + (promptMode ? ' on' : '')} title="UI prompt mode">
        <input type="checkbox" checked={promptMode} onChange={(e) => onToggleMode(e.target.checked)} />
        <span className="knob" />
        <span className="switch-label">UI Prompt</span>
      </label>
    </header>
  )
}
