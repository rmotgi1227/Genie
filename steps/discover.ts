// PARALLEL — discover, validate, triage.
//   discover: Parallel Search on reddit.com for "I wish there was a tool…" posts, then one Responses call
//             groups the hits into distinct wishes and drops promos, jokes and non-software.
//   validate: per wish, Parallel Search for other people asking for the same thing, then one Responses call
//             (restricted to reddit.com) pulls the author of each thread and checks prior art.
//             Unique authors are counted in code, never by a model.
//   triage:   deterministic for now (regex). A model version can replace it if it's ever needed.
// Reddit's own JSON/RSS endpoints are blocked without auth, so authors come from Parallel, with Composio
// Reddit (lib/reddit.ts) filling gaps the excerpts miss, a handful of threads at a time.
// With no PARALLEL_API_KEY the fake versions in discover.fake.ts run instead.
import { writeFileSync, mkdirSync } from 'node:fs'
import type { App, Asker, Search, State } from '../lib/types'
import { state, save, advance, slugify, uniqueAuthors } from '../lib/state'
import { parallelEnabled, search, respond, obj, str, bool, en, arr, type SearchHit } from '../lib/parallel'
import { redditPost, mapLimit } from '../lib/reddit'
import { scrub } from '../lib/guard'
import * as fake from './discover.fake'

const REDDIT = ['reddit.com']
const TOP_N = Number(process.env.VALIDATE_TOP_N ?? 3)
const DAYS_BACK = Number(process.env.DISCOVER_DAYS_BACK ?? 120)
const REDDIT_CONCURRENCY = 4

export function newApp(text: string, author: string, source: 'reddit' | 'imessage', url: string, existingSlugs: Set<string> = new Set()): App {
  return { slug: shortSlug(text, existingSlugs), wish: { text, author, url, source }, askers: [], stage: 'found', issues: [], version: 0 }
}

