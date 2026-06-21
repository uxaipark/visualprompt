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
          Turn on the <b>UI Prompt</b> switch above and click an element on the page<br />
          to pin an edit prompt onto it.
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
            🧭 Navigation history ({views.length}) {showViews ? '▾' : '▸'}
          </button>
          {showViews && (
            <ol className="views-list">
              {views.map((v, i) => (
                <li key={i}>
                  <div className="v-title">{v.title || '(no title)'}</div>
                  {v.trigger && (
                    <div className="v-trigger">Click: “{v.trigger.text || v.trigger.label || v.trigger.selector}”</div>
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
        <h2>Prompts ({entries.length})</h2>
        <div className="side-actions">
          <button className="btn sm" onClick={onExportMd}>MD</button>
          <button className="btn sm" onClick={onExportJson}>JSON</button>
          <button className="btn sm" onClick={onExportAll} title="MD + JSON + Screenshot">All↓</button>
          <button className="btn sm" onClick={onAiApplyAll}>AI All</button>
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
              {e.fixpointId && <span className="fp-tag" title="Staged in server inbox">📥 {e.fixpointId}</span>}
            </div>
            <div className="pin-prompt">{e.prompt}</div>
            {e.view && <div className="pin-view">🧭 {e.view.title || e.view.heading}</div>}
            <div className="pin-btns">
              <button className="btn sm ghost" onClick={() => onFocus(e.id)}>View</button>
              <button className="btn sm ghost" onClick={() => onEdit(e.id)}>Edit</button>
              <button className="btn sm ghost" onClick={() => onAiApply(e)}>AI apply</button>
              <button className="btn sm danger" onClick={() => onDelete(e.id)}>Delete</button>
            </div>
          </li>
        ))}
      </ul>

      {(pending.length > 0 || applied.length > 0) && (
        <section className="inbox">
          <button className="views-head" onClick={() => setShowInbox((s) => !s)}>
            📥 Server inbox · awaiting agent ({pending.length}) {showInbox ? '▾' : '▸'}
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
                      <button className="btn sm ghost" onClick={() => onApplyFixpoint(fp.id)} title="Move to applied (mark as done)">Mark done</button>
                      <button className="btn sm danger" onClick={() => onDeleteFixpoint(fp.id)}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
              {applied.length > 0 && <div className="fp-applied">✅ Done: {applied.length}</div>}
            </>
          )}
        </section>
      )}
    </aside>
  )
}
