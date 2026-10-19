import './lib/env'
// Genie: the main loop. discover → validate → approve → build+test → approve post → launch → maintain.
// Every sponsor step lives in steps/*.ts. Swap a fake for the real one by replacing that file's body;
// the function names and types stay the same.
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, normalize, extname } from 'node:path'
import type { App, Approval, Report } from './lib/types'
import { state, save, reset, advance, sleep, uniqueAuthors } from './lib/state'
import { discover, validate, triage, newApp } from './steps/discover'
import { askApproval } from './steps/askApproval'
import { build, test } from './steps/build'
import { launch, publish, pollReports, replyFixed } from './steps/launch'
import { fix } from './steps/fix'
import { scrub, suspicious } from './lib/guard'

const args = new Set(process.argv.slice(2))
const PORT = Number(process.env.PORT ?? 3000)
const POLL_MS = Number(process.env.POLL_MS ?? 1000)

// Reports filed by hand (POST /report). Merged with pollReports() every tick.
const manualReports: Report[] = []

// ── Approval switch. Deterministic, no model reads the reply. ──
type Reply = 'yes' | 'no' | 'different' | 'idea' | 'unknown'
export function routeReply(text: string): Reply {
  const r = text.trim().toLowerCase()
  if (/^(y|yes|yep|build|go|post|👍)$/u.test(r)) return 'yes'
  if (/^(n|no|nope|skip|👎)$/u.test(r)) return 'no'
  if (/^(d|different|another|next|other)$/.test(r)) return 'different'
  if (r.length >= 8) return 'idea'
  return 'unknown'
}
const HELP = 'Reply YES, NO, DIFFERENT, or text me your own idea'
const HELP_POST = 'Reply YES, NO, or tell me what to change'

// Asks until the reply means something. The help line is itself the next question,
// so it never swallows the owner's answer.
async function ask(app: App, text: string, help: string, image?: string): Promise<{ r: Exclude<Reply, 'unknown'>; reply: string }> {
  let prompt = text
  while (true) {
    const approval: Approval = { kind: state.pendingApproval?.kind ?? 'build', text: prompt, image, askedAt: Date.now() }
    ;(app.approvals ??= []).push(approval)
    save()
    const reply = await askApproval(prompt, image)
    Object.assign(approval, { reply, repliedAt: Date.now() })
    save()
    const r = routeReply(reply)
    if (r !== 'unknown') return { r, reply }
    prompt = help
    image = undefined
  }
}

// Wishes the owner said NO/DIFFERENT to, or that already have an app. Never offered again this run.
const declined = new Set<string>()

async function freshQueue(): Promise<App[]> {
  const found = await discover()
  const now = Date.now()
  for (const a of found) a.stageAt = { found: now, ...a.stageAt }
  state.candidates = found
  save()
  for (const a of found) advance(a.slug, 'validating')
  const ranked = await validate(found) // mutates the apps in place; wishes that already exist stay in candidates as 'exists'
  save()
  return ranked.filter((a) => !declined.has(a.slug) && !state.apps.some((b) => b.slug === a.slug)) // queue is a copy; shifting it must not drop wishes from state
}

// Step 3: first approval. Returns the wish to build, or null to wait for the next discovery cycle.
async function approveBuild(): Promise<App | null> {
  let queue = await freshQueue()
  while (true) {
    const next = queue.shift()
    if (!next) queue = await freshQueue()
    if (!next) continue
    state.pendingApproval = { slug: next.slug, kind: 'build' }
    advance(next.slug, 'awaiting_approval')
    const n = uniqueAuthors(next.askers)
    const { r, reply } = await ask(next, `${n} people want ${next.spec}. ${next.why} ${HELP}.`, HELP)
    if (r !== 'yes') declined.add(next.slug)
    switch (r) {
      case 'yes':
        delete state.pendingApproval
        state.candidates = state.candidates.filter((a) => a !== next)
        state.apps.push(next)
        save()
        return next
      case 'no':
        delete state.pendingApproval
        advance(next.slug, 'rejected')
        return null
      case 'different':
        advance(next.slug, 'rejected')
        break
      case 'idea': {
        advance(next.slug, 'rejected')
        const mine = newApp(reply.trim(), 'owner', 'imessage', '')
        state.candidates.unshift(mine)
        const [validated] = await validate([mine])
        queue.unshift(validated)
        break
      }
    }
  }
}

