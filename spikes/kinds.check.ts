// `npx tsx spikes/kinds.check.ts` — no network, no Cline, no browser. Checks that:
//   1. buildTask() puts the right paragraph in the task for each app.kind
//   2. the browser_extension manifest validator catches a good manifest, a bad manifest_version,
//      and a manifest that references a file that doesn't exist
//   3. runProcess() (the runner behind the cli/editor_plugin checks) works end to end on a tiny
//      canned CLI script this spike writes to a scratch dir
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildTask, validateExtensionManifest, runProcess, testCli, testEditorPlugin, appDir } from '../steps/build'
import type { App, Check } from '../lib/types'

let n = 0
let ok = 0
function check(label: string, pass: boolean) {
  n++
  ok += pass ? 1 : 0
  console.log(`${pass ? 'ok  ' : 'FAIL'} - ${label}`)
}

const blank = (kind: App['kind']): App => ({
  slug: 'kind-spike',
  spec: 'a tool that does the thing',
  kind,
  wish: { text: 'a tool that does the thing', author: 'someone', url: 'https://reddit.com/r/x/comments/1/a/', source: 'reddit' },
  askers: [],
  stage: 'building',
  issues: [],
  version: 1,
})

// ─────────────────────────── 1. task paragraph per kind ───────────────────────────

const webPageTask = buildTask(blank('web_page'))
check('web_page task says index.html is the whole app', /web_page: the whole app is index\.html/.test(webPageTask))

const undeclaredTask = buildTask(blank(undefined))
check('undeclared kind defaults to the web_page paragraph', /web_page: the whole app is index\.html/.test(undeclaredTask))

const extTask = buildTask(blank('browser_extension'))
check('browser_extension task mentions Manifest V3 in extension/', /extension\/manifest\.json with "manifest_version": 3/.test(extTask))
check('browser_extension task gives the install line', /Load unpacked/.test(extTask))
check('browser_extension task keeps the index.html landing page', /index\.html at the top of this directory as the/.test(extTask))

const cliTask = buildTask(blank('cli'))
check('cli task mentions package.json "bin"', /package\.json with "bin" pointing at/.test(cliTask))
check('cli task mentions examples\\/', /examples\/ directory/.test(cliTask))
check('cli task shows the npx usage line', /npx github:/.test(cliTask))

const pluginTask = buildTask(blank('editor_plugin'))
check('editor_plugin task mentions engines.vscode', /engines\.vscode/.test(pluginTask))
check('editor_plugin task mentions extension.js as main', /"main":\s*\n?\s*"extension\.js"/.test(pluginTask))

// ─────────────────────────── 2. manifest validator ───────────────────────────

const root = mkdtempSync(join(tmpdir(), 'genie-kinds-check-'))
const extDir = (name: string) => {
  const dir = join(root, name)
  return dir
}

function writeManifest(dir: string, manifest: object, extraFiles: string[] = []) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  for (const f of extraFiles) writeFileSync(join(dir, f), '// stub\n')
}

const goodDir = extDir('good')
writeManifest(goodDir, { manifest_version: 3, name: 'x', version: '1.0', background: { service_worker: 'sw.js' }, content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }] }, ['sw.js', 'content.js'])
const good = validateExtensionManifest(goodDir)
check('valid manifest: ok', good.ok === true)
check('valid manifest: mv3 true', good.mv3 === true)
check('valid manifest: nothing missing', good.missing.length === 0)

const mv2Dir = extDir('mv2')
writeManifest(mv2Dir, { manifest_version: 2, name: 'x', version: '1.0' })
const mv2 = validateExtensionManifest(mv2Dir)
check('manifest_version 2 is rejected', mv2.ok === false && mv2.mv3 === false)

const missingDir = extDir('missing-file')
writeManifest(missingDir, { manifest_version: 3, name: 'x', version: '1.0', background: { service_worker: 'sw.js' } }) // sw.js never written
const missing = validateExtensionManifest(missingDir)
check('manifest referencing a missing file is rejected', missing.ok === false && missing.missing.includes('sw.js'))

const noManifestDir = extDir('no-manifest')
mkdirSync(noManifestDir, { recursive: true })
const absent = validateExtensionManifest(noManifestDir)
check('no manifest.json at all is rejected', absent.ok === false && !!absent.error)

const badJsonDir = extDir('bad-json')
mkdirSync(badJsonDir, { recursive: true })
writeFileSync(join(badJsonDir, 'manifest.json'), '{not json')
const badJson = validateExtensionManifest(badJsonDir)
check('unparseable manifest.json is rejected', badJson.ok === false && !!badJson.error)

