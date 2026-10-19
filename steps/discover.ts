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
import { redditPost, redditListing, redditComments, postIdFromUrl, isRequestPost, looksLikeJoke, mapLimit, type RedditPost, type RedditComment } from '../lib/reddit'
import { scrub } from '../lib/guard'
import * as fake from './discover.fake'
import { tool } from '../lib/composio'

const REDDIT = ['reddit.com']
const TOP_N = Number(process.env.VALIDATE_TOP_N ?? 6)
const DAYS_BACK = Number(process.env.DISCOVER_DAYS_BACK ?? 120)
const REDDIT_CONCURRENCY = 4
const MAX_DISCOVER_HITS = 80
const TOP_COMMENTS_PER_THREAD = 15
const BUILD_KINDS = new Set((process.env.BUILD_KINDS ?? 'web_page,browser_extension').split(',').map((s) => s.trim()).filter(Boolean))
const STAR_RANK: Record<string, number> = { high: 2, medium: 1, low: 0 }

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
// Three sources, highest priority first: (a) Composio reads the top comments on "what tool do you wish
// existed" megathreads — every comment is its own wish, with a real author and score straight from
// Reddit; (b) Composio reads a handful of subreddit listings and keeps request-shaped posts; (c) the
// original Parallel "I wish there was a tool that…" search, kept as a fallback, lowest priority.
const redditUrl = (permalink: string) => (permalink.startsWith('http') ? permalink : `https://www.reddit.com${permalink}`)

type SourceHit = SearchHit & { subreddit: string; author: string; score?: number; query: string }

export function commentToHit(threadTitle: string, subreddit: string, query: string, comment: RedditComment): SourceHit {
  return {
    url: canon(redditUrl(comment.permalink)),
    title: threadTitle,
    publish_date: comment.created_utc ? new Date(comment.created_utc * 1000).toISOString() : null,
    excerpts: [comment.body],
    subreddit,
    author: comment.author ?? '',
    score: comment.score,
    query,
  }
}

export function listingToHit(post: RedditPost, query: string): SourceHit {
  return {
    url: canon(redditUrl(post.permalink)),
    title: post.title,
    publish_date: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
    excerpts: [post.selftext ?? ''],
    subreddit: post.subreddit,
    author: post.author ?? '',
    score: post.score,
    query,
  }
}

const WISH_THREAD_QUERIES = [
  'what dev tool do you wish existed',
  'what tool do you wish existed',
  'what browser extension do you wish existed',
  'what software do you wish existed',
  'what app do you wish existed',
]
// Known-good megathreads, always read even if Parallel's search turns up nothing new this sweep.
const SEED_WISH_THREADS = ['1iyyzcs', '17u929n', '1mslx4r', '1ttxi2k', '194ugw3', '1wus8s7', '1x0wvyy']
const LISTING_SUBREDDITS = ['SomebodyMakeThis', 'AppIdeas', 'chrome_extensions', 'vscode', 'webdev', 'software', 'selfhosted', 'opensource', 'devops', 'productivity']
const WISH_THREAD_OBJECTIVE =
  'Reddit megathreads whose title itself asks "what tool/app/browser extension/software do you wish existed", where the top-level replies ' +
  'each name a different wish. Return the thread itself, not an individual reply.'

