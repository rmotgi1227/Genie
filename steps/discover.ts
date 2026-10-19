// PARALLEL — discover, validate, triage.
//   discover: Parallel Search on reddit.com for "I wish there was a tool…" posts, then one Responses call
//             groups the hits into distinct wishes and drops promos, jokes and non-software.
//   validate: per wish, Parallel Search for other people asking for the same thing, then one Responses call
//             (restricted to reddit.com) pulls the author of each thread and checks prior art.
//             Unique authors are counted in code, never by a model.
//   triage:   deterministic for now (regex). A model version can replace it if it's ever needed.
// Reddit's own JSON/RSS endpoints are blocked without auth, so authors come from Parallel.
// With no PARALLEL_API_KEY the fake versions in discover.fake.ts run instead.
import { writeFileSync, mkdirSync } from 'node:fs'
import type { App, Asker } from '../lib/types'
import { advance, slugify, uniqueAuthors } from '../lib/state'
import { parallelEnabled, search, respond, obj, str, bool, en, arr, type SearchHit } from '../lib/parallel'
import { scrub } from '../lib/guard'
import * as fake from './discover.fake'

const REDDIT = ['reddit.com']
const TOP_N = Number(process.env.VALIDATE_TOP_N ?? 3)
const DAYS_BACK = Number(process.env.DISCOVER_DAYS_BACK ?? 120)

export function newApp(text: string, author: string, source: 'reddit' | 'imessage', url: string): App {
  return { slug: slugify(text), wish: { text, author, url, source }, askers: [], stage: 'found', issues: [], version: 0 }
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
  console.log('[parallel] searching reddit for wishes')
  const after = new Date(Date.now() - DAYS_BACK * 864e5).toISOString().slice(0, 10)
  const hits = (await search({ objective: DISCOVERY_OBJECTIVE, queries: DISCOVERY_QUERIES, domains: REDDIT, maxResults: 25, afterDate: after }))
    .filter((h) => isThread(h.url))
  dump('discover.search', hits)
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

  const apps: App[] = []
  const slugs = new Set<string>()
  for (const w of grouped.wishes) {
    if (!w.is_genuine_wish || w.safety !== 'ok' || w.buildability !== 'single_page') continue
    const hit = hits[w.hit_indexes[0] ?? -1]
    if (!hit) continue
    const author = w.wisher_author || authorFromText(hit.excerpts.join(' ')) || ''
    const app = newApp(w.one_line_spec, author, 'reddit', canon(hit.url))
    if (!app.slug || slugs.has(app.slug)) continue // two groups for the same wish would share a slug and corrupt state
    slugs.add(app.slug)
    app.spec = w.one_line_spec
    app.wish.text = scrub(hit.title ?? w.one_line_spec, 200).replace(/\s*:\s*r\/\w+\s*$/, '')
    apps.push(app)
  }
  console.log(`[parallel] ${apps.length} buildable wishes`)
  return apps
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
  const hits = (await search({
    objective: `Reddit posts by different people asking for or wishing for ${spec}. Only posts where the author wants this tool to exist.`,
    queries: [`wish there was ${spec}`, `is there an app for ${spec}`, `looking for a tool ${spec}`],
    domains: REDDIT,
    maxResults: 12,
  })).filter((h) => isThread(h.url))
  const byUrl = new Map<string, SearchHit>()
  for (const h of hits) byUrl.set(canon(h.url), h)
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

  const askers: Asker[] = []
  for (const t of x.threads) {
    if (!t.asks_for_it) continue
    const hit = byUrl.get(canon(t.url))
    const author = t.author || authorFromText(hit?.excerpts.join(' ') ?? '') || ''
    if (!author) continue
    askers.push({ author, url: canon(t.url), quote: scrub(t.quote || hit?.title || '', 160), source: `r/${t.subreddit || sub(t.url)}`, postedAt: hit?.publish_date ?? undefined })
  }
  return { askers: dedupe(askers), why: x.why_build_it, prior: x.prior_art, existing: x.best_existing_tool }
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
