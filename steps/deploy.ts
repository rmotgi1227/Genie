// VERCEL — deploy apps/<slug>/index.html as its own Vercel project. FAKE for now.
// REAL: `vercel deploy .deploy/<slug> --prod --yes --token $VERCEL_TOKEN [--scope $VERCEL_SCOPE]`; the kept `.vercel` link folder makes v2+ update the same project.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import type { App } from '../lib/types'
import { appFile } from './build'
import { fakeDelay, sleep } from '../lib/state'
import { approvalsAreFake } from './askApproval'

const execFileAsync = promisify(execFile)

const PORT = Number(process.env.PORT ?? 3000)
const TOKEN = process.env.VERCEL_TOKEN
const SCOPE = process.env.VERCEL_SCOPE
const DEPLOY_ROOT = '.deploy'
const PROTECTION_WAIT_MS = 60_000
// `vercel deploy` is ~5-15s for a static index.html (see build-plan.md); 2 min is generous headroom.
// Without a cap a wedged CLI (bad token, network stall, an interactive prompt it's waiting on)
// would hang this forever and block the rest of Genie's loop behind it.
const DEPLOY_TIMEOUT_MS = 120_000
const DEPLOY_MAX_BUFFER = 10 * 1024 * 1024

export async function deploy(app: App): Promise<string> {
  // Nothing goes public on a scripted YES: with fake approvals (npm run demo) the deploy stays local even if a token is set.
  if (!TOKEN || approvalsAreFake()) {
    console.log(`[vercel] deploy ${app.slug} (fake)`)
    await fakeDelay()
    return `http://localhost:${PORT}/apps/${app.slug}/`
  }
  return deployReal(app)
}

async function deployReal(app: App): Promise<string> {
  const dir = join(DEPLOY_ROOT, app.slug)
  const firstDeploy = !existsSync(join(dir, '.vercel'))
  mkdirSync(dir, { recursive: true })
  copyFileSync(appFile(app), join(dir, 'index.html'))

  const args = ['deploy', dir, '--prod', '--yes', '--token', TOKEN!]
  if (SCOPE) args.push('--scope', SCOPE)
  const stdout = await runVercel(args)
  const deployUrl = parseDeployUrl(stdout)
  console.log(`[vercel] deployed ${app.slug} → ${deployUrl}`)

  // Lets the CLI failure throw (the caller wraps publish()/deploy() in a try/catch); just make
  // sure the message carries enough of the CLI's own stderr to act on, instead of only exit code.
  if (firstDeploy) {
    try {
      await disableDeploymentProtection(app.slug)
    } catch (e) {
      console.log(`[vercel] couldn't turn off deployment protection for ${app.slug}, leaving it for a human: ${(e as Error).message}`)
    }
  }

  const alias = await resolveAlias(app.slug, deployUrl)
  await waitFor200(alias, PROTECTION_WAIT_MS)
  return alias
}

// Runs `vercel` and, on a non-zero exit, rethrows with the last ~10 lines of stderr folded into
// the message — execFile's own error only has the exit code, which isn't enough to act on.
async function runVercel(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('vercel', args, {
      env: process.env,
      timeout: DEPLOY_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: DEPLOY_MAX_BUFFER,
    })
    return stdout
  } catch (e) {
    const stderr = typeof (e as any).stderr === 'string' ? (e as any).stderr : ''
    const tail = stderr.trim().split('\n').slice(-10).join('\n')
    throw new Error(`vercel ${args.join(' ')} failed: ${(e as Error).message}${tail ? `\n${tail}` : ''}`)
  }
}

// `vercel deploy` prints an inspect link (vercel.com/<scope>/...) then the deployment URL, each
// possibly trailed by "[copied to clipboard]" or a timer like "[4s]". Pull every URL out and take
// the last one that isn't the vercel.com dashboard link.
export function parseDeployUrl(stdout: string): string {
  const urls = [...stdout.matchAll(/https?:\/\/\S+/g)].map((m) => m[0].replace(/[.,]*$/, ''))
  const deployUrl = urls.filter((u) => !u.includes('vercel.com/')).pop()
  if (!deployUrl) throw new Error(`vercel deploy: no deployment URL in stdout: ${stdout}`)
  return deployUrl
}

