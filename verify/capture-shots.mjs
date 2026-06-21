// capture-shots.mjs — capture README screenshots of the core flow:
// (1) selecting a UI element, (2) entering an edit prompt.
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '..', 'docs', 'images')
const VP = 'http://localhost:5173'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1380, height: 880 }, deviceScaleFactor: 2 })

await page.goto(VP, { waitUntil: 'networkidle' })
await page.waitForSelector('.target-select')
await page.selectOption('.target-select', 'local-dev')
await page.waitForSelector('iframe.page-frame')
const frame = page.frameLocator('iframe.page-frame')
await frame.locator('#buy').waitFor({ timeout: 15000 })
await page.waitForTimeout(800)

// Turn UI Prompt mode ON
await page.locator('label.switch', { hasText: 'UI Prompt' }).click()
await page.waitForTimeout(500)

// ── Shot 1: selecting a UI element (hover highlight + tooltip)
await frame.locator('#buy').hover()
await page.waitForTimeout(500)
await page.screenshot({ path: path.join(OUT, 'shot-1-select.png') })
console.log('✓ shot-1-select.png')

// ── Shot 2: entering an edit prompt (popover open with text)
await frame.locator('#buy').click()
await frame.locator('#__vp_pop textarea').waitFor({ timeout: 5000 })
await frame.locator('#__vp_pop textarea').fill(
  'Make the Buy button larger, use a green (#16a34a) background, and change the label to "Buy now".',
)
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(OUT, 'shot-2-prompt.png') })
console.log('✓ shot-2-prompt.png')

await browser.close()
console.log('→ docs/images/ screenshots saved')
