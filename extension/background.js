// background.js — service worker. content script 의 fixpoint 를 VP 서버로 POST 한다.
// (MV3 에서 cross-origin fetch 는 host_permissions 를 가진 service worker 가 담당)

const DEFAULT_SERVER = 'http://localhost:3001'

async function getServer() {
  const { server } = await chrome.storage.local.get('server')
  return server || DEFAULT_SERVER
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'vp-fixpoint') return
  ;(async () => {
    try {
      const server = await getServer()
      const r = await fetch(server.replace(/\/$/, '') + '/api/fixpoints', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(msg.payload),
      })
      const j = await r.json().catch(() => ({}))
      sendResponse({ ok: r.ok, status: r.status, result: j })
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message) })
    }
  })()
  return true // async sendResponse
})
