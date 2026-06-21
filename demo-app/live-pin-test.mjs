// live-pin-test.mjs — loads the local dev server (:3000) through VP (:3001) in a real browser,
// drops a pin, and E2E-verifies that the fixpoint is written to the server.
import { chromium } from 'playwright'

const VP = process.env.VP || 'http://localhost:3001'
const log = (...a) => console.log('•', ...a)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

try {
  log('Open VP app:', VP)
  await page.goto(VP, { waitUntil: 'networkidle' })

  // Select the configured target (local-dev → http://localhost:3000) → load in local mode
  await page.waitForSelector('.target-select')
  await page.selectOption('.target-select', 'local-dev')
  log('Selected target local-dev → waiting for iframe load')

  await page.waitForSelector('iframe.page-frame')
  const frame = page.frameLocator('iframe.page-frame')
  await frame.locator('#new-report').waitFor({ timeout: 15000 })
  log('Demo app loaded (New report button visible)')

  // Give the inspector time to activate
  await page.waitForTimeout(800)

  // Turn the UI prompt switch ON
  await page.locator('label.switch', { hasText: 'UI Prompt' }).click()
  log('UI prompt mode ON')
  await page.waitForTimeout(400)

  // Click the New report button → popover
  await frame.locator('#new-report').click()
  await frame.locator('#__vp_pop textarea').waitFor({ timeout: 5000 })
  log('Popover shown → entering prompt')

  const PROMPT = 'Open a modal instead of navigating; keep the brand color and make it the primary CTA'
  await frame.locator('#__vp_pop textarea').fill(PROMPT)
  await frame.locator('#__vp_pop .__vp_save').click()
  log('Clicked save → waiting for server write')

  // Time for the server to write
  await page.waitForTimeout(1200)

  const res = await page.evaluate(async () => (await fetch('/api/fixpoints')).json())
  const pending = res.pending || []
  const hit = pending.find((p) => p.prompt && p.prompt.includes('primary CTA'))

  console.log('\n=== Result ===')
  console.log('pending count:', pending.length)
  if (!hit) throw new Error('fixpoint was not written')
  console.log('written fixpoint:', hit.id)
  console.log('  page    :', hit.page)
  console.log('  target  :', JSON.stringify(hit.target))
  console.log('  selector:', hit.element?.selector)
  console.log('  testids :', hit.clues?.testids)
  console.log('  comps   :', hit.clues?.components)
  console.log('  hints   :', hit.sourceHints?.frontend)
  console.log('  files   :', hit.fileHints)
  console.log('\n✅ Live pin → fixpoint write E2E passed')
  if (errors.length) console.log('(browser console errors:', errors.length, '— may be unrelated to the demo)')
} finally {
  await browser.close()
}