// ─────────────────────────── 3. cli smoke runner on a tiny canned CLI ───────────────────────────

const cliDir = join(root, 'cli')
mkdirSync(join(cliDir, 'examples'), { recursive: true })
writeFileSync(
  join(cliDir, 'greet.js'),
  [
    '#!/usr/bin/env node',
    "const arg = process.argv[2]",
    "if (arg === '--help') { console.log('usage: greet <file>'); process.exit(0) }",
    "const fs = require('node:fs')",
    "if (!arg) { console.error('missing file'); process.exit(1) }",
    "console.log('hello ' + fs.readFileSync(arg, 'utf8').trim())",
  ].join('\n'),
)
writeFileSync(join(cliDir, 'examples', 'name.txt'), 'world')

const help = await runProcess(process.execPath, [join(cliDir, 'greet.js'), '--help'], cliDir, 5000)
check('canned CLI --help exits 0', help.code === 0)
check('canned CLI --help prints usage', help.stdout.includes('usage:'))

const onExample = await runProcess(process.execPath, [join(cliDir, 'greet.js'), join(cliDir, 'examples', 'name.txt')], cliDir, 5000)
check('canned CLI run on examples/ exits 0 with output', onExample.code === 0 && onExample.stdout.includes('hello world'))

const timedOut = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], cliDir, 300)
check('runProcess kills a process that overruns its timeout', timedOut.code !== 0)

rmSync(root, { recursive: true, force: true })

// ───── 4. testCli/testEditorPlugin against apps/<slug> itself (the real, relative appDir()) ─────
// appDir() returns a relative path ("apps/<slug>"), and runProcess() sets that same relative path
// as the child's cwd — a prior bug here joined the bin path with the dir *and* ran from that dir,
// so node resolved it twice (apps/<slug>/apps/<slug>/bin/x.js). These run against the real apps/
// tree, not a scratch dir, so they'd catch that regression the way the scratch-dir checks above
// (which use an absolute cliDir) cannot.
const cliApp: App = { slug: 'kind-check-cli-tmp', wish: { text: '', author: '', url: '', source: 'reddit' }, askers: [], stage: 'building', issues: [], version: 1 }
mkdirSync(join(appDir(cliApp), 'examples'), { recursive: true })
writeFileSync(join(appDir(cliApp), 'package.json'), JSON.stringify({ name: 'kind-check-cli-tmp', type: 'module', bin: { 'kind-check-cli-tmp': 'bin/run.js' } }))
mkdirSync(join(appDir(cliApp), 'bin'), { recursive: true })
writeFileSync(
  join(appDir(cliApp), 'bin', 'run.js'),
  "const arg = process.argv[2]\nif (arg === '--help') { console.log('usage: run <file>'); process.exit(0) }\nconsole.log('ran ' + arg)\n",
)
writeFileSync(join(appDir(cliApp), 'examples', 'in.txt'), 'x')
const cliChecks: Check[] = []
const cliError = await testCli(cliApp, (label, cliOk) => cliChecks.push({ label, ok: cliOk }))
check('testCli on the real apps/<slug> dir: no error', cliError === undefined)
check('testCli on the real apps/<slug> dir: every check ok', cliChecks.every((c) => c.ok))
rmSync(appDir(cliApp), { recursive: true, force: true })

const pluginApp: App = { slug: 'kind-check-plugin-tmp', wish: { text: '', author: '', url: '', source: 'reddit' }, askers: [], stage: 'building', issues: [], version: 1 }
mkdirSync(appDir(pluginApp), { recursive: true })
writeFileSync(join(appDir(pluginApp), 'package.json'), JSON.stringify({ name: 'kind-check-plugin-tmp', engines: { vscode: '^1.80.0' }, main: 'extension.js' }))
writeFileSync(join(appDir(pluginApp), 'extension.js'), "function activate() {}\nmodule.exports = { activate }\n")
const pluginChecks: Check[] = []
const pluginError = await testEditorPlugin(pluginApp, (label, pluginOk) => pluginChecks.push({ label, ok: pluginOk }))
check('testEditorPlugin on the real apps/<slug> dir: no error', pluginError === undefined)
check('testEditorPlugin on the real apps/<slug> dir: every check ok', pluginChecks.every((c) => c.ok))
rmSync(appDir(pluginApp), { recursive: true, force: true })

console.log(`\nkinds check: ${ok}/${n} ok`)
if (ok !== n) process.exit(1)
