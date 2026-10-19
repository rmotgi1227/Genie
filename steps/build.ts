// CLINE — build one index.html, then smoke-test it. FAKE for now.
// REAL build: `cline -y --json -t 180 -P $CLINE_PROVIDER -m $CLINE_MODEL "<task>"` in apps/<slug>/
//   with template/CONTRACT.md copied in. Task = spec + askers' quotes + footer values.
// REAL test: Playwright (chromium, --no-sandbox --disable-dev-shm-usage): load the page, fail on console
//   errors or missing footer, save apps/<slug>/screenshot.png.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { App, TestResult } from '../lib/types'
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
  console.log(`[cline] testing ${app.slug} (fake, no browser)`)
  await fakeDelay()
  if (!existsSync(appFile(app))) return { ok: false, error: 'index.html missing' }
  const html = readFileSync(appFile(app), 'utf8')
  if (!html.includes('name="viewport"')) return { ok: false, error: 'viewport meta tag missing' }
  if (!html.includes('granted by Genie')) return { ok: false, error: 'footer missing' }
  // REAL: checks = [{ label: 'Loads with no errors', ok }, { label: 'Core feature works', ok }, { label: 'Screenshot taken', ok }]
  return {
    ok: true,
    screenshot: `/apps/${app.slug}/screenshot.png`,
    checks: [
      { label: 'Loads with no errors', ok: true },
      { label: 'Footer and viewport in place', ok: true },
    ],
  }
}
