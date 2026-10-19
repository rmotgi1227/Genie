import './lib/env'
// Genie: two loops that run at the same time.
//   build loop:    discover → validate → approve → build+test → approve post → launch, then the next wish
//   maintain loop: watch every live app for reports → approve → change → re-test → ship v{n} → reply
// Both text the owner through one queue, so only one question is open at a time and a YES for a
// new wish can never be read as a YES for an issue. Every sponsor step lives in steps/*.ts.
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, normalize, extname } from 'node:path'
import type { App, Approval, ApprovalKind, Check, FeedLine, Issue, Report, Stage } from './lib/types'
import { state, save, reset, advance, sleep, uniqueAuthors, liveApps, mutex } from './lib/state'
import { discover, validate, triage, newApp } from './steps/discover'
import * as fake from './steps/discover.fake'
import { askApproval, approvalsAreFake, notify } from './steps/askApproval'
import { build, test, snapshotVersion } from './steps/build'
import { launch, publish, pollReports, resolveIssue } from './steps/launch'
import { fix, stampChangelog } from './steps/fix'
import { diffLines } from './lib/diff'
import { appFile } from './steps/build'
import { scrub, suspicious } from './lib/guard'
import { routeReply, HELP, HELP_POST, HELP_ISSUE, type Reply } from './lib/reply'
import { issuesUrl, repoUrl } from './lib/repo'

const args = new Set(process.argv.slice(2))
const PORT = Number(process.env.PORT ?? 3000)
const POLL_MS = Number(process.env.POLL_MS ?? 1000)
const DISCOVER_EVERY_MS = Number(process.env.DISCOVER_EVERY_MS ?? 10 * 60_000) // between wishes, and when nothing was found
const NO_COOLDOWN_MS = Number(process.env.NO_COOLDOWN_MS ?? 60_000) // after a NO, before the next wish is offered
const ONCE = args.has('--once') // demo: stop once one new app is live and one issue is answered

// Reports filed by hand (POST /report). Merged with pollReports() every tick.
const manualReports: Report[] = []
// Last time each source was checked. Served with /state so the board can show "always on"; not written to disk.
const watch: { reddit?: number; github?: number } = {}
let launchedThisRun = 0
let resolvedThisRun = 0

// ── The one way to text the owner. Serialized: a question about an issue waits for the open one. ──
const askOne = mutex()
type Asked = { r: Exclude<Reply, 'unknown'>; reply: string }
function ask(app: App, kind: ApprovalKind, text: string, help: string, opts: { image?: string; issueId?: string; accept?: Reply[] } = {}): Promise<Asked> {
  const accept = opts.accept ?? ['yes', 'no', 'different', 'idea']
  return askOne(async () => {
    state.pendingApproval = { slug: app.slug, kind, issueId: opts.issueId }
    save()
    let prompt = text
    let image = opts.image
    // Asks until the reply means something. The help line is itself the next question.
    while (true) {
      const approval: Approval = { kind, issueId: opts.issueId, text: prompt, image, askedAt: Date.now() }
      ;(app.approvals ??= []).push(approval)
      save()
      const reply = await askApproval(prompt, image)
      Object.assign(approval, { reply, repliedAt: Date.now() })
      save()
      const r = routeReply(reply)
      if (r !== 'unknown' && accept.includes(r)) {
        delete state.pendingApproval
        save()
        return { r, reply }
      }
      prompt = help
      image = undefined
    }
  })
}

// ═══════════════════════════════ build loop ═══════════════════════════════

// Wishes the owner said NO/DIFFERENT to, or that already have an app. Never offered again this run.
const declined = new Set<string>()
const taken = (slug: string) => declined.has(slug) || state.apps.some((b) => b.slug === slug)

async function freshQueue(): Promise<App[]> {
  watch.reddit = Date.now()
  delete state.nextDiscoveryAt
  let found: App[]
  try {
    found = (await discover()).filter((a) => !taken(a.slug))
  } catch (e) {
    console.log(`[genie] discovery failed, trying again next sweep: ${(e as Error).message}`)
    return []
  }
  const now = Date.now()
  for (const a of found) { a.stageAt = { found: now, ...a.stageAt }; if (state.discovery) a.found = { startedAt: state.discovery.startedAt, endedAt: state.discovery.endedAt } }
  state.candidates = found
  save()
  for (const a of found) advance(a.slug, 'validating')
  const ranked = await validate(found).catch((e) => { console.log(`[genie] validation failed: ${(e as Error).message}`); return [] as App[] }) // mutates the apps in place; wishes that already exist stay in candidates as 'exists'
  save()
  return ranked.filter((a) => !taken(a.slug)) // queue is a copy; shifting it must not drop wishes from state
}

