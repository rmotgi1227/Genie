// Cheap test for the post-id parser and request/launch/joke regexes (lib/reddit.ts), the short-slug
// maker and the comment/listing → hit mappers (steps/discover.ts).
// No Composio/Parallel calls, no network. `npx tsx spikes/discover.check.ts` should print only PASS lines.
import { postIdFromUrl, isRequestPost, looksLikeLaunch, looksLikeJoke, type RedditComment, type RedditPost } from '../lib/reddit'
import { shortSlug, commentToHit, listingToHit } from '../steps/discover'

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

// isRequestPost / looksLikeLaunch / looksLikeJoke
check('is there a tool that… is a request', isRequestPost('Is there an app that tracks plant watering?'), true)
check('looking for … is a request', isRequestPost('Looking for a Chrome extension that mutes autoplay video'), true)
check('someone should build … is a request', isRequestPost('Someone should build a tool that renames photos by date taken'), true)
check('i wish … is a request', isRequestPost('I wish there was a site that split bills by item'), true)
check('does x exist is a request', isRequestPost('Does a tool exist that merges PDFs offline?'), true)
check('a launch post is not a request even if titled like one', isRequestPost('I built a tool that renames photos by date taken', 'v1.0 is out, try it'), false)
check('an unrelated post is not a request', isRequestPost('My cat knocked over my monitor again'), false)
check('"I built" reads as a launch', looksLikeLaunch('I built a tiny CLI for this'), true)
check('"introducing" reads as a launch', looksLikeLaunch('Introducing my new side project'), true)
check('a version number reads as a launch', looksLikeLaunch('Shipped v1.2 last night'), true)
check('a plain question is not a launch', looksLikeLaunch('Does anyone know a tool for this?'), false)
check('"lol" reads as a joke/meta comment', looksLikeJoke('lol same'), true)
check('"take my upvote" reads as a joke/meta comment', looksLikeJoke('Take my upvote, this is genius'), true)
check('a real wish is not a joke', looksLikeJoke('I wish there was a tool that merged my PDFs without an account'), false)

// commentToHit / listingToHit: the comment/post → SourceHit mapping, on canned Composio JSON
const comment: RedditComment = { id: 'xyz123', author: 'plant_person', body: 'A tool that reminds me to water each plant on its own schedule, please.', score: 42, depth: 0, permalink: '/r/AppIdeas/comments/1abcde/what_tool_do_you_wish_existed/xyz123/', created_utc: 1700000000 }
const commentHit = commentToHit('What tool do you wish existed?', 'AppIdeas', 'wish-thread', comment)
check('commentToHit: url is the comment permalink, absolute', commentHit.url, 'https://www.reddit.com/r/AppIdeas/comments/1abcde/what_tool_do_you_wish_existed/xyz123/')
check('commentToHit: title is the thread title, not the comment body', commentHit.title, 'What tool do you wish existed?')
check('commentToHit: excerpt is the comment body', commentHit.excerpts, [comment.body])
check('commentToHit: author is the comment author', commentHit.author, 'plant_person')
check('commentToHit: score carries through as the hit score', commentHit.score, 42)

const post: RedditPost = { id: '1fghij', title: 'Is there an app that tracks watering?', selftext: 'I keep forgetting.', author: 'fern_gully_', permalink: '/r/houseplants/comments/1fghij/is_there_an_app/', score: 7, subreddit: 'houseplants', created_utc: 1700000000 }
const postHit = listingToHit(post, 'subreddit-listing')
check('listingToHit: url is the post permalink, absolute', postHit.url, 'https://www.reddit.com/r/houseplants/comments/1fghij/is_there_an_app/')
check('listingToHit: author is the post author', postHit.author, 'fern_gully_')
check('listingToHit: subreddit comes from the post, not a guess', postHit.subreddit, 'houseplants')

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1) }
console.log('all checks passed')
