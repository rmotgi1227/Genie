// COMPOSIO + GITHUB + REDDIT + VERCEL — publish to a per-wish GitHub repo + Vercel, reply on the
// wisher's own thread, handle issues filed on that repo. REAL (createRepo/putFile/pollReportsReal/
// resolveIssueReal below) when COMPOSIO_API_KEY is set AND approvals aren't scripted; the fakes stay
// otherwise, same gate publish()/launch() already use for the Reddit reply — nothing goes public on
// a scripted YES. publish() always deploys for real via steps/deploy.ts (fake there when VERCEL_TOKEN
// is unset or approvals are fake).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import type { App, Issue, Report } from '../lib/types'
import { fakeDelay, sleep, uniqueAuthors } from '../lib/state'
import { approvalsAreFake } from './askApproval'
import { tool, composioEnabled } from '../lib/composio'
import { owner, repoName, repoUrl, resolveOwner, configuredOrg } from '../lib/repo'
import { appDir } from './build'
import { postIdFromUrl } from '../lib/reddit'
import { deploy } from './deploy'

// /r/<sub>/comments/<post>/<slug>/<comment>/ → the comment id; a thread URL has none
export const commentIdFromUrl = (url: string): string | undefined => url.match(/\/comments\/[a-z0-9]+\/[^/?#]*\/([a-z0-9]+)\/?(?:[?#]|$)/i)?.[1]

// ── publish ──
// publish()/launch() never catch a real-path error into a fake fallback: a failed first publish
// must not hand a localhost link to launch()'s Reddit post. Callers (genie.ts) decide what a thrown
// error means for the wish/issue in flight.

async function publishFake(app: App): Promise<string> {
  console.log(`[github] git push ${app.slug} v${app.version} (fake)`)
  await fakeDelay()
  return await deploy(app)
}

async function createRepo(app: App): Promise<void> {
  const who = await resolveOwner()
  const isOrg = who === configuredOrg()
  const args = { name: app.slug, private: false, has_issues: true, auto_init: true, license_template: 'mit', description: app.spec ?? app.wish.text }
  try {
    const r = isOrg
      ? await tool<{ name?: string }>('GITHUB_CREATE_AN_ORGANIZATION_REPOSITORY', { org: who, ...args })
      : await tool<{ name?: string }>('GITHUB_CREATE_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER', args)
    app.repo = r?.name || app.slug
  } catch (e) {
    // a 422 here almost always means the repo already exists (a leftover from an earlier rehearsal
    // of this exact slug) — reuse it rather than treating that as a real failure.
    if (!/422|already exists/i.test((e as Error).message)) throw e
    console.log(`[github] ${app.slug} already exists, reusing it`)
    app.repo = app.slug
  }
  await waitForAutoInit(app)
}

// auto_init's first commit (README + LICENSE) lands a beat after the repo API call returns; writing
// files immediately can 404/409 against a repo with no commits yet. Bounded poll, not a fixed sleep,
// so a slow org doesn't need a bigger guess and a fast one doesn't wait longer than it has to.
async function waitForAutoInit(app: App): Promise<void> {
  const repo = repoName(app)
  for (let i = 0; i < 6; i++) {
    const ready = await tool('GITHUB_GET_REPOSITORY_CONTENT', { owner: owner(), repo, path: 'README.md' })
      .catch(() => tool('GITHUB_GET_REPOSITORY_CONTENT', { owner: owner(), repo, path: 'LICENSE' }).catch(() => undefined))
    if (ready) return
    await sleep(1500)
  }
  console.log(`[github] ${repo}'s auto_init commit still not visible after ~9s, pushing anyway`)
}

// A git blob's sha1 ("blob <len>\0<content>") — the same id GitHub returns for a file's current
// content, so putFile() can skip the PUT entirely when the local file hasn't actually changed.
export function gitBlobSha(content: Buffer): string {
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${content.length}\0`), content])).digest('hex')
}

async function putFile(app: App, path: string, content: Buffer, message: string): Promise<void> {
  const repo = repoName(app)
  let sha: string | undefined
  try {
    // Composio wraps GitHub's own response under `.content` here (confirmed live, not guessed).
    const existing = await tool<{ content?: { sha?: string } }>('GITHUB_GET_REPOSITORY_CONTENT', { owner: owner(), repo, path })
    sha = existing?.content?.sha
    if (sha && sha === gitBlobSha(content)) return // unchanged since the last publish — nothing to push
  } catch {
    // no file at this path yet (first publish, or a new file a later version added) — create it, no sha needed
  }
  await tool('GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS', { owner: owner(), repo, path, message, content: content.toString('base64'), ...(sha ? { sha } : {}) })
}

// The app's own repo isn't always a single index.html: a browser extension ships a manifest and
// icons, a CLI ships package.json/bin/src, a VS Code extension its own package.json — index.html
// (the landing page) sits alongside whichever of those Cline wrote. Everything under apps/<slug>/
// goes to GitHub except what's build-internal, never part of the shipped app.
const SKIP_FILES = new Set(['CONTRACT.md'])
const isSnapshot = (name: string) => /^v\d+\.png$/i.test(name)

export function shouldSkipAppPath(name: string, isDir: boolean): boolean {
  if (name.startsWith('.')) return true // .vercel/, .git/, .gitignore, .env — build/deploy-local, not part of the app
  if (isDir) return name === 'node_modules'
  return SKIP_FILES.has(name) || isSnapshot(name)
}

function listAppFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (shouldSkipAppPath(entry.name, entry.isDirectory())) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(relative(root, full))
    }
  }
  walk(root)
  return out
}

function readme(app: App, pagesUrl: string): string {
  const asks = app.askers.length
    ? app.askers.map((a) => `- u/${a.author} — ${a.url}`).join('\n')
    : `- ${app.wish.url}`
  return [
    `# ${app.spec ?? app.wish.text}`,
    '',
    app.wish.text,
    '',
    `Wished for by u/${app.wish.author || 'someone'} and:`,
    asks,
    '',
    `Live: ${pagesUrl}`,
    '',
    'Built by an AI agent (Genie). MIT licensed.',
    '',
  ].join('\n')
}

// Cline sometimes writes its own README.md (a CLI or extension's usage docs); that's never
// overwritten with Genie's own, just appended to — same "Live"/footer lines readme() above writes
// for an app with no README.md of its own, so either way a reader gets the live link and the wish.
export function withGenieFooter(clineReadme: string, app: App, pagesUrl: string): string {
  return [
    clineReadme.replace(/\n+$/, ''),
    '',
    '---',
    '',
    `Live: ${pagesUrl}`,
    '',
    'Built by an AI agent (Genie). MIT licensed.',
    `Wished for by u/${app.wish.author || 'someone'}: ${app.wish.url}`,
    '',
  ].join('\n')
}

async function pushReadme(app: App, pagesUrl: string, message: string): Promise<void> {
  const local = join(appDir(app), 'README.md')
  const content = existsSync(local) ? withGenieFooter(readFileSync(local, 'utf8'), app, pagesUrl) : readme(app, pagesUrl)
  await putFile(app, 'README.md', Buffer.from(content, 'utf8'), message)
}

export async function publish(app: App): Promise<string> {
  // Never pushes a real repo on a scripted YES: with fake approvals (npm run demo) this stays fake
  // even if a Composio key is set, same rule launch()'s Reddit reply already follows.
  if (!composioEnabled() || approvalsAreFake()) return publishFake(app)
  // Always awaited here, not just inside createRepo(): a v2+ publish never calls createRepo() (app.repo
  // is already set), so without this it could race lib/repo.ts's eager, fire-and-forget resolution and
  // push to the wrong owner if that hadn't settled yet. Already resolved after the first call, so this
  // is a no-op cache read every time after.
  await resolveOwner()
  const first = !app.repo
  if (first) await createRepo(app)
  const n = app.version || 1
  const message = app.changelog?.length ? `v${n}: ${app.changelog.at(-1)!.text}` : `v${n}: initial build`
  // the Vercel project name is the slug (steps/deploy.ts), so the plain `<slug>.vercel.app` guess is
  // right unless that name was already taken; good enough for the README's "Live" line.
  const pagesUrl = `https://${app.slug}.vercel.app`
  const root = appDir(app)
  for (const rel of listAppFiles(root)) {
    if (rel === 'README.md') continue // handled below, since it may need Genie's footer appended
    await putFile(app, rel, readFileSync(join(root, rel)), message)
  }
  await pushReadme(app, pagesUrl, message)
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

async function pollReportsFake(apps: App[]): Promise<Report[]> {
  firstPoll ||= Date.now()
  if (fired >= fakeReports.length || !apps.length) return []
  if (Date.now() - firstPoll < AFTER_MS * (fired + 1)) return []
  const oldest = [...apps].sort((a, b) => (a.stageAt?.launched ?? 0) - (b.stageAt?.launched ?? 0))[0]
  const text = fakeReports[fired++]
  const n = 12 + fired
  console.log(`[github] new issue #${n} on ${oldest.slug}: "${text}" (fake)`)
  return [{ id: `gh_${n}`, slug: oldest.slug, source: 'github', author: 'maya_k', url: `https://github.com/genie-wishes/wishes/issues/${n}`, text }]
}

// ── real reports: GitHub issues on each live app's own repo ──
// genie.ts calls pollReports() every POLL_MS (~1s), so each repo is only actually listed every
// GITHUB_POLL_MS; in between this returns [] for that repo without a network call.
const GITHUB_POLL_MS = 5000
const lastPolled = new Map<string, number>()
const BOT_LOGIN = process.env.GITHUB_BOT_LOGIN?.toLowerCase() // the Composio GitHub connected account's own login, so its comments never come back as reports

export type GhIssue = { number: number; title: string; body?: string | null; html_url: string; user?: { login?: string }; pull_request?: unknown }

// Pure mapping from a repo's raw issue list to new Reports: drops PRs (GitHub's list-issues endpoint
// includes them, flagged by `pull_request`), issues already tracked on `app.issues`, and the bot's
// own issues. Exported so spikes/launch.check.ts can exercise it against canned JSON with no network.
export function mapGhIssuesToReports(app: App, issues: GhIssue[], botLogin = BOT_LOGIN): Report[] {
  const reports: Report[] = []
  for (const gh of issues) {
    if (gh.pull_request) continue
    const id = `gh_${app.repo}_${gh.number}`
    if (app.issues.some((i) => i.id === id)) continue
    if (botLogin && gh.user?.login?.toLowerCase() === botLogin) continue
    reports.push({ id, slug: app.slug, source: 'github', author: gh.user?.login, url: gh.html_url, text: `${gh.title}\n${gh.body ?? ''}`.trim() })
  }
  return reports
}

async function pollReportsReal(apps: App[]): Promise<Report[]> {
  const reports: Report[] = []
  for (const app of apps) {
    if (!app.repo) continue
    const now = Date.now()
    if (now - (lastPolled.get(app.repo) ?? 0) < GITHUB_POLL_MS) continue
    lastPolled.set(app.repo, now)
    let issues: GhIssue[]
    try {
      // Composio wraps GitHub's own array under `.issues` here (confirmed live, not guessed).
      issues = (await tool<{ issues?: GhIssue[] }>('GITHUB_LIST_REPOSITORY_ISSUES', { owner: owner(), repo: app.repo, state: 'open' })).issues ?? []
    } catch (e) {
      console.log(`[github] list issues on ${app.repo} failed: ${(e as Error).message}`)
      continue
    }
    reports.push(...mapGhIssuesToReports(app, issues))
  }
  return reports
}

export async function pollReports(apps: App[]): Promise<Report[]> {
  // With fake approvals (npm run demo) reports stay fake even if a Composio key is set, same rule
  // publish()/launch() already follow: nothing real gets listed/filed on a scripted YES.
  if (!composioEnabled() || approvalsAreFake()) return pollReportsFake(apps)
  return pollReportsReal(apps)
}

// ── resolveIssue ──

async function resolveIssueFake(app: App, issue: Issue, text: string): Promise<{ url?: string }> {
  console.log(`[${issue.source === 'github' ? 'github' : 'composio'}] reply on ${issue.id} (${app.slug}): "${text}" · closed (fake)`)
  await fakeDelay()
  return { url: issue.url ? `${issue.url}#issuecomment-${Date.now().toString().slice(-7)}` : undefined }
}

// Only a `gh_<repo>_<number>` id (pollReportsReal's own format) has a GitHub issue number to act on;
// a hand-filed `manual_<ts>` id, or any other shape, falls through to undefined and resolveIssueReal
// no-ops rather than guessing a number.
export const issueNumberFromId = (id: string): number | undefined => {
  const m = id.match(/^gh_.+_(\d+)$/)
  return m ? Number(m[1]) : undefined
}

// Unlike publish()/launch(), this catches its own errors: by the time this runs the change has
// already shipped, so a Composio hiccup here should log and move on, not throw away the ship.
async function resolveIssueReal(app: App, issue: Issue, text: string): Promise<{ url?: string }> {
  const number = issueNumberFromId(issue.id)
  if (!number) {
    console.log(`[github] ${issue.id} isn't a GitHub issue id, nothing to comment/close`)
    return {}
  }
  const repo = repoName(app)
  try {
    const comment = await tool<{ html_url?: string }>('GITHUB_CREATE_AN_ISSUE_COMMENT', { owner: owner(), repo, issue_number: number, body: text })
    await tool('GITHUB_UPDATE_AN_ISSUE', { owner: owner(), repo, issue_number: number, state: 'closed' })
    return { url: comment?.html_url }
  } catch (e) {
    console.log(`[github] couldn't comment/close ${issue.id} on ${repo}: ${(e as Error).message}`)
    return {}
  }
}

// Comments on the report and closes it, whether it shipped or was declined. Returns where the comment is.
export async function resolveIssue(app: App, issue: Issue, text: string): Promise<{ url?: string }> {
  if (!composioEnabled() || approvalsAreFake() || issue.source !== 'github') return resolveIssueFake(app, issue, text)
  return resolveIssueReal(app, issue, text)
}