// Step 3: first approval. Returns the wish to build, or null after a NO.
async function approveBuild(initial: App[] = []): Promise<App | null> {
  let queue = initial
  let refreshed = initial.length > 0
  while (true) {
    const next = queue.shift()
    if (!next) {
      if (refreshed) {
        console.log(`[genie] nothing new to offer, looking again in ${DISCOVER_EVERY_MS / 60_000} min`)
        state.nextDiscoveryAt = Date.now() + DISCOVER_EVERY_MS
        save()
        await sleep(DISCOVER_EVERY_MS)
      }
      queue = await freshQueue()
      refreshed = true
      continue
    }
    state.builder = { slug: next.slug }
    advance(next.slug, 'awaiting_approval')
    const n = uniqueAuthors(next.askers)
    const { r, reply } = await ask(next, 'build', `${n} ${n === 1 ? 'person wants' : 'people want'} ${next.spec}. ${next.why ?? ''} ${next.wish.url ? `The wish: ${next.wish.url} ` : ''}${HELP}.`.replace(/\s+/g, ' '), HELP)
    if (r !== 'yes') declined.add(next.slug)
    switch (r) {
      case 'yes':
        state.candidates = state.candidates.filter((a) => a !== next)
        state.apps.push(next)
        save()
        return next
      case 'no':
        advance(next.slug, 'rejected')
        return null
      case 'different':
        advance(next.slug, 'rejected')
        break
      case 'idea': {
        advance(next.slug, 'rejected')
        const mine = newApp(reply.trim(), 'owner', 'imessage', '')
        if (taken(mine.slug)) break
        state.candidates.unshift(mine)
        const [validated] = await validate([mine])
        if (validated) queue.unshift(validated)
        else console.log(`[genie] the owner's idea already exists or failed validation, moving on`)
        break
      }
    }
  }
}

// Steps 4–6: build, test, screenshot approval, launch. Returns false if nothing went public.
const WRITING = { label: 'Writing the app', ok: true }
async function buildAndLaunch(app: App, resumeFrom?: Stage): Promise<boolean> {
  let t: Awaited<ReturnType<typeof test>>
  if (resumeFrom === 'awaiting_post_approval' && app.screenshot) {
    t = { ok: true, screenshot: app.screenshot, checks: app.checks }
  } else {
    advance(app.slug, 'building', { checks: [], build: { startedAt: Date.now(), feed: [] } })
    await build(app, (line) => { app.build!.feed.push(line); save() })
    app.build!.endedAt = Date.now()
    advance(app.slug, 'testing', { url: `/apps/${app.slug}/`, version: 1, checks: [{ ...WRITING, at: Date.now() }], test: { startedAt: Date.now() } })
    const live = (c: Check) => { app.checks!.push(c); save() }
    t = await test(app, live)
    if (!t.ok) {
      app.build!.feed.push({ t: Date.now(), text: `Test failed: ${t.error}. Fixing it`, file: 'index.html' })
      await fix(app, { text: t.error ?? 'test failed', kind: 'bug' }, (line) => { app.build!.feed.push(line); save() }) // one retry, error goes back to Cline
      app.checks = [WRITING]
      t = await test(app, live)
    }
    app.checks = [WRITING, ...(t.checks ?? [])]
    app.test!.endedAt = Date.now()
    save()
    if (!t.ok) {
      advance(app.slug, 'failed')
      return false
    }
  }

  // Step 5: second approval, with the screenshot.
  while (true) {
    advance(app.slug, 'awaiting_post_approval', { screenshot: t.screenshot })
    const { r, reply } = await ask(app, 'post', `Here's ${app.spec}. Reply to u/${app.wish.author} on Reddit with the link? ${HELP_POST}.`, HELP_POST, { image: t.screenshot })
    if (r === 'yes') break
    if (r === 'no' || r === 'different') {
      advance(app.slug, 'shelved')
      return false
    }
    // r === 'idea': a change request
    advance(app.slug, 'building', { checks: [], build: { startedAt: Date.now(), feed: [] } })
    await fix(app, { text: reply, kind: 'feature' }, (line) => { app.build!.feed.push(line); save() })
    app.build!.endedAt = Date.now()
    advance(app.slug, 'testing', { checks: [{ ...WRITING, at: Date.now() }], test: { startedAt: Date.now() } })
    t = await test(app, (c) => { app.checks!.push(c); save() })
    app.test!.endedAt = Date.now()
    if (!t.ok) {
      advance(app.slug, 'failed')
      return false
    }
    app.checks = [WRITING, ...(t.checks ?? [])]
    save()
  }

  app.launch = { startedAt: Date.now() }
  save()
  const posted = await launch(app)
  app.version ||= 1
  app.launch.endedAt = Date.now()
  advance(app.slug, 'launched', posted)
  // The heads-up after launch: the live link for a web tool, the open-source repo first for everything else.
  const web = !app.kind || app.kind === 'web_page'
  const links = web ? [`Live: ${app.pagesUrl}`, `Code (MIT): ${repoUrl(app)}`] : [`Open source (MIT): ${repoUrl(app)}`, `Page: ${app.pagesUrl}`]
  await notify([`Done ✅ ${app.spec ?? app.slug}`, ...links, app.launchUrl ? `Replied to u/${app.wish.author}: ${app.launchUrl}` : ''].filter(Boolean).join('\n'))
  snapshotVersion(app) // v1.png, the "before" for the first upgrade
  advance(app.slug, 'maintaining')
  return true
}

