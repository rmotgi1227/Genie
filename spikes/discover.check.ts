// Cheap test for the post-id parser (lib/reddit.ts) and the short-slug maker (steps/discover.ts).
// No Composio/Parallel calls, no network. `npx tsx spikes/discover.check.ts` should print only PASS lines.
import { postIdFromUrl } from '../lib/reddit'
import { shortSlug } from '../steps/discover'

let failed = 0
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
  if (!ok) failed++
}

// postIdFromUrl
check('standard thread url', postIdFromUrl('https://www.reddit.com/r/foo/comments/1abcde/some_title/'), '1abcde')
check('old.reddit, no trailing slash, no title', postIdFromUrl('https://old.reddit.com/r/foo/comments/1abcde'), '1abcde')
check('with query string', postIdFromUrl('https://reddit.com/r/foo/comments/1abcde/title/?utm=1'), '1abcde')
check('comment permalink (still the post id)', postIdFromUrl('https://www.reddit.com/r/foo/comments/1abcde/title/comment/xyz123/'), '1abcde')
check('not a thread url', postIdFromUrl('https://www.reddit.com/r/foo/'), undefined)

// shortSlug
check('drops lead-in, trims the trailing stopword the cut leaves dangling', shortSlug('i wish there was an app that splits a restaurant bill by item', new Set()), 'splits-a-restaurant-bill')
check('drops "i wish there was a tool that"', shortSlug('i wish there was a tool that tracks my plants watering schedule', new Set()), 'tracks-my-plants-watering')
check('caps at ~30 chars on a word boundary', shortSlug('a tool that generates realistic fake data for testing forms', new Set()), 'generates-realistic-fake')
check('short text passes through', shortSlug('bill splitter', new Set()), 'bill-splitter')
check('dedupes against existing slugs', shortSlug('bill splitter', new Set(['bill-splitter'])), 'bill-splitter-2')
check('trims multiple trailing stopwords in a row', shortSlug('Is there a tool that turns a recipe into a grocery list sorted by aisle?', new Set()), 'turns-a-recipe')

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1) }
console.log('all checks passed')
