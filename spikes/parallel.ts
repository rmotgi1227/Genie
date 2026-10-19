// Spike 3: Parallel discovery + validation on real Reddit data.
// Passes if one wish has 5 or more unique askers with real links.
//   PARALLEL_API_KEY=... npx tsx spikes/parallel.ts            full run
//   PARALLEL_API_KEY=... npx tsx spikes/parallel.ts "a bill splitter that splits by item"   validate one wish only
// Raw API responses land in spikes/out/*.json; the ranked result in spikes/out/result.json.
import '../lib/env'
import { writeFileSync } from 'node:fs'
import { discover, validate, newApp } from '../steps/discover'
import { uniqueAuthors } from '../lib/state'

const t0 = Date.now()
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

const only = process.argv[2]
let candidates = only ? [Object.assign(newApp(only, '', 'reddit', ''), { spec: only })] : await discover()
console.log(`\n[${since()}] ${candidates.length} candidates:`)
for (const c of candidates) console.log(`  - ${c.spec}  (${c.wish.url})`)

const ranked = await validate(candidates)
console.log(`\n[${since()}] ranked:`)
for (const a of ranked) {
  console.log(`\n${uniqueAuthors(a.askers)} askers · ${a.spec}\n  why: ${a.why}`)
  for (const k of a.askers) console.log(`  u/${k.author} ${k.source} ${k.url}\n    "${k.quote}"`)
}
writeFileSync('spikes/out/result.json', JSON.stringify(ranked, null, 2))
const best = ranked[0]
console.log(`\n${best && uniqueAuthors(best.askers) >= 5 ? 'PASS' : 'FAIL'}: best wish has ${best ? uniqueAuthors(best.askers) : 0} unique askers (need 5). Total ${since()}.`)
