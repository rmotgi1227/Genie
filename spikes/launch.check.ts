// Cheap spike: the pure helpers launch.ts's real reply path leans on (lib/reddit's post-id parser,
// lib/repo's repo URL builder for a sample App). No network, no Composio call.
// `npx tsx spikes/launch.check.ts`
import { postIdFromUrl } from '../lib/reddit'
import { repoUrl, issuesUrl } from '../lib/repo'
import type { App } from '../lib/types'

let failed = 0
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? 'ok' : 'FAIL'} - ${name}${ok ? '' : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`)
  if (!ok) failed++
}

check(
  'postIdFromUrl reads the id out of the wisher thread url replyReal passes to REDDIT_POST_REDDIT_COMMENT',
  postIdFromUrl('https://www.reddit.com/r/test/comments/1abcde/some_title/'),
  '1abcde',
)
check('postIdFromUrl on a non-thread url (the owner-texted-in case) returns undefined', postIdFromUrl('https://www.reddit.com/r/test/'), undefined)

const sampleApp = { slug: 'bill-splitter', repo: 'bill-splitter' } as App
check('repoUrl builds the MIT repo link replyText drops into the reply', repoUrl(sampleApp), 'https://github.com/genie-wishes/bill-splitter')
check('issuesUrl points at that same repo\'s issues', issuesUrl(sampleApp), 'https://github.com/genie-wishes/bill-splitter/issues')

if (failed) {
  console.log(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('all checks passed')