// Picks up where a crash left off: a wish waiting for a YES is offered again, a half-built app is
// rebuilt, an app waiting for the post YES is asked again.
function resumePoint(): { app: App; from: Stage } | undefined {
  const app = state.builder && [...state.apps, ...state.candidates].find((a) => a.slug === state.builder?.slug)
  if (!app) return undefined
  if (['awaiting_approval', 'building', 'testing', 'awaiting_post_approval'].includes(app.stage)) return { app, from: app.stage }
  return undefined
}

async function buildLoop() {
  const resume = resumePoint()
  if (resume) console.log(`[genie] resuming ${resume.app.slug} from ${resume.from}`)
  let first = true
  while (true) {
    let app: App | null
    let from: Stage | undefined
    if (first && resume && resume.from !== 'awaiting_approval') {
      app = resume.app
      from = resume.from
    } else {
      app = await approveBuild(first && resume ? [resume.app] : [])
    }
    first = false
    if (!app) {
      console.log(`[genie] owner said no, next wish in ${NO_COOLDOWN_MS / 1000}s`)
      await sleep(NO_COOLDOWN_MS)
      continue
    }
    state.builder = { slug: app.slug }
    save()
    try {
      if (await buildAndLaunch(app, from)) launchedThisRun++
    } catch (e) {
      console.log(`[genie] ${app.slug} failed: ${(e as Error).message}`) // one app fails, the loop keeps going
      advance(app.slug, 'failed')
    }
    if (ONCE) return
    state.nextDiscoveryAt = Date.now() + DISCOVER_EVERY_MS
    save()
    await sleep(DISCOVER_EVERY_MS)
  }
}

// ═══════════════════════════════ maintain loop ═══════════════════════════════