// Steps 4–6: build, test, screenshot approval, launch. Returns false if nothing went public.
async function buildAndLaunch(app: App): Promise<boolean> {
  advance(app.slug, 'building')
  await build(app)
  const WRITING = { label: 'Writing the app', ok: true }
  advance(app.slug, 'testing', { url: `/apps/${app.slug}/`, version: 1, checks: [WRITING] })
  let t = await test(app)
  if (!t.ok) {
    await fix(app, { text: t.error ?? 'test failed' }) // one retry, error goes back to Cline
    t = await test(app)
  }
  app.checks = [WRITING, ...(t.checks ?? [])]
  save()
  if (!t.ok) {
    advance(app.slug, 'failed')
    return false
  }

  // Step 5: second approval, with the screenshot.
  while (true) {
    state.pendingApproval = { slug: app.slug, kind: 'post' }
    advance(app.slug, 'awaiting_post_approval', { screenshot: t.screenshot })
    const { r, reply } = await ask(app, `Here's ${app.spec}. Post it to r/GenieGrants? ${HELP_POST}.`, HELP_POST, t.screenshot)
    if (r === 'yes') break
    if (r === 'no' || r === 'different') {
      delete state.pendingApproval
      advance(app.slug, 'shelved')
      return false
    }
    // r === 'idea': a change request
    advance(app.slug, 'building', { checks: [] })
    await fix(app, { text: reply })
    advance(app.slug, 'testing', { checks: [WRITING] })
    t = await test(app)
    if (!t.ok) {
      advance(app.slug, 'failed')
      return false
    }
    app.checks = [WRITING, ...(t.checks ?? [])]
    save()
  }
  delete state.pendingApproval

  const posted = await launch(app)
  advance(app.slug, 'launched', posted)
  return true
}

// Step 7: forever. Poll reports, triage, fix, re-test, push, reply.
async function maintain(app: App) {
  advance(app.slug, 'maintaining')
  while (true) {
    const reports = [...(await pollReports(app)), ...manualReports.splice(0)]
    for (const rep of reports) {
      if (app.issues.some((i) => i.id === rep.id)) continue
      if (suspicious(rep.text)) {
        console.log(`[genie] report ${rep.id} looks like an instruction, ignoring it`)
        app.issues.push({ id: rep.id, source: rep.source, text: scrub(rep.text, 200) || '(removed)', status: 'ignored', reportedAt: Date.now() })
        save()
        continue
      }
      const { kind, summary } = await triage(scrub(rep.text, 500))
      const issue = { id: rep.id, source: rep.source, text: summary, status: 'triaged' as const, reportedAt: Date.now() }
      app.issues.push(issue)
      save()
      if (kind === 'noise') {
        Object.assign(issue, { status: 'ignored' })
        save()
        continue
      }
      Object.assign(issue, { status: 'fixing' })
      save()
      await fix(app, issue)
      const t = await test(app)
      if (!t.ok) {
        console.log(`[genie] fix for ${issue.id} failed the test, leaving it`)
        Object.assign(issue, { status: 'triaged' })
        save()
        continue
      }
      app.version++
      await publish(app)
      Object.assign(issue, { status: 'fixed', fixedAt: Date.now(), version: app.version })
      advance(app.slug, 'maintaining', { screenshot: t.screenshot })
      await replyFixed(app, issue)
    }
    if (args.has('--once') && app.issues.some((i) => i.status === 'fixed')) {
      console.log('[genie] --once: first fix shipped, done')
      process.exit(0)
    }
    await sleep(POLL_MS)
  }
}

// ── Server: board, /state, the built apps, manual reports. ──
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' }

function serveFile(res: import('node:http').ServerResponse, root: string, rel: string) {
  const path = normalize(join(root, rel))
  if (!path.startsWith(normalize(root))) return res.writeHead(403).end()
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
      return res.end(JSON.stringify(state))
    }
    if (req.method === 'POST' && url.pathname === '/report') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        manualReports.push({ id: `manual_${Date.now()}`, source: 'github', text: body.trim() })
        res.writeHead(202).end('ok')
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
  startServer()
  // Resume: an app already live goes straight back to looking after it.
  const live = state.apps.find((a) => a.stage === 'launched' || a.stage === 'maintaining')
  if (live) return maintain(live)
  while (true) {
    const app = await approveBuild()
    if (!app) {
      await sleep(POLL_MS * 5) // NO → wait for the next discovery cycle
      continue
    }
    if (await buildAndLaunch(app)) return maintain(app)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
