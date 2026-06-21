// background.js — service worker. POSTs the content script's fixpoint to the VP server.
// (In MV3, cross-origin fetch is handled by the service worker that holds host_permissions)

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
