// Playwright on every app in apps/: the same test the loop runs (steps/build.ts test()).
//   npx tsx spikes/playwright.ts            all apps in state.json (plus any folder in apps/ not in state)
//   npx tsx spikes/playwright.ts <slug>     one app
// Prints pass/fail per check and the screenshot path. Writes the real checks back into state.json
// so the board shows this run on the next `npm start`.
import '../lib/env'
import { readdirSync, existsSync } from 'node:fs'
import { state, save } from '../lib/state'
import { test, appFile } from '../steps/build'
import type { App, Check } from '../lib/types'

const only = process.argv[2]
const known = [...state.apps, ...state.candidates]
const folders = existsSync('apps') ? readdirSync('apps', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []
const apps: App[] = folders
  .filter((slug) => !only || slug === only)
  .map((slug) => known.find((a) => a.slug === slug) ?? { slug, wish: { text: slug, author: '', url: '', source: 'reddit' }, askers: [], stage: 'maintaining', issues: [], version: 1 })

if (!apps.length) {
  console.log(only ? `no app folder apps/${only}` : 'no apps/ yet: run `npm run demo` first')
  process.exit(1)
}

let failed = 0
for (const app of apps) {
  if (!existsSync(appFile(app))) { console.log(`\n${app.slug}\n  ✗ no index.html`); failed++; continue }
  const t0 = Date.now()
  const live: Check[] = []
  const r = await test(app, (c) => live.push(c))
  const ms = Date.now() - t0
  console.log(`\n${app.slug}  (${r.ok ? 'PASS' : 'FAIL'}, ${(ms / 1000).toFixed(1)}s)`)
  for (const c of r.checks ?? []) console.log(`  ${c.ok ? '✓' : '✗'} ${c.label}`)
  if (!r.ok) { console.log(`  error: ${r.error}`); failed++ }
  if (r.screenshot) console.log(`  screenshot: ${r.screenshot.slice(1)}`)
  // the board reads these: same fields the loop writes
  if (known.includes(app)) {
    app.checks = [{ label: 'Writing the app', ok: true, at: t0 }, ...(r.checks ?? [])]
    app.test = { startedAt: t0, endedAt: Date.now() }
    if (r.screenshot) app.screenshot = r.screenshot
  }
}
save()
console.log(`\n${apps.length - failed}/${apps.length} apps pass. Checks saved to state.json for the board.`)
process.exit(failed ? 1 : 0)
