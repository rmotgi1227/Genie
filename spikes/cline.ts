// Real Cline, timed, outside the loop: the same build() / fix() / test() the loop runs.
//   npx tsx spikes/cline.ts build "a tip calculator that splits the bill"   new app in apps/<slug>/, then Playwright
//   npx tsx spikes/cline.ts fix <slug> "Can you add dark mode?"            change an app in apps/, diff, then Playwright
//   npx tsx spikes/cline.ts darkmode                                       fresh v1 bill splitter, then the dark-mode fix
// Prints each line the board would show, the diff size, and how long Cline and Playwright took.
import '../lib/env'
import { readFileSync, existsSync } from 'node:fs'
import { build, test, appFile, clineEnabled } from '../steps/build'
import { fix } from '../steps/fix'
import { shortSlug } from '../steps/discover'
import { diffLines } from '../lib/diff'
import type { App, FeedLine } from '../lib/types'

const [mode, a, b] = process.argv.slice(2)
if (!clineEnabled()) { console.log('Cline not set up: CLINE_PROVIDER and CLINE_MODEL in .env'); process.exit(1) }
const print = (l: FeedLine) => console.log(`  ${l.kind === 'thought' ? '…' : l.kind === 'edit' ? '✎' : '→'} ${l.text.slice(0, 160)}`)
const secs = (ms: number) => `${(ms / 1000).toFixed(0)}s`
const blank = (slug: string, spec: string, seeded = false): App =>
  ({ slug, spec, seeded, wish: { text: spec, author: 'spike', url: '', source: 'reddit' }, askers: [], stage: 'building', issues: [], version: 1 })

let app: App
let fallback = false
const watch = (l: FeedLine) => { if (l.text.startsWith("Cline didn't finish")) fallback = true; print(l) }
let t0 = Date.now()
if (mode === 'build') {
  const spec = a ?? 'a tip calculator that splits the bill between friends'
  app = blank(`spike-${shortSlug(spec, new Set())}`, spec)
  console.log(`Cline building "${spec}" in apps/${app.slug}/`)
  await build(app, watch)
} else if (mode === 'fix' || mode === 'darkmode') {
  if (mode === 'darkmode') {
    app = blank('spike-bill-splitter', 'a bill splitter that splits by item', true)
    await build(app) // seeded → the sample v1, light
    app.seeded = false
    t0 = Date.now()
  } else {
    if (!a || !existsSync(`apps/${a}/index.html`)) { console.log(`no apps/${a}/index.html`); process.exit(1) }
    app = blank(a, a)
  }
  const request = (mode === 'fix' ? b : undefined) ?? 'Can you add dark mode?'
  const before = readFileSync(appFile(app), 'utf8')
  console.log(`Cline changing apps/${app.slug}/: "${request}"`)
  await fix(app, { text: request, kind: 'feature' }, watch)
  const d = diffLines(before, readFileSync(appFile(app), 'utf8'))
  console.log(`  diff: +${d.added} −${d.removed}`)
} else {
  console.log('usage: spikes/cline.ts build "<wish>" | fix <slug> "<request>" | darkmode')
  process.exit(1)
}
const clineMs = Date.now() - t0
t0 = Date.now()
const r = await test(app)
const pwMs = Date.now() - t0
for (const c of r.checks ?? []) console.log(`  ${c.ok ? '✓' : '✗'} ${c.label}`)
console.log(`\nCline ${secs(clineMs)}${fallback ? ' (FELL BACK to the sample)' : ''} · Playwright ${secs(pwMs)} · ${r.ok ? 'PASS' : `FAIL: ${r.error}`}${r.screenshot ? ` · ${r.screenshot.slice(1)}` : ''}`)
process.exit(r.ok && !fallback ? 0 : 1)
