// ext-test.mjs — loads the extension and measures collection on the original mohazi.com/m/studio.
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
  log('Load extension + open original page:', TARGET)
  await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => errs.push('goto:' + e.message))
  await page.waitForTimeout(3000)

  // 1) Verify content script injection (FAB)
  const fab = await page.locator('#__vpx_fab').count()
  log('content script injection (FAB):', fab ? '✅ present' : '❌ missing')

  // 2) Native hydration — does the enter click work
  const before = (await page.evaluate(() => document.body.innerText.slice(0, 40)))
  await page.mouse.click(640, 430)
  await page.waitForTimeout(3000)
  const after = (await page.evaluate(() => document.body.innerText.slice(0, 40)))
  const entered = before !== after
  log('enter (hydration):', entered ? '✅ screen changed' : '⚠ no change', `(${JSON.stringify(before)} → ${JSON.stringify(after)})`)

  // 3) Collection mode ON (FAB click)
  await page.locator('#__vpx_fab').click().catch(() => {})
  await page.waitForTimeout(600)
  const modeOn = await page.evaluate(() => document.getElementById('__vpx_fab')?.classList.contains('on'))
  log('collection mode:', modeOn ? '✅ ON' : '❌ OFF')

  // 4) Click element → popover → prompt → save
  await page.mouse.click(640, 300)
  await page.waitForTimeout(800)
  const popCount = await page.locator('#__vpx_pop textarea').count()
  log('popover:', popCount ? '✅ shown' : '❌ not shown')
  let posted = false
  if (popCount) {
    await page.locator('#__vpx_pop textarea').fill('Make the cassette/track label font in this area larger and crisper')
    await page.locator('#__vpx_pop .__vpx_save').click()
    await page.waitForTimeout(2000)
    const toast = await page.evaluate(() => document.getElementById('__vpx_toast')?.textContent || '')
    log('submit toast:', JSON.stringify(toast))
    posted = /Saved|fp-/.test(toast)
  }

  // 5) Was it actually written to the server inbox (queried from the extension page context)
  const fps = await page.evaluate(async () => {
    try { return await (await fetch('http://localhost:3001/api/fixpoints')).json() }
    catch (e) { return { err: String(e.message) } }
  })
  const pend = (fps.pending || [])
  log('server fixpoints/pending:', pend.length, 'items')
  if (pend.length) {
    const last = pend[pend.length - 1]
    console.log('   →', last.id, '| target:', JSON.stringify(last.target), '| selector:', last.element?.selector, '| prompt:', (last.prompt || '').slice(0, 40))
  }

  console.log('\n=== Measured results ===')
  console.log('content script injection:', fab ? 'OK' : 'FAIL')
  console.log('native enter            :', entered ? 'OK' : 'PARTIAL')
  console.log('collection mode/popover :', modeOn && popCount ? 'OK' : 'CHECK')
  console.log('server write            :', pend.length ? `OK (${pend.length} items)` : 'FAIL')
  if (errs.length) console.log('pageerror:', errs.slice(0, 3).join(' | '))
} finally {
  await ctx.close()
}
