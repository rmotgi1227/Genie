// Real Cline, timed, outside the loop: proves app.kind picks the right build + test for a
// non-web_page wish. Never calls askApproval — it talks to build()/test() directly, the same ones
// the loop runs, and nothing here publishes anywhere.
//   npx tsx spikes/kinds.live.ts cli              the mailhops CLI wish from the task brief
//   npx tsx spikes/kinds.live.ts browser_extension the step-tracker extension wish
//   npx tsx spikes/kinds.live.ts both             both, one after another
import '../lib/env'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build, test, appDir, runProcess, clineEnabled } from '../steps/build'
import type { App, FeedLine } from '../lib/types'

process.env.APPROVAL_TRANSPORT = 'fake' // belt and suspenders: this script never asks, but nothing here should be able to either

if (!clineEnabled()) { console.log('Cline not set up: CLINE_PROVIDER and CLINE_MODEL in .env'); process.exit(1) }

const print = (l: FeedLine) => console.log(`  ${l.kind === 'thought' ? '…' : l.kind === 'edit' ? '✎' : '→'} ${l.text.slice(0, 160)}`)
const secs = (ms: number) => `${(ms / 1000).toFixed(0)}s`

const WISHES: Record<string, { slug: string; spec: string; kind: App['kind']; author: string; url: string }> = {
  cli: {
    slug: 'mailhops',
    spec: 'mailhops: a CLI that reads a raw email (stdin or file) and prints each Received hop as a timeline with server, timestamp and delay, slowest hop highlighted',
    kind: 'cli',
    author: 'opensource_dev',
    url: 'https://www.reddit.com/r/opensource/comments/194ugw3/',
  },
  browser_extension: {
    slug: 'step-tracker',
    spec: 'a step tracker that lets you click numbered steps on any how-to article to tick them off and remembers progress per page',
    kind: 'browser_extension',
    author: 'opensource_dev',
    url: 'https://www.reddit.com/r/opensource/comments/194ugw3/',
  },
}

function fileList(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.isDirectory()) out.push(...fileList(join(dir, name.name), `${prefix}${name.name}/`))
    else out.push(`${prefix}${name.name}`)
  }
  return out.sort()
}

async function runWish(key: string): Promise<boolean> {
  const w = WISHES[key]
  const app: App = {
    slug: w.slug,
    spec: w.spec,
    kind: w.kind,
    wish: { text: w.spec, author: w.author, url: w.url, source: 'reddit' },
    askers: [{ author: w.author, url: w.url, quote: w.spec, source: 'reddit' }],
    stage: 'building',
    issues: [],
    version: 1,
  }

  console.log(`\n=== ${w.kind}: ${w.slug} ===`)
  console.log(`Cline building "${w.spec}" in apps/${app.slug}/`)
  let fallback = false
  const watch = (l: FeedLine) => { if (l.text.startsWith("Cline didn't finish")) fallback = true; print(l) }
  const t0 = Date.now()
  await build(app, watch)
  const buildMs = Date.now() - t0

  const t1 = Date.now()
  const r = await test(app)
  const testMs = Date.now() - t1

  console.log(`\nfiles produced in apps/${app.slug}/:`)
  for (const f of fileList(appDir(app))) console.log(`  ${f}`)

  console.log(`\nchecks:`)
  for (const c of r.checks ?? []) console.log(`  ${c.ok ? '✓' : '✗'} ${c.label}`)

  if (w.kind === 'cli') {
    try {
      const pkgPath = join(appDir(app), 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      const binField = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin ?? {})[0]
      const examplesDir = join(appDir(app), 'examples')
      if (binField && existsSync(examplesDir)) {
        const sample = readdirSync(examplesDir).filter((f) => !f.startsWith('.'))[0]
        if (sample) {
          // Absolute, not left relative: runProcess's cwd is also appDir(app), so a relative path
          // here would get resolved against it a second time.
          const out = await runProcess(process.execPath, [resolve(appDir(app), String(binField)), resolve(examplesDir, sample)], appDir(app), 10_000)
          console.log(`\nCLI output on examples/${sample} (exit ${out.code}):`)
          console.log(out.stdout.split('\n').map((l) => `  ${l}`).join('\n'))
          if (out.stderr.trim()) console.log(`stderr:\n${out.stderr.split('\n').map((l) => `  ${l}`).join('\n')}`)
        }
      }
    } catch (e) {
      console.log(`(couldn't run the CLI on its example for this report: ${(e as Error).message})`)
    }
  }

  console.log(`\nCline ${secs(buildMs)}${fallback ? ' (FELL BACK to the fake build)' : ''} · Playwright+checks ${secs(testMs)} · ${r.ok ? 'PASS' : `FAIL: ${r.error}`}${r.screenshot ? ` · ${r.screenshot.slice(1)}` : ''}`)
  return r.ok && !fallback
}

const mode = process.argv[2] ?? 'cli'
const keys = mode === 'both' ? ['cli', 'browser_extension'] : [mode]
let allOk = true
for (const k of keys) {
  if (!WISHES[k]) { console.log(`usage: spikes/kinds.live.ts cli | browser_extension | both`); process.exit(1) }
  allOk = (await runWish(k)) && allOk
}
process.exit(allOk ? 0 : 1)
