// One public repo per granted wish: github.com/<owner>/<slug>, MIT licensed, issues on.
// Owner is normally GITHUB_ORG, but falls back to the Composio-connected account's own login if
// that account can't create repos in that org (not a member, or the org doesn't exist) — resolved
// once, cached, and kicked off as soon as this module loads (composioEnabled() only) so it's
// usually settled well before the first publish(): discovery + validation + build all take far
// longer than the one API call this needs. steps/launch.ts's createRepo() also awaits it directly,
// so the real repo-create call is never racing this eager kick-off.
import type { App } from './types'
import { tool, composioEnabled } from './composio'

export const configuredOrg = () => process.env.GITHUB_ORG ?? 'genie-wishes' // read per call, so an org saved from the setup screen works without a restart

let cachedOwner: string | undefined
let resolving: Promise<string> | undefined

async function authenticatedLogin(): Promise<string> {
  const user = await tool<{ login?: string }>('GITHUB_GET_THE_AUTHENTICATED_USER', {})
  if (!user?.login) throw new Error('GITHUB_GET_THE_AUTHENTICATED_USER returned no login')
  return user.login
}

// GitHub lets anyone GET a public org's info, so that alone doesn't prove this account can create
// repos in it — only membership does.
async function canCreateInOrg(target: string): Promise<boolean> {
  const r = await tool<{ organizations?: { login?: string }[] }>('GITHUB_LIST_ORGANIZATIONS_FOR_THE_AUTHENTICATED_USER', {})
  return !!r.organizations?.some((o) => o.login?.toLowerCase() === target.toLowerCase())
}

// Resolves and caches the real owner once per process. Concurrent callers share the one in-flight
// resolution instead of firing duplicate Composio calls.
export async function resolveOwner(): Promise<string> {
  if (cachedOwner) return cachedOwner
  resolving ??= (async () => {
    const configured = configuredOrg()
    try {
      if (await canCreateInOrg(configured)) return configured
      console.log(`[github] connected account isn't a member of ${configured}, creating repos under its own account instead`)
    } catch (e) {
      console.log(`[github] couldn't confirm access to ${configured} (${(e as Error).message}), creating repos under the connected account instead`)
    }
    return authenticatedLogin()
  })()
  cachedOwner = await resolving
  return cachedOwner
}

if (composioEnabled()) {
  resolveOwner().catch((e) => console.log(`[github] owner resolution failed, repo links may be wrong until a real call retries it: ${(e as Error).message}`))
}

export const owner = () => cachedOwner ?? configuredOrg()
export const org = owner // kept: existing imports (steps/launch.ts) read this name
export const repoName = (app: App) => app.repo ?? app.slug
export const repoUrl = (app: App) => `https://github.com/${owner()}/${repoName(app)}`
export const issuesUrl = (app: App) => `${repoUrl(app)}/issues`