async function handleIssue(app: App, issue: Issue) {
  const name = app.spec ?? app.wish.text
  issue.status = 'awaiting_approval'
  issue.askedAt = Date.now()
  save()
  const q = issue.kind === 'bug' ? `Someone reported "${issue.text}" on ${name}. Fix it? ${HELP_ISSUE}.` : `Someone asked for "${issue.text}" on ${name}. Add it? ${HELP_ISSUE}.`
  const { r } = await ask(app, 'issue', q, HELP_ISSUE, { issueId: issue.id, accept: ['yes', 'no'] })
  issue.repliedAt = Date.now()
  if (r === 'no') {
    const text = `Thanks for the ${issue.kind === 'bug' ? 'report' : 'suggestion'}! Not planned right now.`
    const { url } = await resolveIssue(app, issue, text)
    Object.assign(issue, { status: 'declined', reply: { text, url, at: Date.now() }, closedAt: Date.now(), resolvedAt: Date.now() })
    save()
    resolvedThisRun++
    return
  }

  issue.before = snapshotVersion(app) ?? app.screenshot
  issue.status = 'fixing'
  issue.change = { startedAt: Date.now(), feed: [] }
  save()
  const feed = (line: FeedLine) => { issue.change!.feed.push(line); save() }
  const before = readFileSync(appFile(app), 'utf8')
  await fix(app, issue, feed)
  issue.change.endedAt = Date.now()
  issue.diff = { file: 'index.html', ...diffLines(before, readFileSync(appFile(app), 'utf8')) } // what actually changed, for the board
  save()
  const next = app.version + 1
  const entry = stampChangelog(app, issue, next)
  issue.status = 'testing'
  issue.test = { startedAt: Date.now(), checks: [] }
  save()
  const live = (c: Check) => { issue.test!.checks.push(c); save() }
  let t = await test(app, live)
  if (!t.ok) {
    feed({ t: Date.now(), text: `Test failed: ${t.error}. Fixing it`, file: 'index.html' })
    await fix(app, { text: t.error ?? 'test failed', kind: 'bug' }, feed) // one retry, error goes back to Cline
    issue.test.checks = []
    t = await test(app, live)
  }
  issue.test.endedAt = Date.now()
  if (!t.ok) {
    console.log(`[genie] change for ${issue.id} failed the test (${t.error}), leaving it`)
    Object.assign(issue, { status: 'ignored', resolvedAt: Date.now() })
    save()
    return
  }
  app.version = next
  ;(app.changelog ??= []).push(entry)
  issue.status = 'shipping'
  issue.publish = { startedAt: Date.now() }
  save()
  app.pagesUrl = await publish(app)
  issue.publish.endedAt = Date.now()
  app.screenshot = t.screenshot
  issue.after = snapshotVersion(app)
  Object.assign(issue, { status: 'fixed', fixedAt: Date.now(), version: app.version })
  advance(app.slug, 'maintaining', { screenshot: t.screenshot })
  const text = `Done ✅ v${app.version}: ${issue.kind === 'bug' ? 'fixed' : 'added'} ${issue.title}. ${app.pagesUrl}`
  const { url } = await resolveIssue(app, issue, text)
  Object.assign(issue, { reply: { text, url, at: Date.now() }, closedAt: Date.now(), resolvedAt: Date.now() })
  save()
  resolvedThisRun++
}

async function maintainLoop() {
  while (true) {
    const apps = liveApps()
    const polled = apps.length ? await pollReports(apps).catch((e) => { console.log(`[genie] polling failed: ${(e as Error).message}`); return [] }) : []
    const reports = [...polled, ...manualReports.splice(0)]
    watch.github = watch.reddit = Date.now() // issues and launch-post comments are polled together
    for (const rep of reports) {
      const app = state.apps.find((a) => a.slug === rep.slug) ?? apps[0]
      if (!app || app.issues.some((i) => i.id === rep.id)) continue
      const base = { id: rep.id, source: rep.source, author: rep.author, url: rep.url, reportedAt: Date.now() }
      if (suspicious(rep.text)) {
        console.log(`[genie] report ${rep.id} looks like an instruction, ignoring it`)
        const text = scrub(rep.text, 200) || '(removed)'
        app.issues.push({ ...base, kind: 'feature', text, title: text, status: 'ignored', resolvedAt: Date.now() })
        save()
        continue
      }
      const { kind, summary, title } = await triage(scrub(rep.text, 500))
      const issue: Issue = { ...base, kind: kind === 'noise' ? 'feature' : kind, text: summary, title, status: 'triaged' }
      app.issues.push(issue)
      save()
      if (kind === 'noise') {
        Object.assign(issue, { status: 'ignored', resolvedAt: Date.now() })
        save()
        continue
      }
      try {
        await handleIssue(app, issue)
      } catch (e) {
        console.log(`[genie] ${issue.id} on ${app.slug} failed: ${(e as Error).message}`) // the live app stays on its last good version
        Object.assign(issue, { status: 'ignored', resolvedAt: Date.now() })
        save()
      }
    }
    if (ONCE && launchedThisRun > 0 && resolvedThisRun > 0) {
      console.log('[genie] --once: a new app is live and an issue is answered, done')
      process.exit(0)
    }
    await sleep(POLL_MS)
  }
}

// ═══════════════════════════════ fake library ═══════════════════════════════

