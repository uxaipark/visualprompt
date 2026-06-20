import React, { useState } from 'react'

export default function SidePanel({
  entries,
  views,
  fixpoints,
  onFocus,
  onEdit,
  onDelete,
  onExportMd,
  onExportJson,
  onExportAll,
  onAiApply,
  onAiApplyAll,
  onApplyFixpoint,
  onDeleteFixpoint,
  banner,
}) {
  const [showViews, setShowViews] = useState(true)
  const [showInbox, setShowInbox] = useState(true)

  const pending = (fixpoints && fixpoints.pending) || []
  const applied = (fixpoints && fixpoints.applied) || []
  const hasContent =
    entries.length > 0 || (views && views.length > 0) || pending.length > 0 || applied.length > 0

  if (!hasContent) {
    return (
      <aside className="side empty">
        <p className="hint">
          상단 <b>UI 프롬프트</b> 스위치를 켜고 페이지의 요소를 클릭해<br />
          수정 프롬프트를 핀으로 꽂으세요.
        </p>
      </aside>
    )
  }

  return (
    <aside className="side">
      {banner && <div className={'banner ' + (banner.kind || '')}>{banner.text}</div>}

      {views && views.length > 0 && (
        <section className="views">
          <button className="views-head" onClick={() => setShowViews((s) => !s)}>
            🧭 탐색 기록 ({views.length}) {showViews ? '▾' : '▸'}
          </button>
          {showViews && (
            <ol className="views-list">
              {views.map((v, i) => (
                <li key={i}>
                  <div className="v-title">{v.title || '(제목 없음)'}</div>
                  {v.trigger && (
                    <div className="v-trigger">클릭: “{v.trigger.text || v.trigger.label || v.trigger.selector}”</div>
                  )}
                  {v.apiCalls && v.apiCalls.length > 0 && (
                    <div className="v-api">{v.apiCalls[0].method} {v.apiCalls[0].path}</div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <div className="side-head">
        <h2>프롬프트 ({entries.length})</h2>
        <div className="side-actions">
          <button className="btn sm" onClick={onExportMd}>MD</button>
          <button className="btn sm" onClick={onExportJson}>JSON</button>
          <button className="btn sm" onClick={onExportAll} title="MD + JSON + 스크린샷">전체↓</button>
          <button className="btn sm" onClick={onAiApplyAll}>AI 전체</button>
        </div>
      </div>

      <ul className="pin-list">
        {entries.map((e, i) => (
          <li key={e.id} className="pin-item">
            <div className="pin-row">
              <span className="pin-num">{i + 1}</span>
              <code className="pin-sel" title={e.element?.xpath}>
                {e.element?.tag}
                {e.element?.id ? '#' + e.element.id : ''}
              </code>
              {e.fixpointId && <span className="fp-tag" title="서버 inbox 에 적재됨">📥 {e.fixpointId}</span>}
            </div>
            <div className="pin-prompt">{e.prompt}</div>
            {e.view && <div className="pin-view">🧭 {e.view.title || e.view.heading}</div>}
            <div className="pin-btns">
              <button className="btn sm ghost" onClick={() => onFocus(e.id)}>보기</button>
              <button className="btn sm ghost" onClick={() => onEdit(e.id)}>수정</button>
              <button className="btn sm ghost" onClick={() => onAiApply(e)}>AI 적용</button>
              <button className="btn sm danger" onClick={() => onDelete(e.id)}>삭제</button>
            </div>
          </li>
        ))}
      </ul>

      {(pending.length > 0 || applied.length > 0) && (
        <section className="inbox">
          <button className="views-head" onClick={() => setShowInbox((s) => !s)}>
            📥 서버 inbox · 에이전트 대기 ({pending.length}) {showInbox ? '▾' : '▸'}
          </button>
          {showInbox && (
            <>
              <ul className="fp-list">
                {pending.map((fp) => (
                  <li key={fp.id} className="fp-item">
                    <div className="fp-row">
                      <span className="fp-id">{fp.id}</span>
                      <code className="fp-sel">{fp.element?.tag}{fp.element?.id ? '#' + fp.element.id : ''}</code>
                    </div>
                    <div className="fp-prompt">{fp.prompt}</div>
                    <div className="pin-btns">
                      <button className="btn sm ghost" onClick={() => onApplyFixpoint(fp.id)} title="applied 로 이동(처리완료 표시)">완료처리</button>
                      <button className="btn sm danger" onClick={() => onDeleteFixpoint(fp.id)}>삭제</button>
                    </div>
                  </li>
                ))}
              </ul>
              {applied.length > 0 && <div className="fp-applied">✅ 처리 완료: {applied.length}건</div>}
            </>
          )}
        </section>
      )}
    </aside>
  )
}