// (a) megathreads: each top-level, non-joke, non-deleted comment over 25 characters is its own wish,
// with the comment's own author, score and permalink — no model needed to find the author here.
async function wishThreadHits(d: NonNullable<State['discovery']>, after: string): Promise<SourceHit[]> {
  const s: Search = { query: 'wish megathreads (Composio)', startedAt: Date.now(), found: 0 }
  d.searches.push(s)
  save()
  const out: SourceHit[] = []
  try {
    const ids = new Set(SEED_WISH_THREADS)
    if (parallelEnabled()) {
      for (let i = 0; i < WISH_THREAD_QUERIES.length; i += 5) {
        const chunk = WISH_THREAD_QUERIES.slice(i, i + 5)
        const got = await search({ objective: WISH_THREAD_OBJECTIVE, queries: chunk, domains: REDDIT, maxResults: 6, afterDate: after }).catch((e) => {
          console.log(`[reddit] wish-thread search failed: ${(e as Error).message}`)
          return [] as SearchHit[]
        })
        for (const h of got) {
          if (!isThread(h.url)) continue
          const id = postIdFromUrl(h.url)
          if (id) ids.add(id)
        }
      }
    }
    const threads = await mapLimit([...ids], REDDIT_CONCURRENCY, (id) => redditComments(id, { limit: 40 }))
    for (const { post, comments } of threads) {
      if (!post) continue
      const top = comments
        .filter((c) => (c.depth ?? 0) === 0 && c.author && c.author !== '[deleted]' && c.body && c.body.length >= 25 && !looksLikeJoke(c.body))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, TOP_COMMENTS_PER_THREAD)
      for (const c of top) {
        const hit = commentToHit(post.title, post.subreddit, 'wish-thread', c)
        out.push(hit)
        d.hits.push({ title: scrub(hit.title ?? '', 200), subreddit: hit.subreddit, author: hit.author || undefined, url: hit.url, postedAt: hit.publish_date ?? undefined, query: hit.query, foundAt: Date.now() })
      }
    }
  } catch (e) {
    console.log(`[reddit] wish threads failed: ${(e as Error).message}`)
  }
  s.found = out.length
  s.endedAt = Date.now()
  save()
  return out
}

// (b) subreddit listings: cheap regex keeps only request-shaped posts ("is there an app that…",
// "looking for…", "someone should build…", "I wish…", "does … exist") and drops launches.
async function listingHits(d: NonNullable<State['discovery']>): Promise<SourceHit[]> {
  const s: Search = { query: 'subreddit listings (Composio)', startedAt: Date.now(), found: 0 }
  d.searches.push(s)
  save()
  const out: SourceHit[] = []
  try {
    const lists = await mapLimit(LISTING_SUBREDDITS, REDDIT_CONCURRENCY, (sub) => redditListing(sub, { sort: 'new', maxResults: 50 }))
    for (const posts of lists) {
      for (const p of posts) {
        if (!p.author || p.author === '[deleted]' || !isRequestPost(p.title, p.selftext)) continue
        const hit = listingToHit(p, 'subreddit-listing')
        out.push(hit)
        d.hits.push({ title: scrub(hit.title ?? '', 200), subreddit: hit.subreddit, author: hit.author || undefined, url: hit.url, postedAt: hit.publish_date ?? undefined, query: hit.query, foundAt: Date.now() })
      }
    }
  } catch (e) {
    console.log(`[reddit] subreddit listings failed: ${(e as Error).message}`)
  }
  s.found = out.length
  s.endedAt = Date.now()
  save()
  return out
}

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
    kind: 'web_page' | 'browser_extension' | 'editor_plugin' | 'cli' | 'needs_backend' | 'not_software'
    star_potential: 'high' | 'medium' | 'low'
    hit_indexes: number[]
    wisher_author: string
  }[]
}

