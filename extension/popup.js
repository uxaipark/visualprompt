// popup.js — saves the server URL + toggles collect mode on the current tab.
const $server = document.getElementById('server')
const $enabled = document.getElementById('enabled')
const $status = document.getElementById('status')

async function init() {
  const { server } = await chrome.storage.local.get('server')
  $server.value = server || 'http://localhost:3001'
  // Query the current tab's collect mode state
  const tab = await activeTab()
  if (tab) {
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'vp-get-mode' })
      $enabled.checked = !!(r && r.on)
    } catch {
      /* content script not injected (special page) */
    }
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ server: $server.value.trim() || 'http://localhost:3001' })
  const tab = await activeTab()
  if (tab) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'vp-set-mode', on: $enabled.checked })
      $status.textContent = 'Applied ✓'
    } catch {
      $status.textContent = "Can't collect on this page (internal browser page)."
    }
  }
})

init()
