// Spike: the rewritten discover() sources — megathread comments + subreddit listings (both Composio
// Reddit), with the original Parallel search kept as a fallback — on real Reddit data.
//   PARALLEL_API_KEY=... COMPOSIO_API_KEY=... APPROVAL_TRANSPORT=fake npx tsx spikes/sources.ts
// Prints every buildable wish discover() found: spec, kind, star potential, author, upvotes, unique
// askers and url. Raw search/grouped JSON lands in spikes/out/discover.*.json, same as discover() itself.
import '../lib/env'
import { discover } from '../steps/discover'
import { uniqueAuthors } from '../lib/state'

const t0 = Date.now()
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

const apps = await discover()
console.log(`\n[${since()}] ${apps.length} buildable wishes:\n`)
for (const a of apps) {
  console.log(`${a.spec}`)
  console.log(`  kind: ${a.kind}  star_potential: ${a.starPotential}  askers: ${uniqueAuthors(a.askers)}  upvotes: ${a.upvotes ?? 0}  author: u/${a.wish.author || '?'}`)
  console.log(`  url: ${a.wish.url}`)
  console.log()
}
console.log(`${apps.length ? 'PASS' : 'FAIL'}: discover() returned ${apps.length} buildable wishes. Total ${since()}.`)
