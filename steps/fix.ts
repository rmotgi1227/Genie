// CLINE — smallest change that fixes one report. FAKE for now.
// REAL: `cline -y --json -t 120 -P $CLINE_PROVIDER -m $CLINE_MODEL "<fix task>"` in apps/<slug>/, task =
// "Read CONTRACT.md. The app is index.html. Bug: <text>. Make the smallest change that fixes it. Touch nothing else. Stop."
import { readFileSync, writeFileSync } from 'node:fs'
import type { App } from '../lib/types'
import { fakeDelay } from '../lib/state'
import { appFile } from './build'

export async function fix(app: App, report: { text: string }): Promise<void> {
  console.log(`[cline] fixing ${app.slug}: "${report.text}" (fake)`)
  await fakeDelay()
  // The fake only knows the planted bug: totals not re-rendered after removing a person.
  const html = readFileSync(appFile(app), 'utf8')
  writeFileSync(appFile(app), html.replace('renderPeople(); renderItems() /*BUG*/', 'render()'))
}
