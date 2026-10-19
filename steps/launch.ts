// COMPOSIO + REDDIT + VERCEL — publish via Vercel, reply on the wisher's own thread. REAL launch side
// when COMPOSIO_API_KEY is set (waitForLive/replyText/replyReal/launch); publish() always deploys for
// real via steps/deploy.ts (fake there when VERCEL_TOKEN is unset). pollReports/resolveIssue and the
// fake-reports block below are still fake — a teammate owns the GitHub issues side and will replace them.
import type { App, Issue, Report } from '../lib/types'
import { fakeDelay, sleep, uniqueAuthors } from '../lib/state'
import { approvalsAreFake } from './askApproval'
import { tool, composioEnabled } from '../lib/composio'
import { repoUrl } from '../lib/repo'
import { postIdFromUrl } from '../lib/reddit'

// /r/<sub>/comments/<post>/<slug>/<comment>/ → the comment id; a thread URL has none
export const commentIdFromUrl = (url: string): string | undefined => url.match(/\/comments\/[a-z0-9]+\/[^/?#]*\/([a-z0-9]+)\/?(?:[?#]|$)/i)?.[1]
import { deploy } from './deploy'

export async function publish(app: App): Promise<string> {
  console.log(`[github] git push ${app.slug} v${app.version} (fake)`)
  await fakeDelay()
  return await deploy(app)
}

// ── launch ──

async function waitForLive(url: string, capMs = 60_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < capMs) {
    try {
      const res = await fetch(url)
      if (res.status === 200) return
    } catch {
      // not up yet, keep polling
    }
    await sleep(2000)
  }
  console.log(`[launch] ${url} wasn't 200 after ${capMs}ms, posting anyway`)
}

// The reply goes on the wisher's own thread, not a post in a subreddit we run. Short, human, says it's an AI.
function replyText(app: App, pagesUrl: string): string {
  const others = Math.max(0, uniqueAuthors(app.askers) - 1)
  return [
    `Hey u/${app.wish.author}, you wished for this, so I built it: ${pagesUrl}`,
    others ? `${others} other ${others === 1 ? 'person' : 'people'} on Reddit asked for the same thing, so hopefully it helps them too.` : '',
    `It's free and open source (MIT): ${repoUrl(app)}. If something's off or you want a feature, open an issue there and I'll make the change.`,
    `*I'm Genie, an AI agent. A human approved this reply before I posted it.*`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

// Reddit's /api/comment answer, as Composio passes it through. VERIFY shape on the first real reply.
type CommentResult = { json?: { errors?: unknown[]; data?: { things?: { data?: { id?: string; name?: string; permalink?: string } }[] } } }

async function replyReal(app: App, pagesUrl: string, launchTitle: string) {
  await waitForLive(pagesUrl)
  const postId = app.wish.url ? postIdFromUrl(app.wish.url) : undefined
  if (!postId) {
    // the owner's own idea (texted in) has no Reddit thread to answer
    console.log(`[composio] ${app.slug} has no Reddit thread to reply to, skipping the reply`)
    return { pagesUrl, launchPostId: '', launchTitle, launchUrl: '' }
  }
  try {
    // a wish from a comment gets the reply under that comment, not on the whole thread
    const commentId = commentIdFromUrl(app.wish.url)
    const r = await tool<CommentResult>('REDDIT_POST_REDDIT_COMMENT', { thing_id: commentId ? `t1_${commentId}` : `t3_${postId}`, text: replyText(app, pagesUrl) })
    const c = r?.json?.data?.things?.[0]?.data
    const launchUrl = c?.permalink ? `https://www.reddit.com${c.permalink}` : app.wish.url
    console.log(`[composio] replied to u/${app.wish.author} on ${app.wish.url}: ${launchUrl}`)
    return { pagesUrl, launchPostId: c?.name ?? c?.id ?? `t3_${postId}`, launchTitle, launchUrl }
  } catch (e) {
    // locked/archived thread, RATELIMIT, or automod: the app is already live, so log it and carry on. Never retry in a loop.
    console.log(`[composio] reply to ${app.wish.url} failed, app stays live: ${(e as Error).message}`)
    return { pagesUrl, launchPostId: '', launchTitle, launchUrl: '' }
  }
}

export async function launch(app: App): Promise<{ pagesUrl: string; launchPostId: string; launchTitle: string; launchUrl: string }> {
  const pagesUrl = await publish(app)
  const sub = app.wish.url?.match(/reddit\.com\/r\/([^/]+)/i)?.[1]
  const launchTitle = `Replied to u/${app.wish.author}${sub ? ` on r/${sub}` : ''}`
  // Never reply in public on a scripted YES: with fake approvals (npm run demo) the reply stays fake even if a key is set.
  if (!composioEnabled() || approvalsAreFake()) {
    console.log(`[composio] reply to u/${app.wish.author} on ${app.wish.url}: ${pagesUrl} (fake)`)
    await fakeDelay()
    return { pagesUrl, launchPostId: `fake_comment_${app.slug.slice(0, 8)}`, launchTitle, launchUrl: app.wish.url }
  }
  return replyReal(app, pagesUrl, launchTitle)
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