// A seeded wish (SEED_WISH_URL = a real Reddit comment permalink) goes first, ahead of the sweep. It's still a
// real wish: the comment's own author, text and upvotes are read through Composio, and validate() checks it
// with Parallel like any other. Used to pick the demo's wish without faking anything.
const seeded = new Set<string>()
async function seedWish(): Promise<App | undefined> {
  const url = process.env.SEED_WISH_URL
  const id = url?.match(/\/comments\/[a-z0-9]+\/[^/?#]*\/([a-z0-9]+)/i)?.[1]
  if (!url || !id) return undefined
  try {
    const r = await tool<{ things?: { data?: { author?: string; body?: string; score?: number; subreddit?: string } }[] }>('REDDIT_RETRIEVE_SPECIFIC_COMMENT', { id: `t1_${id}` })
    const c = r?.things?.[0]?.data
    if (!c?.author || !c.body) throw new Error('comment not found')
    const quote = scrub(c.body, 300)
    const app = newApp(process.env.SEED_WISH_SPEC || quote, c.author, 'reddit', url)
    app.spec = process.env.SEED_WISH_SPEC || quote
    app.wish.text = quote
    app.kind = process.env.SEED_WISH_KIND || 'web_page'
    app.upvotes = c.score ?? 0
    app.askers = [{ author: c.author, url, quote: scrub(c.body, 160), source: `r/${c.subreddit ?? sub(url)}`, foundAt: Date.now() }]
    seeded.add(app.slug)
    console.log(`[composio] seeded wish from u/${c.author}: ${app.spec}`)
    return app
  } catch (e) {
    console.log(`[composio] couldn't read the seeded wish ${url}: ${(e as Error).message}`)
    return undefined
  }
}

export async function discover(): Promise<App[]> {
  if (!parallelEnabled()) return sweep()
  const [seed, found] = await Promise.all([seedWish(), sweep().catch(() => [] as App[])])
  return seed ? [seed, ...found.filter((a) => a.slug !== seed.slug)] : found
}


async function sweep(): Promise<App[]> {
  if (!parallelEnabled()) return fake.discover()
  try {
    console.log('[reddit] gathering wishes: megathreads, subreddit listings, Parallel search')
    const d: NonNullable<State['discovery']> = (state.discovery = { startedAt: Date.now(), queries: [...WISH_THREAD_QUERIES, ...DISCOVERY_QUERIES], searches: [], hits: [] })
    save()
    const after = new Date(Date.now() - DAYS_BACK * 864e5).toISOString().slice(0, 10)

    const [wishHits, listHits] = await Promise.all([wishThreadHits(d, after), listingHits(d)])

    // (c) Parallel's own search, lowest priority: one call per query, so the board shows each search
    // as it runs and the posts as they come back.
    const parallelHits: SourceHit[] = []
    for (const query of DISCOVERY_QUERIES) {
      const s: Search = { query, startedAt: Date.now(), found: 0 }
      d.searches.push(s)
      save()
      const got = (
        await search({ objective: DISCOVERY_OBJECTIVE, queries: [query], domains: REDDIT, maxResults: 8, afterDate: after }).catch((e) => {
          console.log(`[parallel] discovery search failed: ${(e as Error).message}`)
          return [] as SearchHit[]
        })
      ).filter((h) => isThread(h.url) && !parallelHits.some((x) => x.url === canon(h.url)))
      for (const h of got) {
        const hit: SourceHit = { ...h, url: canon(h.url), subreddit: sub(h.url), author: authorFromText(h.excerpts.join(' ')) ?? '', query }
        parallelHits.push(hit)
        d.hits.push({ title: scrub(h.title ?? '', 200).replace(/\s*:\s*r\/\w+\s*$/, ''), subreddit: hit.subreddit, author: hit.author || undefined, url: hit.url, postedAt: h.publish_date ?? undefined, query, foundAt: Date.now() })
      }
      s.found = got.length
      s.endedAt = Date.now()
      save()
    }

    // wish threads, then subreddit listings, then Parallel search, in that priority order, capped so
    // one grouping call never sees more than MAX_DISCOVER_HITS hits
    const seen = new Set<string>()
    const hits: SourceHit[] = []
    for (const h of [...wishHits, ...listHits, ...parallelHits]) {
      if (hits.length >= MAX_DISCOVER_HITS) break
      if (seen.has(h.url)) continue
      seen.add(h.url)
      hits.push(h)
    }
    dump('discover.search', hits)
    d.endedAt = Date.now()
    save()
    console.log(`[reddit] ${hits.length} hits (${wishHits.length} wish-thread comments, ${listHits.length} subreddit posts, ${parallelHits.length} Parallel), grouping into wishes`)

    // Parallel's Responses API caps input+instructions at 20,000 characters; MAX_DISCOVER_HITS hits
    // with a 600-char excerpt each blew past that, so each hit gets a short, no-URL line instead
    // (the URL only matters once a hit is picked, via hit_indexes, not for the grouping prompt itself).
    const list = hits.map((h, i) => `#${i} ${scrub(h.title ?? '', 90)}: ${scrub(h.excerpts.join(' '), 180)}`).join('\n')
    const grouped = await respond<Grouped>({
      name: 'wishes',
      input:
        `Below are Reddit search hits. Group them into distinct wishes for a software tool that doesn't exist yet. ` +
        `For each wish give a one-line spec of the tool, whether it's a genuine personal wish (not a promo, launch, job post, review or joke), ` +
        `whether building it is safe and appropriate, what kind of software it is, how likely developers would be to star an open-source repo ` +
        `of it, the indexes of the hits that ask for it, and the Reddit username of the original poster of the first hit if it appears in the ` +
        `text (else empty string).\n\n` +
        `kind: "web_page" if it can run entirely in the browser with no backend, even if the wish calls it "an app" (a calculator, a converter, ` +
        `a game, a timer); "browser_extension" if it has to be a Chrome/Firefox extension; "editor_plugin" if it has to be a VS Code/JetBrains/` +
        `neovim plugin; "cli" if it has to be a command-line tool; "needs_backend" if it truly needs a server, database or user accounts; ` +
        `"not_software" if it isn't a software wish at all.\n\n${list}`,
      schema: obj({
        wishes: arr(
          obj({
            one_line_spec: str('e.g. "a bill splitter that splits by item"'),
            is_genuine_wish: bool(),
            safety: en(['ok', 'refuse']),
            kind: en(['web_page', 'browser_extension', 'editor_plugin', 'cli', 'needs_backend', 'not_software']),
            star_potential: en(['high', 'medium', 'low'], 'would developers star an open-source GitHub repo of this?'),
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
    // pick order: genuine + safe + buildable kind (filtered above by BUILD_KINDS), then star_potential,
    // then unique askers + upvotes — all counted in code, never left to the model
    const ranked: { app: App; rank: number }[] = []
    for (const w of grouped.wishes) {
      if (!w.is_genuine_wish || w.safety !== 'ok' || !BUILD_KINDS.has(w.kind)) continue
      const hit = hits[w.hit_indexes[0] ?? -1]
      if (!hit) continue
      const author = hit.author || w.wisher_author || authorFromText(hit.excerpts.join(' ')) || ''
      const app = newApp(w.one_line_spec, author, 'reddit', hit.url, slugs)
      if (!app.slug) continue // shortSlug can return '' if the spec has no alphanumerics at all
      slugs.add(app.slug)
      app.spec = w.one_line_spec
      app.wish.text = scrub(hit.title ?? w.one_line_spec, 200).replace(/\s*:\s*r\/\w+\s*$/, '')
      app.kind = w.kind
      app.upvotes = hit.score
      app.starPotential = w.star_potential
      // best-effort askers straight from the grouped hits' own authors; validate() will replace these
      // with its own Parallel-checked list, but they're real (not model-guessed) and worth keeping meanwhile
      app.askers = dedupe(w.hit_indexes.map((i) => hits[i]).filter((h): h is SourceHit => !!h && !!h.author).map((h) => ({ author: h.author, url: h.url, quote: scrub(h.excerpts.join(' '), 160), source: `r/${h.subreddit}`, postedAt: h.publish_date ?? undefined })))
      ranked.push({ app, rank: (STAR_RANK[w.star_potential] ?? 0) * 1000 + uniqueAuthors(app.askers) * 10 + (hit.score ?? 0) })
    }
    ranked.sort((a, b) => b.rank - a.rank)
    const apps = ranked.map((r) => r.app)

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
    // fail soft: a bad sweep shouldn't take the loop down, just skip this round
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
  console.log(`[parallel] validating ${top.length} of ${candidates.length} wishes at once`)
  // all at once: the slowest check sets the wait, not the sum of them
  const checked = await Promise.all(top.map(async (app) => {
    try {
      const { askers, why, prior, existing } = await findAskers(app)
      app.askers = askers.length ? askers : app.askers
      app.why = why
      app.spec ??= app.wish.text // an owner's own idea arrives with no spec; the approval text and the launch post need one
      if (!app.wish.author) app.wish.author = askers.find((a) => a.url === canon(app.wish.url))?.author ?? askers[0]?.author ?? 'someone'
      console.log(`[parallel] ${app.slug}: ${uniqueAuthors(app.askers)} unique askers, prior art ${prior}`)
      // Existing tools don't rule a wish out: an open-source, free, no-signup version is worth building anyway.
      if (existing?.name) app.existingTool = existing
      return app
    } catch (e) {
      console.log(`[parallel] validate ${app.slug} failed: ${(e as Error).message}`)
      return seeded.has(app.slug) ? app : undefined
    }
  }))
  const out = checked.filter((a): a is App => !!a)
  return out.sort((a, b) => Number(seeded.has(b.slug)) - Number(seeded.has(a.slug)) || uniqueAuthors(b.askers) - uniqueAuthors(a.askers) || (b.upvotes ?? 0) - (a.upvotes ?? 0))
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
