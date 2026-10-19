// COMPOSIO + GITHUB — publish, post to r/GenieGrants, poll reports, reply on them. FAKE for now.
// REAL publish:      `git push` apps/<slug>/ to the Pages repo with GITHUB_TOKEN.
// REAL launch:       Composio REDDIT_CREATE_REDDIT_POST in r/GenieGrants (tags u/<wisher>, links the askers' threads).
// REAL pollReports:  GitHub issues on the wishes repo (title or label carries the app slug) + comments on
//                    each launch post (`<post>.json` or Composio). One call covers every live app.
// REAL resolveIssue: GITHUB_CREATE_AN_ISSUE_COMMENT + GITHUB_UPDATE_AN_ISSUE (state=closed), or
//                    REDDIT_POST_REDDIT_COMMENT for a Reddit report.
import type { App, Issue, Report } from '../lib/types'
import { fakeDelay, uniqueAuthors } from '../lib/state'
import { approvalsAreFake } from './askApproval'

const PAGES_BASE = process.env.PAGES_BASE ?? 'https://genie-wishes.github.io/wishes'

export async function publish(app: App): Promise<string> {
  console.log(`[github] git push ${app.slug} v${app.version} (fake)`)
  await fakeDelay()
  return `${PAGES_BASE}/${app.slug}/`
}

export async function launch(app: App): Promise<{ pagesUrl: string; launchPostId: string; launchTitle: string; launchUrl: string }> {
  const pagesUrl = await publish(app)
  const launchTitle = `${uniqueAuthors(app.askers)} people wished for ${app.spec}, so I built it`
  console.log(`[composio] r/GenieGrants post: "${launchTitle}" · u/${app.wish.author} · ${pagesUrl} (fake)`)
  await fakeDelay()
  const launchPostId = `fake_post_${app.slug.slice(0, 8)}`
  return { pagesUrl, launchPostId, launchTitle, launchUrl: `https://www.reddit.com/r/GenieGrants/comments/${launchPostId}/` }
}

// ── fake reports ──
// FAKE_REPORTS unset  → one "dark mode" request, only when the approvals are fake too (never texts a real phone by surprise)
// FAKE_REPORTS=       → nothing is ever filed on its own; use POST /report
// FAKE_REPORTS=a|b    → those requests, one every FAKE_REPORT_AFTER_MS, on the oldest live app
const DEFAULT_REPORT = 'Can you add dark mode?'
const fakeReports = (() => {
  const v = process.env.FAKE_REPORTS
  if (v === undefined) return approvalsAreFake() ? [DEFAULT_REPORT] : []
  return v.split('|').map((s) => s.trim()).filter(Boolean)
})()
const AFTER_MS = Number(process.env.FAKE_REPORT_AFTER_MS ?? 3000)
let firstPoll = 0
let fired = 0

export async function pollReports(apps: App[]): Promise<Report[]> {
  firstPoll ||= Date.now()
  if (fired >= fakeReports.length || !apps.length) return []
  if (Date.now() - firstPoll < AFTER_MS * (fired + 1)) return []
  const oldest = [...apps].sort((a, b) => (a.stageAt?.launched ?? 0) - (b.stageAt?.launched ?? 0))[0]
  const text = fakeReports[fired++]
  const n = 12 + fired
  console.log(`[github] new issue #${n} on ${oldest.slug}: "${text}" (fake)`)
  return [{ id: `gh_${n}`, slug: oldest.slug, source: 'github', author: 'maya_k', url: `https://github.com/genie-wishes/wishes/issues/${n}`, text }]
}

// Comments on the report and closes it, whether it shipped or was declined. Returns where the comment is.
export async function resolveIssue(app: App, issue: Issue, text: string): Promise<{ url?: string }> {
  console.log(`[${issue.source === 'github' ? 'github' : 'composio'}] reply on ${issue.id} (${app.slug}): "${text}" · closed (fake)`)
  await fakeDelay()
  return { url: issue.url ? `${issue.url}#issuecomment-${Date.now().toString().slice(-7)}` : undefined }
}