// Real code, keep it: unique authors are counted here, not by a model.
export function dedupe(askers: Asker[]): Asker[] {
  const seen = new Set<string>()
  return askers.filter((a) => {
    const k = a.author.toLowerCase()
    if (!k || k === '[deleted]' || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const isThread = (url: string) => /reddit\.com\/r\/[^/]+\/comments\/[a-z0-9]+/i.test(url)
const canon = (url: string) => url.replace(/^https?:\/\/(www\.|old\.)?/, 'https://www.').replace(/\?.*$/, '').replace(/\/?$/, '/')
const sub = (url: string) => url.match(/reddit\.com\/r\/([^/]+)/i)?.[1] ?? 'reddit'
const authorFromText = (s: string) => s.match(/(?:posted by|by)\s+u\/([A-Za-z0-9_-]{3,20})/i)?.[1] ?? s.match(/\bu\/([A-Za-z0-9_-]{3,20})\b/)?.[1]

function dump(name: string, data: unknown) {
  mkdirSync('spikes/out', { recursive: true })
  writeFileSync(`spikes/out/${name}.json`, JSON.stringify(data, null, 2))
}

// Short, repo-safe slug: this becomes the GitHub repo name and the Vercel project name, so it has to be
// short and clean, not "i-wish-there-was-an-app-that-splits-a-re" (40 chars of slugify(text), lead-in intact).
// Drops the wish's own lead-in ("I wish there was an app/tool that…", "is there a tool that…", "a tool that…"),
// keeps whole words up to ~28 chars (never cuts mid-word), drops any trailing stopword the cut leaves
// dangling ("…-bill-by" → "…-bill"), then disambiguates against `existingSlugs` the same way the old code
// did (now by suffixing -2, -3… instead of dropping the wish).
const LEAD_INS = [
  /^i wish there (was|were)\s+(an?\s+)?(app|tool|site|website)?\s*(that|which|for|to)?\s*/i,
  /^(someone should build|does anyone know)\s+(an?\s+)?(app|tool|site|website)?\s*(that|which|for|to)?\s*/i,
  /^is there\s+(an?\s+)?(app|tool|site|website)?\s*(that|which|for|to)?\s*/i,
  /^an?\s+(app|tool|site|website)\s+(that|which|for|to)\s*/i,
]
const SLUG_MAX = 28
const TRAILING_STOPWORDS = new Set(['a', 'an', 'the', 'by', 'to', 'for', 'of', 'in', 'on', 'into', 'with', 'and', 'or', 'that', 'your', 'my'])

function dropTrailingStopwords(slug: string): string {
  const words = slug.split('-')
  while (words.length > 1 && TRAILING_STOPWORDS.has(words[words.length - 1])) words.pop()
  return words.join('-')
}

export function shortSlug(text: string, existingSlugs: Set<string>): string {
  let t = text.trim()
  for (const re of LEAD_INS) {
    const stripped = t.replace(re, '')
    if (stripped !== t) { t = stripped; break }
  }
  const full = slugify(t)
  let base = full
  if (full.length > SLUG_MAX) {
    let cum = ''
    for (const word of full.split('-')) {
      const next = cum ? `${cum}-${word}` : word
      if (next.length > SLUG_MAX) break
      cum = next
    }
    base = cum || full.slice(0, SLUG_MAX)
  }
  base = dropTrailingStopwords(base)
  let slug = base
  for (let n = 2; base && existingSlugs.has(slug); n++) slug = `${base}-${n}`
  return slug
}

// ── discover ──
const DISCOVERY_OBJECTIVE =
  'Reddit posts where the author personally wants a specific software tool, app or website to exist, to solve a concrete problem they have right now. ' +
  'For example: "I wish there was an app/tool/site that…", "someone should build…", "is there a tool that can…". ' +
  'Exclude promos, launches, job posts, reviews, jokes, and non-software wishes.'
const DISCOVERY_QUERIES = [
  'I wish there was an app that',
  'I wish there was a tool that',
  'someone should build a website that',
  'is there a tool that can',
  'does anyone know an app that does',
]

type Grouped = {
  wishes: {
    one_line_spec: string
    is_genuine_wish: boolean
    safety: 'ok' | 'refuse'
    buildability: 'single_page' | 'needs_backend' | 'not_software'
    hit_indexes: number[]
    wisher_author: string
  }[]
}

export async function discover(): Promise<App[]> {
  if (!parallelEnabled()) return fake.discover()
  try {
    console.log('[parallel] searching reddit for wishes')
    const d: NonNullable<State['discovery']> = (state.discovery = { startedAt: Date.now(), queries: DISCOVERY_QUERIES, searches: [], hits: [] })
    save()
    const after = new Date(Date.now() - DAYS_BACK * 864e5).toISOString().slice(0, 10)
    // one call per query, so the board shows each search as it runs and the posts as they come back
    const hits: SearchHit[] = []
    for (const query of DISCOVERY_QUERIES) {
      const s: Search = { query, startedAt: Date.now(), found: 0 }
      d.searches.push(s)
      save()
      const got = (await search({ objective: DISCOVERY_OBJECTIVE, queries: [query], domains: REDDIT, maxResults: 8, afterDate: after })).filter((h) => isThread(h.url) && !hits.some((x) => canon(x.url) === canon(h.url)))
      for (const h of got) {
        hits.push(h)
        d.hits.push({ title: scrub(h.title ?? '', 200).replace(/\s*:\s*r\/\w+\s*$/, ''), subreddit: sub(h.url), author: authorFromText(h.excerpts.join(' ')), url: canon(h.url), postedAt: h.publish_date ?? undefined, query, foundAt: Date.now() })
      }
      s.found = got.length
      s.endedAt = Date.now()
      save()
    }
    dump('discover.search', hits)
    d.endedAt = Date.now()
    save()
    console.log(`[parallel] ${hits.length} reddit threads, grouping into wishes`)

    const list = hits.map((h, i) => `#${i} ${h.url}\nTITLE: ${scrub(h.title ?? '', 200)}\n${scrub(h.excerpts.join(' '), 600)}`).join('\n\n')
    const grouped = await respond<Grouped>({
      name: 'wishes',
      input:
        `Below are Reddit search hits. Group them into distinct wishes for a software tool that doesn't exist yet. ` +
        `For each wish give a one-line spec of the tool, whether it's a genuine personal wish (not a promo, launch, job post, review or joke), ` +
        `whether building it is safe and appropriate, whether it fits in a single static web page with no backend, the indexes of the hits ` +
        `that ask for it, and the Reddit username of the original poster of the first hit if it appears in the text (else empty string).\n\n${list}`,
      schema: obj({
        wishes: arr(
          obj({
            one_line_spec: str('e.g. "a bill splitter that splits by item"'),
            is_genuine_wish: bool(),
            safety: en(['ok', 'refuse']),
            buildability: en(['single_page', 'needs_backend', 'not_software']),
            hit_indexes: arr({ type: 'integer' }),
            wisher_author: str('Reddit username without u/, or empty'),
          }),
        ),
      }),
      domains: REDDIT,
    })
    dump('discover.grouped', grouped)

    // seed uniqueness against every slug already in play, not just this batch, since short-but-common
    // specs ("a bill splitter…") now collide more often than the old 40-char slugify(text) did
    const slugs = new Set([...state.apps, ...state.candidates].map((a) => a.slug))
    const apps: App[] = []
    for (const w of grouped.wishes) {
      if (!w.is_genuine_wish || w.safety !== 'ok' || w.buildability !== 'single_page') continue
      const hit = hits[w.hit_indexes[0] ?? -1]
      if (!hit) continue
      const author = w.wisher_author || authorFromText(hit.excerpts.join(' ')) || ''
      const app = newApp(w.one_line_spec, author, 'reddit', canon(hit.url), slugs)
      if (!app.slug) continue // shortSlug can return '' if the spec has no alphanumerics at all
      slugs.add(app.slug)
      app.spec = w.one_line_spec
      app.wish.text = scrub(hit.title ?? w.one_line_spec, 200).replace(/\s*:\s*r\/\w+\s*$/, '')
      apps.push(app)
    }

    // Parallel's excerpt sometimes has no u/name and the Responses call above came back with wisher_author
    // empty too; Composio Reddit fills that gap, a few threads at a time so Genie never fires a burst of calls.
    const missing = apps.filter((a) => !a.wish.author)
    if (missing.length) {
      const looked = await mapLimit(missing, REDDIT_CONCURRENCY, async (a) => [a.slug, (await redditPost(a.wish.url))?.author] as const)
      const found = new Map(looked.filter(([, author]) => author) as [string, string][])
      for (const a of missing) if (found.has(a.slug)) a.wish.author = found.get(a.slug)!
    }

    console.log(`[parallel] ${apps.length} buildable wishes`)
    return apps
  } catch (e) {
    // fail soft: a bad Parallel sweep shouldn't take the loop down, just skip this round
    console.log(`[parallel] discover failed: ${(e as Error).message}`)
    return []
  }
}

// ── validate ──
type Extracted = {
  threads: { url: string; author: string; subreddit: string; quote: string; asks_for_it: boolean }[]
  prior_art: 'strong_existing_tool' | 'partial' | 'none'
  best_existing_tool: { name: string; url: string; why: string }
  why_build_it: string
}

async function findAskers(app: App): Promise<{ askers: Asker[]; why: string; prior: Extracted['prior_art']; existing: Extracted['best_existing_tool'] }> {
  const spec = app.spec ?? app.wish.text
  const queries = [`wish there was ${spec}`, `is there an app for ${spec}`, `looking for a tool ${spec}`]
  const v: NonNullable<App['validation']> = (app.validation = { startedAt: Date.now(), queries, searches: [], checked: [] })
  save()
  const byUrl = new Map<string, SearchHit>()
  for (const query of queries) {
    const s: Search = { query, startedAt: Date.now(), found: 0 }
    v.searches.push(s)
    save()
    const got = (await search({
      objective: `Reddit posts by different people asking for or wishing for ${spec}. Only posts where the author wants this tool to exist.`,
      queries: [query],
      domains: REDDIT,
      maxResults: 6,
    })).filter((h) => isThread(h.url))
    for (const h of got) if (!byUrl.has(canon(h.url))) { byUrl.set(canon(h.url), h); s.found++ }
    s.endedAt = Date.now()
    save()
  }
  if (app.wish.url && !byUrl.has(canon(app.wish.url))) byUrl.set(canon(app.wish.url), { url: app.wish.url, title: app.wish.text, publish_date: null, excerpts: [app.wish.text] })
  dump(`validate.${app.slug}.search`, [...byUrl.values()])

  const list = [...byUrl.values()].map((h) => `URL: ${canon(h.url)}\nTITLE: ${scrub(h.title ?? '', 200)}\n${scrub(h.excerpts.join(' '), 500)}`).join('\n\n')
  const x = await respond<Extracted>({
    name: 'askers',
    input:
      `The wish: "${spec}".\n\nFor each Reddit thread below, open it and give the username of the original poster (without u/), the subreddit, ` +
      `a short quote (under 160 characters) where they ask for this, and whether the post genuinely asks for this tool. ` +
      `Then check whether a good free tool already does exactly this: prior_art is "strong_existing_tool" if yes, "partial" if something close exists, "none" otherwise, ` +
      `with the best existing tool's name, url and why. Finish with one short sentence on why it's worth building (or not).\n\n${list}`,
    schema: obj({
      threads: arr(obj({ url: str(), author: str(), subreddit: str(), quote: str(), asks_for_it: bool() })),
      prior_art: en(['strong_existing_tool', 'partial', 'none']),
      best_existing_tool: obj({ name: str(), url: str(), why: str() }),
      why_build_it: str(),
    }),
    domains: REDDIT,
    effort: 'medium',
  })
  dump(`validate.${app.slug}.extracted`, x)

  // Fill authors Composio-side for threads where neither the model's `author` field nor our own
  // u/-regex over the excerpt found one. Same ~4-at-a-time cap as discover().
  const needLookup = x.threads.filter((t) => t.asks_for_it && !t.author && !authorFromText(byUrl.get(canon(t.url))?.excerpts.join(' ') ?? ''))
  let looked = new Map<string, string>()
  if (needLookup.length) {
    const got = await mapLimit(needLookup, REDDIT_CONCURRENCY, async (t) => [canon(t.url), (await redditPost(canon(t.url)))?.author] as const)
    looked = new Map(got.filter(([, author]) => author) as [string, string][])
  }

  const askers: Asker[] = []
  for (const t of x.threads) {
    if (!t.asks_for_it) continue
    const hit = byUrl.get(canon(t.url))
    const author = t.author || authorFromText(hit?.excerpts.join(' ') ?? '') || looked.get(canon(t.url)) || ''
    if (!author) continue
    askers.push({ author, url: canon(t.url), quote: scrub(t.quote || hit?.title || '', 160), source: `r/${t.subreddit || sub(t.url)}`, postedAt: hit?.publish_date ?? undefined, foundAt: Date.now() })
  }
  const unique = dedupe(askers) // unique authors are still counted here, in code, never by the model
  app.askers = unique
  v.checked = x.best_existing_tool?.name ? [{ name: x.best_existing_tool.name, url: x.best_existing_tool.url, verdict: x.best_existing_tool.why }] : []
  v.priorArt = x.prior_art
  v.verdict = x.prior_art === 'strong_existing_tool' ? `Already exists: ${x.best_existing_tool.name}` : x.why_build_it
  v.endedAt = Date.now()
  save()
  return { askers: unique, why: x.why_build_it, prior: x.prior_art, existing: x.best_existing_tool }
}

// Fills in askers, spec and why for the top wishes. Returns buildable wishes, most askers first.
export async function validate(candidates: App[]): Promise<App[]> {
  if (!parallelEnabled()) return fake.validate(candidates)
  const top = candidates.slice(0, TOP_N)
  console.log(`[parallel] validating ${top.length} of ${candidates.length} wishes`)
  const out: App[] = []
  for (const app of top) {
    try {
      const { askers, why, prior, existing } = await findAskers(app)
      app.askers = askers
      app.why = why
      app.spec ??= app.wish.text // an owner's own idea arrives with no spec; the approval text and the launch post need one
      if (!app.wish.author) app.wish.author = askers.find((a) => a.url === canon(app.wish.url))?.author ?? askers[0]?.author ?? 'someone'
      console.log(`[parallel] ${app.slug}: ${uniqueAuthors(askers)} unique askers, prior art ${prior}`)
      if (prior === 'strong_existing_tool') {
        advance(app.slug, 'exists', { existingTool: existing }) // Genie doesn't build clones
        continue
      }
      out.push(app)
    } catch (e) {
      console.log(`[parallel] validate ${app.slug} failed: ${(e as Error).message}`)
    }
  }
  return out.sort((a, b) => uniqueAuthors(b.askers) - uniqueAuthors(a.askers))
}

// ── triage ──
// Deterministic for now (regex). Bugs and small features both go to the owner for a YES; noise is ignored.
// `title` is the short form for the changelog and the board: "Can you add dark mode?" → "dark mode".
export async function triage(text: string): Promise<{ kind: 'bug' | 'feature' | 'noise'; summary: string; title: string }> {
  const summary = text.trim()
  const title = summary
    .replace(/^(hey|hi|hello)[,!\s]*/i, '')
    .replace(/^(can|could|would) (you|it|we) (please )?/i, '')
    .replace(/^(please )?(add|make|put|support|implement|include)( an?| the| some)? /i, '')
    .replace(/^(it would be (nice|great|cool) (to have|if (it|you) had))( an?| the)? /i, '')
    .replace(/[?!.]+$/, '')
    .trim() || summary
  if (/doesn'?t|broken|bug|wrong|not work|crash|error|fails?|can'?t /i.test(summary)) return { kind: 'bug', summary, title }
  if (/add|could you|can you|please make|feature|would be nice|can it|support|option|mode|toggle/i.test(summary)) return { kind: 'feature', summary, title }
  return { kind: 'noise', summary, title }
}
