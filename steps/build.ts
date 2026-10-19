// CLINE — build one index.html, then smoke-test it with Playwright.
// build() is FAKE for now (copies the template).
//   REAL: `cline -y --json -t 180 -P $CLINE_PROVIDER -m $CLINE_MODEL "<task>"` in apps/<slug>/
//   with template/CONTRACT.md copied in. Task = spec + askers' quotes + footer values.
// test() is REAL: headless Chromium at 375px wide, fails on page/console errors, clicks the first
//   button, checks the footer and viewport tag, saves apps/<slug>/screenshot.png.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import type { App, Check, TestResult } from '../lib/types'
import { fakeDelay } from '../lib/state'

export const appDir = (app: App) => join('apps', app.slug)
export const appFile = (app: App) => join(appDir(app), 'index.html')
const ISSUES_URL = process.env.ISSUES_URL ?? 'https://github.com/genie-wishes/wishes/issues'

export async function build(app: App): Promise<string> {
  console.log(`[cline] building ${app.slug} (fake)`)
  await fakeDelay()
  mkdirSync(appDir(app), { recursive: true })
  const html = readFileSync('template/fake-app.html', 'utf8')
    .replaceAll('{{SPEC}}', app.spec ?? app.wish.text)
    .replaceAll('{{WISHER}}', app.wish.author)
    .replaceAll('{{ISSUES_URL}}', ISSUES_URL)
  writeFileSync(appFile(app), html)
  return appFile(app)
}

export async function test(app: App): Promise<TestResult> {
  const file = appFile(app)
  if (!existsSync(file)) return { ok: false, error: 'index.html missing' }
  console.log(`[playwright] testing ${app.slug}`)
  const checks: Check[] = []
  const fail = (error: string): TestResult => ({ ok: false, error, checks })
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 740 } })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    const url = pathToFileURL(resolve(file)).href
    await page.goto(url, { waitUntil: 'load', timeout: 15000 })
    await page.waitForTimeout(300)

    checks.push({ label: 'Loads with no errors', ok: errors.length === 0 })
    if (errors.length) return fail(`page errors: ${errors.slice(0, 3).join(' | ')}`)

    // Core feature: the page is interactive and using it doesn't throw.
    const buttons = page.locator('button, [role=button], input[type=submit]')
    const inputs = page.locator('input, select, textarea')
    let core = (await buttons.count()) > 0 || (await inputs.count()) > 0
    if (core && (await buttons.count()) > 0) {
      await buttons.first().click({ timeout: 3000 }).catch(() => { core = false })
      await page.waitForTimeout(200)
      if (errors.length) core = false
    }
    checks.push({ label: 'Core feature works', ok: core })
    if (!core) return fail(errors.length ? `errors after clicking: ${errors[0]}` : 'nothing to interact with')

    const footer = (await page.locator('footer').first().textContent().catch(() => '')) ?? ''
    const footerOk = /granted by Genie/i.test(footer)
    const viewportOk = (await page.locator('meta[name="viewport"]').count()) > 0
    checks.push({ label: 'Footer and viewport in place', ok: footerOk && viewportOk })
    if (!footerOk) return fail('footer missing')
    if (!viewportOk) return fail('viewport meta tag missing')

    await page.goto(url, { waitUntil: 'load' }) // clean state for the screenshot
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(appDir(app), 'screenshot.png') })
    checks.push({ label: 'Screenshot taken', ok: true })
    return { ok: true, screenshot: `/apps/${app.slug}/screenshot.png`, checks }
  } catch (e) {
    return fail((e as Error).message)
  } finally {
    await browser.close()
  }
}
