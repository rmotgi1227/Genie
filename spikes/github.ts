// Live test, real Composio GitHub calls, run once by hand: `npx tsx spikes/github.ts`.
// Creates a real repo (genie-test-<HHMM>), pushes a sample app, confirms MIT + index.html + README,
// then files a real issue, confirms pollReports() picks it up, and resolveIssue() comments + closes it.
// VERCEL_TOKEN is cleared before steps/deploy.ts's module (a top-level `const TOKEN = …`) ever loads,
// so publish() doesn't actually deploy — the dynamic imports below matter, a static one would load
// deploy.ts (via steps/launch.ts) before this line runs. APPROVAL_TRANSPORT stays whatever .env has
// it as (real), but this script never calls askApproval — nothing texts anyone.
import '../lib/env'
process.env.VERCEL_TOKEN = ''

import { mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import type { App } from '../lib/types'

const { tool, composioEnabled } = await import('../lib/composio')
const { owner, repoName, repoUrl } = await import('../lib/repo')
const { publish, pollReports, resolveIssue } = await import('../steps/launch')

if (!composioEnabled()) {
  console.log('COMPOSIO_API_KEY not set, nothing to test live')
  process.exit(1)
}

const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
const slug = `genie-test-${hhmm}`
const sampleDir = join('apps', slug)
mkdirSync(sampleDir, { recursive: true })
copyFileSync(join('apps', 'splits-a-restaurant-bill', 'index.html'), join(sampleDir, 'index.html'))

const app: App = {
  slug,
  spec: 'a bill splitter that splits by item (live GitHub spike)',
  wish: { text: 'I wish there was an app that splits a restaurant bill by item', author: 'genie_spike', url: '', source: 'reddit' },
  askers: [],
  stage: 'building',
  issues: [],
  version: 1,
}

// Composio wraps GitHub's own GET-content response under `.content` (confirmed live).
type GhContent = { content?: { sha?: string; content?: string } }

async function fileExists(path: string): Promise<boolean> {
  return tool<GhContent>('GITHUB_GET_REPOSITORY_CONTENT', { owner: owner(), repo: repoName(app), path })
    .then(() => true)
    .catch(() => false)
}

async function main() {
  console.log(`[spike] publishing ${slug}...`)
  const pagesUrl = await publish(app)
  console.log(`[spike] publish() returned: ${pagesUrl} (expect a localhost link — Vercel is off for this test)`)
  console.log(`[spike] repo: ${repoUrl(app)}`)

  const indexOk = await fileExists('index.html')
  const readmeOk = await fileExists('README.md')
  const licenseFile = await tool<GhContent>('GITHUB_GET_REPOSITORY_CONTENT', { owner: owner(), repo: repoName(app), path: 'LICENSE' }).catch(() => undefined)
  const licenseText = licenseFile?.content?.content ? Buffer.from(licenseFile.content.content, 'base64').toString('utf8') : ''
  console.log(`[spike] index.html present: ${indexOk}`)
  console.log(`[spike] README.md present: ${readmeOk}`)
  console.log(`[spike] LICENSE looks like MIT: ${/MIT License/i.test(licenseText)}`)
  if (!indexOk || !readmeOk || !/MIT License/i.test(licenseText)) {
    console.log('[spike] FAILED: repo is missing one of index.html / README.md / an MIT LICENSE')
    process.exit(1)
  }

  console.log(`[spike] filing a real issue on ${repoUrl(app)}...`)
  const issue = await tool<{ number: number; html_url: string }>('GITHUB_CREATE_AN_ISSUE', {
    owner: owner(),
    repo: repoName(app),
    title: 'Can you add dark mode?',
    body: 'Filed by spikes/github.ts for a live pollReports()/resolveIssue() test.',
  })
  console.log(`[spike] issue filed: ${issue.html_url}`)

  console.log('[spike] polling via pollReports()...')
  let reports: Awaited<ReturnType<typeof pollReports>> = []
  for (let i = 0; i < 10 && !reports.length; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    reports = await pollReports([app])
  }
  const picked = reports.find((r) => r.url === issue.html_url)
  console.log(`[spike] pollReports() picked it up: ${!!picked}`, picked)
  if (!picked) {
    console.log('[spike] FAILED: pollReports() never returned the filed issue')
    process.exit(1)
  }

  console.log('[spike] resolving it via resolveIssue()...')
  const genieIssue = { id: picked.id, source: 'github', kind: 'feature', text: picked.text, title: 'dark mode', status: 'triaged' }
  const { url } = await resolveIssue(app, genieIssue as any, 'Thanks for filing this — this was a spike test, not a real fix, so closing it out.')
  console.log(`[spike] resolveIssue() comment url: ${url}`)

  const after = await tool<{ state?: string }>('GITHUB_GET_AN_ISSUE', { owner: owner(), repo: repoName(app), issue_number: issue.number })
  console.log(`[spike] issue state after resolveIssue(): ${after.state} (expect closed)`)
  if (after.state !== 'closed') {
    console.log('[spike] FAILED: resolveIssue() did not close the issue')
    process.exit(1)
  }

  console.log('')
  console.log(`[spike] all checks passed. Test repo (left in place): ${repoUrl(app)}`)
  console.log(`[spike] issue: ${issue.html_url}`)
}

main().catch((e) => {
  console.error('[spike] FAILED', e)
  process.exit(1)
})