// The stable production alias, not the hashed per-deploy URL. REST API over `vercel inspect`
// because it's one JSON call we can test against canned output (see spikes/deploy.check.ts).
async function resolveAlias(slug: string, deployUrl: string): Promise<string> {
  try {
    // GET /v9/projects/{idOrName}/domains, confirmed against
    // https://vercel.com/docs/rest-api/projects/retrieve-project-domains-by-project-by-id-or-name:
    // response is `{ domains: [{ name, apexName, redirect, gitBranch, verified, ... }] }`.
    const body = await vercelApi(`/v9/projects/${slug}/domains`)
    const alias = pickAlias(body.domains ?? [])
    if (alias) return `https://${alias}`
  } catch (e) {
    console.log(`[vercel] domains lookup failed for ${slug}, using deploy URL: ${(e as Error).message}`)
  }
  return deployUrl
}

type VercelDomain = { name: string; redirect?: string | null; gitBranch?: string | null }

// Prefer the plain production `<slug>.vercel.app` alias with no redirect and no git-branch scope
// (a `gitBranch` domain is a preview alias for one branch; a non-null `redirect` means this name
// just forwards elsewhere, not the page itself). A custom domain, if one's attached, would often
// be shorter than `<slug>.vercel.app`, so sorting by length alone (the earlier approach) could
// pick a redirect or a branch alias instead of the real production link. If nothing is live,
// return undefined so the caller falls back to the hashed deploy URL instead of a redirect.
export function pickAlias(domains: VercelDomain[]): string | undefined {
  const live = domains.filter((d) => !d.redirect && !d.gitBranch)
  const prod = live.filter((d) => d.name.endsWith('.vercel.app'))
  const pool = prod.length ? prod : live
  return [...pool].sort((a, b) => a.name.length - b.name.length)[0]?.name
}

// Confirmed against https://vercel.com/docs/rest-api/projects/update-an-existing-project:
// `ssoProtection` is a nullable object and `null` clears it (it governs both Preview and, per
// `deploymentType: "all"`, Production access — not just Preview despite the field's name).
async function disableDeploymentProtection(slug: string) {
  console.log(`[vercel] turning off deployment protection for ${slug}`)
  await vercelApi(`/v9/projects/${slug}`, { method: 'PATCH', body: JSON.stringify({ ssoProtection: null }) })
}

// Team-scoped REST calls take `teamId` (the `team_...` id) OR `slug` (the team's URL slug) as
// separate query params (confirmed on the same update-project docs page). VERCEL_SCOPE is
// documented in build-plan.md as "team slug", so it belongs in `slug=`, not `teamId=`.
async function vercelApi(path: string, init: RequestInit = {}) {
  const qs = SCOPE ? `?slug=${encodeURIComponent(SCOPE)}` : ''
  const res = await fetch(`https://api.vercel.com${path}${qs}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`vercel api ${path}: ${res.status} ${await res.text()}`)
  return res.status === 204 ? {} : res.json()
}

async function waitFor200(url: string, capMs: number) {
  const start = Date.now()
  let lastStatus: number | undefined
  while (Date.now() - start < capMs) {
    try {
      const res = await fetch(url)
      lastStatus = res.status
      if (res.status === 200) return
    } catch {
      // not up yet, keep polling
    }
    await sleep(2000)
  }
  const hint =
    lastStatus === 401 || lastStatus === 403
      ? ` — got ${lastStatus}, Deployment Protection is probably still on; turn it off for this project in the Vercel dashboard`
      : ''
  console.log(`[vercel] ${url} wasn't 200 after ${capMs}ms, returning it anyway${hint}`)
}