// With fake approvals, --reset also plants two apps "built yesterday" so the maintain loop has
// something to look after. --seed does the same with a real phone, for rehearsing issue approvals.
async function seedLibrary() {
  const yesterday = Date.now() - 86_400_000
  const wishes = (await fake.discover()).filter((_, i) => i === 0 || i === 2) // bill splitter, parking meter
  const ranked = await fake.validate(wishes)
  let t0 = yesterday
  for (const app of ranked) {
    const at: Partial<Record<Stage, number>> = {}
    for (const st of ['found', 'validating', 'awaiting_approval', 'building', 'testing', 'awaiting_post_approval', 'launched', 'maintaining'] as Stage[]) at[st] = t0 += 40_000
    app.seeded = true
    app.stageAt = at
    app.validation = { startedAt: at.validating!, endedAt: at.validating! + 14_000, queries: [], searches: [], checked: [] }
    app.build = { startedAt: at.building!, endedAt: at.building! + 48_000, feed: [] }
    app.test = { startedAt: at.testing!, endedAt: at.testing! + 4_000 }
    app.launch = { startedAt: at.awaiting_post_approval! + 12_000, endedAt: at.launched! }
    app.approvals = [
      { kind: 'build', text: `${uniqueAuthors(app.askers)} people want ${app.spec}. ${app.why} ${HELP}.`, askedAt: at.awaiting_approval!, reply: 'yes', repliedAt: at.awaiting_approval! + 9_000 },
      { kind: 'post', text: `Here's ${app.spec}. Reply to u/${app.wish.author} on Reddit with the link? ${HELP_POST}.`, askedAt: at.awaiting_post_approval!, reply: 'yes', repliedAt: at.awaiting_post_approval! + 12_000 },
    ]
    state.apps.push(app)
    await build(app)
    app.url = `/apps/${app.slug}/`
    app.version = 1
    const t = await test(app)
    app.checks = [WRITING, ...(t.checks ?? [])]
    app.screenshot = t.screenshot
    // Sample apps never touch Vercel or Reddit, even when real keys are set: they're local and marked as samples.
    const sub = app.wish.url.match(/reddit\.com\/r\/([^/]+)/i)?.[1]
    Object.assign(app, { pagesUrl: `http://localhost:${PORT}/apps/${app.slug}/`, launchPostId: `sample_${app.slug.slice(0, 8)}`, launchTitle: `Replied to u/${app.wish.author}${sub ? ` on r/${sub}` : ''}`, launchUrl: app.wish.url })
    app.stage = 'maintaining'
    snapshotVersion(app)
    save()
    t0 += 3_600_000
  }
  state.candidates = []
  save()
  console.log(`[genie] library seeded with ${ranked.map((a) => a.slug).join(', ')}`)
}

// ═══════════════════════════════ server ═══════════════════════════════
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' }

function serveFile(res: import('node:http').ServerResponse, root: string, rel: string) {
  const path = normalize(join(root, rel))
  if (!path.startsWith(normalize(root) + '/') && path !== normalize(root)) return res.writeHead(403).end()
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path
  if (!existsSync(file)) return res.writeHead(404).end('not found')
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
  res.end(readFileSync(file))
}

function startServer() {
  createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (req.method === 'GET' && url.pathname === '/state') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      return res.end(JSON.stringify({ ...state, watch }))
    }
    // File a report by hand: POST /report?slug=<app> with the text as the body, or a JSON {slug, text, author}.
    if (req.method === 'POST' && url.pathname === '/report') {
      let body = ''
      req.on('data', (c) => { if (body.length < 10_000) body += c })
      req.on('end', () => {
        let slug = url.searchParams.get('slug') ?? '', text = body.trim(), author = url.searchParams.get('author') ?? 'someone'
        try { const j = JSON.parse(body); slug = j.slug ?? slug; text = j.text ?? text; author = j.author ?? author } catch {}
        if (!slug) slug = [...liveApps()].sort((a, b) => (a.stageAt?.launched ?? 0) - (b.stageAt?.launched ?? 0))[0]?.slug ?? ''
        const id = `manual_${Date.now()}`
        const app = state.apps.find((a) => a.slug === slug)
        manualReports.push({ id, slug, source: 'github', text, author, url: app ? issuesUrl(app) : undefined })
        res.writeHead(202).end(`ok ${slug}`)
      })
      return
    }
    if (url.pathname.startsWith('/apps/')) return serveFile(res, 'apps', decodeURIComponent(url.pathname.slice(6)))
    if (url.pathname === '/') return serveFile(res, 'board', 'index.html')
    res.writeHead(404).end('not found')
  }).listen(PORT, () => console.log(`[genie] board on http://localhost:${PORT}`))
}

async function main() {
  if (args.has('--reset')) reset()
  watch.reddit = watch.github = Date.now() // on from the first second, seeding included
  const beat = setInterval(() => { if (!liveApps().length) watch.reddit = watch.github = Date.now() }, 2000) // until the loops take over
  startServer()
  if (args.has('--seed') || (args.has('--reset') && approvalsAreFake())) await seedLibrary()
  clearInterval(beat)
  await Promise.all([buildLoop(), maintainLoop()])
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
