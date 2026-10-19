// COMPOSIO — publish, post to r/GenieGrants, poll reports, reply "fixed". FAKE for now.
// REAL publish: `git push` apps/<slug>/ to the Pages repo with GITHUB_TOKEN.
// REAL launch: Composio REDDIT_CREATE_REDDIT_POST in r/GenieGrants (tags u/<wisher>, links the askers' threads).
// REAL pollReports: GitHub issues (gh/REST) + comments on the launch post (`<post>.json` or Composio).
// REAL replyFixed: Composio REDDIT_POST_REDDIT_COMMENT, or GITHUB_CREATE_AN_ISSUE_COMMENT + GITHUB_UPDATE_AN_ISSUE (closed).
import type { App, Issue, Report } from '../lib/types'
import { fakeDelay, uniqueAuthors } from '../lib/state'

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
  launchedAt.set(app.slug, Date.now())
  const launchPostId = `fake_post_${app.slug.slice(0, 8)}`
  return { pagesUrl, launchPostId, launchTitle, launchUrl: `https://www.reddit.com/r/GenieGrants/comments/${launchPostId}/` }
}

// The fake files the planted bug once, a few seconds after launch.
const launchedAt = new Map<string, number>()
const sent = new Set<string>()
export async function pollReports(app: App): Promise<Report[]> {
  const t = launchedAt.get(app.slug) ?? 0
  if (sent.has(app.slug) || Date.now() - t < Number(process.env.FAKE_REPORT_AFTER_MS ?? 3000)) return []
  sent.add(app.slug)
  console.log('[composio] new report on the launch post (fake)')
  return [{ id: `fake_report_${app.slug.slice(0, 8)}`, source: 'reddit', author: 'fake_user', text: "the total doesn't update when I remove a person" }]
}

export async function replyFixed(app: App, issue: Issue): Promise<void> {
  console.log(`[composio] reply on ${issue.source} ${issue.id}: "Fixed in v${app.version} ✅ ${app.pagesUrl} Thanks for the report." (fake)`)
  await fakeDelay()
}
