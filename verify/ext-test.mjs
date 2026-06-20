// ext-test.mjs — 확장을 로드해 원본 mohazi.com/m/studio 에서 수집 실측.
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXT = path.resolve(__dirname, '..', 'extension')
const TARGET = 'https://mohazi.com/m/studio'

const ctx = await chromium.launchPersistentContext('/tmp/vp-ext-profile', {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
  viewport: { width: 1280, height: 860 },
})

const log = (...a) => console.log('•', ...a)
const errs = []
const page = await ctx.newPage()
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)))

try {
  log('확장 로드 + 원본 페이지 접속:', TARGET)
  await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => errs.push('goto:' + e.message))
  await page.waitForTimeout(3000)

  // 1) content script 주입 확인 (FAB)
  const fab = await page.locator('#__vpx_fab').count()
  log('content script 주입(FAB):', fab ? '✅ 있음' : '❌ 없음')

  // 2) 네이티브 하이드레이션 — 입장 클릭이 동작하나
  const before = (await page.evaluate(() => document.body.innerText.slice(0, 40)))
  await page.mouse.click(640, 430)
  await page.waitForTimeout(3000)
  const after = (await page.evaluate(() => document.body.innerText.slice(0, 40)))
  const entered = before !== after
  log('입장(하이드레이션):', entered ? '✅ 화면 전환됨' : '⚠ 변화 없음', `(${JSON.stringify(before)} → ${JSON.stringify(after)})`)

  // 3) 수집 모드 ON (FAB 클릭)
  await page.locator('#__vpx_fab').click().catch(() => {})
  await page.waitForTimeout(600)
  const modeOn = await page.evaluate(() => document.getElementById('__vpx_fab')?.classList.contains('on'))
  log('수집 모드:', modeOn ? '✅ ON' : '❌ OFF')

  // 4) 요소 클릭 → 팝오버 → 프롬프트 → 저장
  await page.mouse.click(640, 300)
  await page.waitForTimeout(800)
  const popCount = await page.locator('#__vpx_pop textarea').count()
  log('팝오버:', popCount ? '✅ 떴음' : '❌ 안 뜸')
  let posted = false
  if (popCount) {
    await page.locator('#__vpx_pop textarea').fill('이 영역의 카세트/트랙 라벨 폰트를 더 크고 또렷하게 바꿔줘')
    await page.locator('#__vpx_pop .__vpx_save').click()
    await page.waitForTimeout(2000)
    const toast = await page.evaluate(() => document.getElementById('__vpx_toast')?.textContent || '')
    log('전송 토스트:', JSON.stringify(toast))
    posted = /적재|fp-/.test(toast)
  }

  // 5) 서버 inbox 에 실제 적재됐나 (확장 페이지 컨텍스트에서 조회)
  const fps = await page.evaluate(async () => {
    try { return await (await fetch('http://localhost:3001/api/fixpoints')).json() }
    catch (e) { return { err: String(e.message) } }
  })
  const pend = (fps.pending || [])
  log('서버 fixpoints/pending:', pend.length, '건')
  if (pend.length) {
    const last = pend[pend.length - 1]
    console.log('   →', last.id, '| target:', JSON.stringify(last.target), '| selector:', last.element?.selector, '| prompt:', (last.prompt || '').slice(0, 40))
  }

  console.log('\n=== 실측 결과 ===')
  console.log('content script 주입:', fab ? 'OK' : 'FAIL')
  console.log('네이티브 입장      :', entered ? 'OK' : 'PARTIAL')
  console.log('수집모드/팝오버    :', modeOn && popCount ? 'OK' : 'CHECK')
  console.log('서버 적재          :', pend.length ? `OK (${pend.length}건)` : 'FAIL')
  if (errs.length) console.log('pageerror:', errs.slice(0, 3).join(' | '))
} finally {
  await ctx.close()
}
