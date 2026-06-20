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
          placeholder="https://example.com 또는 도메인 입력"
          spellCheck={false}
        />
        <button type="submit" className="btn">불러오기</button>
        <button type="button" className="btn ghost" title="다시 불러오기" onClick={onReload}>↻</button>
      </form>

      {targets && targets.length > 0 && (
        <select className="target-select" defaultValue="" onChange={pickTarget} title="설정된 타깃">
          <option value="" disabled>타깃…</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>{t.label || t.id} ({t.mode})</option>
          ))}
        </select>
      )}

      <label
        className={'switch sm' + (renderMode ? ' on' : '') + (rendererAvailable ? '' : ' disabled')}
        title={rendererAvailable ? '헤드리스 브라우저로 렌더(SPA/로그인/봇차단 대응)' : 'Playwright 미설치'}
      >
        <input
          type="checkbox"
          checked={renderMode}
          disabled={!rendererAvailable}
          onChange={(e) => onToggleRender(e.target.checked)}
        />
        <span className="knob" />
        <span className="switch-label">🎭 렌더</span>
      </label>

      <div className="tb-spacer" />

      <div className="snap-controls">
        {loginToken ? (
          <button className="btn" onClick={onLoginSave} title="로그인 완료 후 누르세요">✅ 세션 저장</button>
        ) : session && session.exists ? (
          <>
            <span className="snap-badge" title={'세션 저장됨: ' + (session.savedAt || '')}>🔓 {session.host}</span>
            <button className="btn ghost" disabled={!url} onClick={onSessionClear}>세션삭제</button>
          </>
        ) : (
          <button className="btn ghost" disabled={!url} onClick={onLoginStart} title="브라우저 창에서 직접 로그인 → 세션 저장">🔐 로그인</button>
        )}
      </div>

      <div className="snap-controls">
        {snapshot && snapshot.exists ? (
          <>
            <span className="snap-badge" title={snapshot.htmlPath || ''}>💾 스냅샷 ({snapshot.resourceCount ?? 0})</span>
            <button className="btn ghost" disabled={busy} onClick={onSnapshotDelete}>삭제</button>
          </>
        ) : (
          <button className="btn ghost" disabled={busy || !url} onClick={onSnapshotSave}>
            {busy ? '저장 중…' : '로컬 저장'}
          </button>
        )}
      </div>

      <button
        className={'btn ghost' + (pinsVisible ? '' : ' active')}
        disabled={!url}
        onClick={() => onTogglePins(!pinsVisible)}
        title={pinsVisible ? '핀 숨기기 (주변부 가릴 때)' : '핀 보이기'}
      >
        {pinsVisible ? '📌 핀 숨기기' : '📌 핀 보이기'}
      </button>

      <button className="btn ghost" disabled={!url} onClick={onScreenshot} title="현재 페이지 풀페이지 스크린샷 다운로드">📸 스크린샷</button>

      <label className={'switch' + (promptMode ? ' on' : '')} title="UI 프롬프트 모드">
        <input type="checkbox" checked={promptMode} onChange={(e) => onToggleMode(e.target.checked)} />
        <span className="knob" />
        <span className="switch-label">UI 프롬프트</span>
      </label>
    </header>
  )
}
