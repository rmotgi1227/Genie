// Cheap spike: the pure helpers launch.ts's real reply and real issues paths lean on (lib/reddit's
// post-id parser, lib/repo's repo URL builder, and pollReportsReal's issue-list → Report mapping).
// No network, no Composio call. `npx tsx spikes/launch.check.ts`
import { postIdFromUrl } from '../lib/reddit'
import { repoUrl, issuesUrl } from '../lib/repo'
import { commentIdFromUrl, issueNumberFromId, mapGhIssuesToReports, shouldSkipAppPath, gitBlobSha, withGenieFooter, type GhIssue } from '../steps/launch'
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

check('issueNumberFromId reads the number off pollReportsReal\'s own gh_<repo>_<number> id', issueNumberFromId('gh_bill-splitter_42'), 42)
check('issueNumberFromId on a repo name that itself has underscores still takes the trailing number', issueNumberFromId('gh_my_app_7'), 7)
check('issueNumberFromId on a hand-filed manual_<ts> id (no GitHub issue number) returns undefined', issueNumberFromId('manual_1708000000000'), undefined)
check('issueNumberFromId on the old flat gh_<n> fake-report id (no repo segment) returns undefined', issueNumberFromId('gh_14'), undefined)

const reportApp = { slug: 'bill-splitter', repo: 'bill-splitter', issues: [{ id: 'gh_bill-splitter_1' }] } as App
const ghIssues: GhIssue[] = [
  { number: 1, title: 'already tracked', body: '', html_url: 'https://github.com/x/bill-splitter/issues/1', user: { login: 'maya_k' } },
  { number: 2, title: 'Can you add dark mode?', body: 'please', html_url: 'https://github.com/x/bill-splitter/issues/2', user: { login: 'maya_k' } },
  { number: 3, title: 'a pull request, not an issue', body: '', html_url: 'https://github.com/x/bill-splitter/pull/3', user: { login: 'maya_k' }, pull_request: {} },
  { number: 4, title: 'genie\'s own housekeeping issue', body: '', html_url: 'https://github.com/x/bill-splitter/issues/4', user: { login: 'genie-bot' } },
]
check(
  'mapGhIssuesToReports skips an already-tracked issue, a PR, and the bot\'s own issue, keeping only the new one',
  mapGhIssuesToReports(reportApp, ghIssues, 'genie-bot'),
  [{ id: 'gh_bill-splitter_2', slug: 'bill-splitter', source: 'github', author: 'maya_k', url: 'https://github.com/x/bill-splitter/issues/2', text: 'Can you add dark mode?\nplease' }],
)
check(
  'mapGhIssuesToReports with no bot login configured keeps the bot\'s issue too (nothing to filter it on)',
  mapGhIssuesToReports(reportApp, ghIssues, undefined).some((r) => r.id === 'gh_bill-splitter_4'),
  true,
)

// publish() now pushes every file under apps/<slug>/, not just index.html/README.md/screenshot.png —
// an extension or CLI app can ship a manifest, icons, a bin/ dir, its own README, etc.
check('CONTRACT.md (the Cline task spec) never gets pushed to the repo', shouldSkipAppPath('CONTRACT.md', false), true)
check('a screenshot snapshot (v1.png, v2.png, …) never gets pushed, those are board-only', shouldSkipAppPath('v1.png', false), true)
check('v12.png (double-digit version) is still recognized as a snapshot', shouldSkipAppPath('v12.png', false), true)
check('node_modules is skipped as a directory so nothing under it gets walked', shouldSkipAppPath('node_modules', true), true)
check('a dot-dir like .vercel is skipped', shouldSkipAppPath('.vercel', true), true)
check('a dot-file like .gitignore is skipped too', shouldSkipAppPath('.gitignore', false), true)
check('index.html is pushed', shouldSkipAppPath('index.html', false), false)
check('manifest.json (a browser extension) is pushed', shouldSkipAppPath('manifest.json', false), false)
check('a nested icons/icon-128.png is pushed', shouldSkipAppPath('icons/icon-128.png', false), false)
check('screenshot.png itself (not a vN.png snapshot) is pushed', shouldSkipAppPath('screenshot.png', false), false)

check('gitBlobSha of an empty file matches `git hash-object` (verified separately)', gitBlobSha(Buffer.alloc(0)), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
check('gitBlobSha of "hello\\n" matches `git hash-object` (verified separately)', gitBlobSha(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a')

const footerApp = { slug: 'bill-splitter', wish: { url: 'https://www.reddit.com/r/test/comments/1abcde/x/' }, askers: [], stage: 'maintaining', issues: [], version: 1 } as unknown as App
const footered = withGenieFooter('# Bill Splitter\n\nSplits a bill by item.\n', footerApp, 'https://bill-splitter.vercel.app')
check('withGenieFooter keeps Cline\'s own README text untouched at the top', footered.startsWith('# Bill Splitter\n\nSplits a bill by item.\n'), true)
check('withGenieFooter appends the live link', footered.includes('https://bill-splitter.vercel.app'), true)
check('withGenieFooter appends the pre-approved "Built by an AI agent" line, unchanged', footered.includes('Built by an AI agent (Genie). MIT licensed.'), true)
check('withGenieFooter appends the wish link', footered.includes('https://www.reddit.com/r/test/comments/1abcde/x/'), true)

if (failed) {
  console.log(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('all checks passed')
