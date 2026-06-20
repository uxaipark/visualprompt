// popup.js — 서버 주소 저장 + 현재 탭 수집 모드 토글.
const $server = document.getElementById('server')
const $enabled = document.getElementById('enabled')
const $status = document.getElementById('status')

async function init() {
  const { server } = await chrome.storage.local.get('server')
  $server.value = server || 'http://localhost:3001'
  // 현재 탭의 수집 모드 상태 조회
  const tab = await activeTab()
  if (tab) {
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'vp-get-mode' })
      $enabled.checked = !!(r && r.on)
    } catch {
      /* content script 미주입(특수 페이지) */
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
      $status.textContent = '적용됨 ✓'
    } catch {
      $status.textContent = '이 페이지에선 수집할 수 없어요(브라우저 내부 페이지).'
    }
  }
})

init()
