// capture-shots.mjs — capture README screenshots of the core flow:
// (1) many edit-prompt pins placed across a complex UI, (2) entering a prompt.
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '..', 'docs', 'images')
const VP = 'http://localhost:5173'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })

await page.goto(VP, { waitUntil: 'networkidle' })
await page.waitForSelector('.target-select')
await page.selectOption('.target-select', 'local-dev')
await page.waitForSelector('iframe.page-frame')
const frame = page.frameLocator('iframe.page-frame')
await frame.locator('#new-report').waitFor({ timeout: 15000 })
await page.waitForTimeout(900)

// Turn UI Prompt mode ON
await page.locator('label.switch', { hasText: 'UI Prompt' }).click()
await page.waitForTimeout(500)

// Pin several elements (all in the upper viewport so they show together)
const pins = [
  { sel: '#search-input', prompt: 'Add a ⌘K shortcut hint aligned to the right inside the field.' },
  { sel: '#user-avatar', prompt: 'Show an online status dot and open a profile menu on click.' },
  { sel: '#new-report', pos: { x: 40, y: 19 }, prompt: 'Open a modal instead of navigating; keep the brand color.' },
  { sel: '#stat-revenue', pos: { x: 16, y: 16 }, prompt: 'Show exact daily values in a tooltip when hovering the sparkline.' },
  { sel: '#revenue-chart', pos: { x: 16, y: 16 }, prompt: 'Switch to a stacked area chart and add a legend.' },
]
for (const p of pins) {
  const loc = frame.locator(p.sel)
  await loc.scrollIntoViewIfNeeded()
  await loc.click(p.pos ? { position: p.pos } : {})
  await frame.locator('#__vp_pop textarea').waitFor({ timeout: 5000 })
  await frame.locator('#__vp_pop textarea').fill(p.prompt)
  await frame.locator('#__vp_pop .__vp_save').click()
  await page.waitForTimeout(250)
}
// scroll iframe back to top so all pins are visible together
await frame.locator('#search-input').scrollIntoViewIfNeeded()
await page.waitForTimeout(500)

// ── Shot 1: many pins placed across the UI + side panel list
await page.screenshot({ path: path.join(OUT, 'shot-1-pins.png') })
console.log('✓ shot-1-pins.png')

// ── Shot 2: entering a prompt on another element (popover open, pins around)
await frame.locator('#stat-orders').click({ position: { x: 16, y: 16 } })
await frame.locator('#__vp_pop textarea').waitFor({ timeout: 5000 })
await frame.locator('#__vp_pop textarea').fill('Make this card clickable and link to the orders list, with a subtle hover lift.')
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(OUT, 'shot-2-prompt.png') })
console.log('✓ shot-2-prompt.png')

await browser.close()
console.log('→ docs/images/ screenshots saved')
