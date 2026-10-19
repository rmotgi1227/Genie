// Cheap spike: does our stdout/alias parsing survive real-shaped `vercel deploy` output and a
// canned `/v9/projects/<slug>/domains` response? No network, no token. `npx tsx spikes/deploy.check.ts`.
import { parseDeployUrl, pickAlias } from '../steps/deploy'

let failed = 0
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? 'ok' : 'FAIL'} - ${name}${ok ? '' : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`)
  if (!ok) failed++
}

// Real `vercel deploy --prod --yes` stdout: a couple of noise lines, then the deployment URL last.
const stdout = `Vercel CLI 54.15.0
🔍  Inspect: https://vercel.com/genie-wishes/bill-splitter/8f3k2j1nQ [1s]
✅  Production: https://bill-splitter-8f3k2j1nq-genie-wishes.vercel.app [copied to clipboard] [4s]
`
check('parseDeployUrl takes the last line', parseDeployUrl(stdout), 'https://bill-splitter-8f3k2j1nq-genie-wishes.vercel.app')

check('parseDeployUrl strips quotes (CLI 54 output)', parseDeployUrl('{"url": "https://splits-a-restaurant-bill-9teto5n2a-rishabs-projects-590b3580.vercel.app"}\n'), 'https://splits-a-restaurant-bill-9teto5n2a-rishabs-projects-590b3580.vercel.app')
check('parseDeployUrl on a single-line stdout', parseDeployUrl('https://bill-splitter.vercel.app\n'), 'https://bill-splitter.vercel.app')

try {
  parseDeployUrl('no url here, just logs\n')
  console.log('FAIL - parseDeployUrl should throw on stdout with no URL')
  failed++
} catch {
  console.log('ok - parseDeployUrl throws on stdout with no URL')
}

// Canned `/v9/projects/bill-splitter/domains` shape per the real response schema: `name`,
// `redirect` (nullable), `gitBranch` (nullable) are the fields pickAlias cares about. A custom
// domain is deliberately shorter than the `.vercel.app` one, and a redirect/branch alias is
// deliberately shortest of all, to prove we don't just sort by length anymore.
const domains = [
  { name: 'splitbills.com', redirect: null, gitBranch: null },
  { name: 'bill-splitter-git-main-genie-wishes.vercel.app', redirect: null, gitBranch: 'main' },
  { name: 'bill-splitter.vercel.app', redirect: null, gitBranch: null },
  { name: 'bill-splitter-genie-wishes.vercel.app', redirect: 'bill-splitter.vercel.app', gitBranch: null },
]
check('pickAlias prefers the plain *.vercel.app prod domain over a shorter custom domain', pickAlias(domains), 'bill-splitter.vercel.app')
check('pickAlias skips a git-branch alias even if it is a .vercel.app name', pickAlias([domains[1], domains[2]]), 'bill-splitter.vercel.app')
check('pickAlias skips a redirect-only domain', pickAlias([domains[3]]), undefined)
check('pickAlias falls back to a custom domain when no .vercel.app one is live', pickAlias([domains[0]]), 'splitbills.com')
check('pickAlias on an empty list returns undefined', pickAlias([]), undefined)

if (failed) {
  console.log(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('all checks passed')
