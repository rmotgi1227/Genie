// CLINE — build one index.html, then smoke-test it with Playwright.
// build() is FAKE for now: it picks the sample app in template/apps/ that matches the spec.
//   REAL: `cline -y --json -t 180 -P $CLINE_PROVIDER -m $CLINE_MODEL "<task>"` in apps/<slug>/
//   with template/CONTRACT.md copied in. Task = spec + askers' quotes + footer values.
// test() is REAL: headless Chromium at 375px wide, fails on page/console errors, clicks the first
//   button that isn't a theme toggle, checks the footer and viewport tag, saves a first-visit
//   apps/<slug>/screenshot.png.
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import type { App, Check, FeedLine, TestResult } from '../lib/types'
import { fakeDelay, sleep } from '../lib/state'

export const appDir = (app: App) => join('apps', app.slug)
export const appFile = (app: App) => join(appDir(app), 'index.html')
const ISSUES_URL = process.env.ISSUES_URL ?? 'https://github.com/genie-wishes/wishes/issues'

// The fake Cline has three apps it knows how to "write". Anything else gets the bill splitter.
const TEMPLATES: [RegExp, string][] = [
  [/grocer|recipe|aisle|shopping/i, 'grocery'],
  [/park|meter|countdown|timer/i, 'parking'],
  [/bill|split|tab|restaurant/i, 'bill'],
]
const pickTemplate = (spec: string) => TEMPLATES.find(([re]) => re.test(spec))?.[1] ?? 'bill'

// What the fake Cline "says" while it writes each app: its reasoning in plain sentences, the files it
// reads, the edits it makes. The real one maps its --json events the same way (see FeedLine in lib/types.ts).
type Line = [FeedLine['kind'], string]
const FEEDS: Record<string, Line[]> = {
  bill: [
    ['read', 'Reading CONTRACT.md'],
    ['thought', 'One static page: people, items with who shared them, and a totals section. No login, no backend.'],
    ['edit', 'Creating index.html with the three sections'],
    ['thought', 'Tax and tip should follow each person\'s share of the food, not be split evenly, or the person who had a salad pays for the steak.'],
    ['edit', 'Adding tax and tip, split in proportion to each share'],
    ['thought', 'Splitting $10 three ways gives $3.33 each and loses a cent, so I\'ll hand leftover cents to the largest remainders.'],
    ['edit', 'Making the cents add up exactly'],
    ['edit', 'Styling for 375px with cards and one accent color'],
    ['edit', 'Writing the footer'],
  ],
  grocery: [
    ['read', 'Reading CONTRACT.md'],
    ['thought', 'Paste ingredients, get them grouped by aisle in the order you walk a store. Produce first, frozen and drinks last.'],
    ['edit', 'Creating index.html with a textarea and the list'],
    ['thought', 'A keyword map per aisle is enough: "onion" and "lime" are produce, "chicken" is meat, "rice" is pantry. First match wins.'],
    ['edit', 'Mapping ingredients to aisles in store order'],
    ['edit', 'Adding checkboxes and a copy button'],
    ['edit', 'Styling for 375px with cards and one accent color'],
    ['edit', 'Writing the footer'],
  ],
  parking: [
    ['read', 'Reading CONTRACT.md'],
    ['thought', 'Type the minutes on the meter, get a countdown. It has to survive closing the tab, so the end time goes in localStorage.'],
    ['edit', 'Creating index.html with the minutes input and quick buttons'],
    ['edit', 'Counting down, red under five minutes, blinking when expired'],
    ['edit', 'Remembering the end time across reloads'],
    ['edit', 'Styling for 375px with cards and one accent color'],
    ['edit', 'Writing the footer'],
  ],
}

