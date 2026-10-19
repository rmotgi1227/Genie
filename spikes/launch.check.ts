// Cheap spike: the pure helpers launch.ts's real reply path leans on (lib/reddit's post-id parser,
// lib/repo's repo URL builder for a sample App). No network, no Composio call.
// `npx tsx spikes/launch.check.ts`
import { postIdFromUrl } from '../lib/reddit'
import { repoUrl, issuesUrl } from '../lib/repo'
import { commentIdFromUrl } from '../steps/launch'
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

check('comment permalink → comment id', commentIdFromUrl('https://www.reddit.com/r/webdev/comments/17u929n/what_is_a_tool_you_wish_existed/k92abcd/'), 'k92abcd')
check('comment permalink, no trailing slash', commentIdFromUrl('https://www.reddit.com/r/webdev/comments/17u929n/what_is_a_tool_you_wish_existed/k92abcd'), 'k92abcd')
check('comment permalink with query', commentIdFromUrl('https://www.reddit.com/r/webdev/comments/17u929n/slug/k92abcd/?context=3'), 'k92abcd')
check('thread url has no comment id', commentIdFromUrl('https://www.reddit.com/r/test/comments/1xa7b3a/genie_test_thread_please_ignore/'), undefined)
check('bare thread url has no comment id', commentIdFromUrl('https://www.reddit.com/r/test/comments/1xa7b3a/'), undefined)
if (failed) {
  console.log(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('all checks passed')
