// live-pin-test.mjs — 로컬 개발서버(:3000)를 VP(:3001)로 불러와 실제 브라우저로
// 핀을 꽂고 fixpoint 가 서버에 적재되는지 E2E 검증.
import { chromium } from 'playwright'

const VP = process.env.VP || 'http://localhost:3001'
const log = (...a) => console.log('•', ...a)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

try {
  log('VP 앱 열기:', VP)
  await page.goto(VP, { waitUntil: 'networkidle' })

  // 설정된 타깃(local-dev → http://localhost:3000) 선택 → local 모드 로드
  await page.waitForSelector('.target-select')
  await page.selectOption('.target-select', 'local-dev')
  log('타깃 local-dev 선택 → iframe 로드 대기')

  await page.waitForSelector('iframe.page-frame')
  const frame = page.frameLocator('iframe.page-frame')
  await frame.locator('#buy').waitFor({ timeout: 15000 })
  log('데모 앱 로드됨 (구매 버튼 보임)')

  // 인스펙터 활성화 여유
  await page.waitForTimeout(800)

  // UI 프롬프트 스위치 ON
  await page.locator('label.switch', { hasText: 'UI 프롬프트' }).click()
  log('UI 프롬프트 모드 ON')
  await page.waitForTimeout(400)

  // 구매 버튼 클릭 → 팝오버
  await frame.locator('#buy').click()
  await frame.locator('#__vp_pop textarea').waitFor({ timeout: 5000 })
  log('팝오버 떴음 → 프롬프트 입력')

  const PROMPT = '구매 버튼을 더 크게, 초록색(#16a34a)으로 바꾸고 "지금 구매" 로 문구 변경'
  await frame.locator('#__vp_pop textarea').fill(PROMPT)
  await frame.locator('#__vp_pop .__vp_save').click()
  log('저장 클릭 → 서버 적재 대기')

  // 서버에 적재될 시간
  await page.waitForTimeout(1200)

  const res = await page.evaluate(async () => (await fetch('/api/fixpoints')).json())
  const pending = res.pending || []
  const hit = pending.find((p) => p.prompt && p.prompt.includes('지금 구매'))

  console.log('\n=== 결과 ===')
  console.log('pending 개수:', pending.length)
  if (!hit) throw new Error('fixpoint 가 적재되지 않았습니다')
  console.log('적재된 fixpoint:', hit.id)
  console.log('  page    :', hit.page)
  console.log('  target  :', JSON.stringify(hit.target))
  console.log('  selector:', hit.element?.selector)
  console.log('  testids :', hit.clues?.testids)
  console.log('  comps   :', hit.clues?.components)
  console.log('  hints   :', hit.sourceHints?.frontend)
  console.log('  files   :', hit.fileHints)
  console.log('\n✅ 라이브 핀 → fixpoint 적재 E2E 통과')
  if (errors.length) console.log('(브라우저 콘솔 에러', errors.length, '건 — 데모 무관 가능)')
} finally {
  await browser.close()
}