export async function build(app: App, onLine?: (line: FeedLine) => void): Promise<string> {
  const tpl = pickTemplate(app.spec ?? app.wish.text)
  console.log(`[cline] building ${app.slug} (fake, template ${tpl})`)
  const pace = Number(process.env.FAKE_DELAY_MS ?? 700) / 2
  for (const [kind, text] of FEEDS[tpl]) {
    await sleep(kind === 'thought' ? pace * 1.4 : pace)
    onLine?.({ t: Date.now(), text, kind, file: kind === 'thought' ? undefined : text.includes('CONTRACT') ? 'CONTRACT.md' : 'index.html' })
  }
  await fakeDelay()
  mkdirSync(appDir(app), { recursive: true })
  const html = readFileSync(`template/apps/${tpl}.html`, 'utf8')
    .replaceAll('{{SPEC}}', app.spec ?? app.wish.text)
    .replaceAll('{{WISHER}}', app.wish.author || 'someone')
    .replaceAll('{{ISSUES_URL}}', ISSUES_URL)
  writeFileSync(appFile(app), html)
  return appFile(app)
}

// Keeps a copy of the current screenshot as v<N>.png so the board can show before/after.
export function snapshotVersion(app: App): string | undefined {
  const src = join(appDir(app), 'screenshot.png')
  if (!existsSync(src)) return undefined
  copyFileSync(src, join(appDir(app), `v${app.version}.png`))
  return `/apps/${app.slug}/v${app.version}.png`
}

// `onCheck` fires as each check lands, so the board ticks them off live.
export async function test(app: App, onCheck?: (check: Check) => void): Promise<TestResult> {
  const file = appFile(app)
  if (!existsSync(file)) return { ok: false, error: 'index.html missing' }
  console.log(`[playwright] testing ${app.slug}`)
  const checks: Check[] = []
  const push = (label: string, ok: boolean) => { const c = { label, ok, at: Date.now() }; checks.push(c); onCheck?.(c) }
  const fail = (error: string): TestResult => ({ ok: false, error, checks })
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 740 } })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('dialog', (d) => d.dismiss().catch(() => {})) // an alert() or confirm() must not hang the test
    const url = pathToFileURL(resolve(file)).href
    await page.goto(url, { waitUntil: 'load', timeout: 15000 })
    await page.waitForTimeout(300)

    push('Loads with no errors', errors.length === 0)
    if (errors.length) return fail(`page errors: ${errors.slice(0, 3).join(' | ')}`)

    // Core feature: the page is interactive and using it doesn't throw.
    // A theme toggle isn't the core feature, and clicking it would save "light" and flip the screenshot.
    const buttons = page.locator('button, [role=button], input[type=submit]').filter({ hasNot: page.locator('xpath=self::*[contains(translate(@class,"THEM","them"),"theme") or contains(translate(@aria-label,"THEM","them"),"theme") or contains(translate(@id,"THEM","them"),"theme")]') })
    const inputs = page.locator('input, select, textarea')
    let core = (await buttons.count()) > 0 || (await inputs.count()) > 0
    if (core && (await buttons.count()) > 0) {
      await buttons.first().click({ timeout: 3000 }).catch(() => { core = false })
      await page.waitForTimeout(200)
      if (errors.length) core = false
    }
    push('Core feature works', core)
    if (!core) return fail(errors.length ? `errors after clicking: ${errors[0]}` : 'nothing to interact with')

    const footer = (await page.locator('footer').first().textContent().catch(() => '')) ?? ''
    const footerOk = /granted by Genie/i.test(footer)
    const viewportOk = (await page.locator('meta[name="viewport"]').count()) > 0
    push('Footer and viewport in place', footerOk && viewportOk)
    if (!footerOk) return fail('footer missing')
    if (!viewportOk) return fail('viewport meta tag missing')

    // First visit for the screenshot: a fresh context, so nothing the clicks saved in localStorage carries over.
    const fresh = await (await browser.newContext({ viewport: { width: 375, height: 740 } })).newPage()
    await fresh.goto(url, { waitUntil: 'load' })
    await fresh.waitForTimeout(300)
    await fresh.screenshot({ path: join(appDir(app), 'screenshot.png') })
    push('Screenshot taken', true)
    return { ok: true, screenshot: `/apps/${app.slug}/screenshot.png`, checks }
  } catch (e) {
    return fail((e as Error).message)
  } finally {
    await browser.close()
  }
}
