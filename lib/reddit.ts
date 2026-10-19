// COMPOSIO REDDIT (read side) — fills in the author Parallel's excerpts sometimes miss, and (below)
// the two sources discover() now leans on most: "what tool do you wish existed" threads and a handful
// of subreddit listings, both read straight from Reddit with no Parallel search involved.
// REDDIT_GET_POSTS_BY_FULLNAME (fullnames: string[], each "t3_<id>") — slug confirmed, response shape not. // VERIFY response shape
import { tool, composioEnabled } from './composio'

export const postIdFromUrl = (url: string): string | undefined => url.match(/\/comments\/([a-z0-9]+)/i)?.[1]

type RedditListing = { data?: { children?: { data?: { author?: string; title?: string; created_utc?: number } }[] } }

const cache = new Map<string, { author: string; title: string; created?: string } | undefined>()

export async function redditPost(url: string): Promise<{ author: string; title: string; created?: string } | undefined> {
  if (!composioEnabled()) return undefined
  const id = postIdFromUrl(url)
  if (!id) return undefined
  if (cache.has(id)) return cache.get(id)
  try {
    const r = await tool<RedditListing>('REDDIT_GET_POSTS_BY_FULLNAME', { fullnames: [`t3_${id}`] }) // VERIFY response shape
    const post = r.data?.children?.[0]?.data
    const out = post?.author ? { author: post.author, title: post.title ?? '', created: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : undefined } : undefined
    cache.set(id, out) // a confirmed "no author" result is worth caching; a thrown error below is not
    return out
  } catch (e) {
    console.log(`[composio] reddit get post ${id} failed: ${(e as Error).message}`)
    return undefined // don't cache: a transient failure (rate limit, timeout) should be retryable later
  }
}

// Runs `fn` over `items` with at most `limit` in flight, so a burst of thread lookups (findAskers,
// discover) doesn't fire 20+ Composio calls at once. Order of `out` matches `items`.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

// ── REDDIT_RETRIEVE_REDDIT_POST — a subreddit's listing (sort new/hot/top), for "does anyone actually
// post requests in r/AppIdeas" style sources. Verified live Oct 2026: max_results (not limit), default 5.
export type RedditPost = {
  id: string
  title: string
  selftext?: string
  author: string
  created_utc?: number
  permalink: string
  num_comments?: number
  score?: number
  subreddit: string
}
type RedditPostsListing = { data?: { children?: { data?: RedditPost }[] } }

export async function redditListing(subreddit: string, opts: { sort?: 'new' | 'hot' | 'top'; maxResults?: number; timeFilter?: string } = {}): Promise<RedditPost[]> {
  if (!composioEnabled()) return []
  try {
    const r = await tool<RedditPostsListing>('REDDIT_RETRIEVE_REDDIT_POST', {
      subreddit,
      sort: opts.sort ?? 'new',
      max_results: opts.maxResults ?? 50,
      time_filter: opts.timeFilter ?? 'month',
    })
    return (r.data?.children ?? []).map((c) => c.data).filter((d): d is RedditPost => !!d)
  } catch (e) {
    console.log(`[composio] reddit listing r/${subreddit} failed: ${(e as Error).message}`)
    return []
  }
}

// ── REDDIT_RETRIEVE_POST_COMMENTS — a thread's post plus its top-level comments, for "what tool do you
// wish existed" megathreads where every top comment is its own wish, asked by its own author.
export type RedditComment = {
  id: string
  name?: string // "t1_<id>"
  author: string
  body: string
  score?: number
  depth?: number
  permalink: string
  created_utc?: number
}
type RedditCommentsResponse = {
  post_listing?: { data?: { children?: { data?: RedditPost }[] } }
  comments_listing?: { data?: { children?: { kind?: string; data?: RedditComment }[] } }
}

export async function redditComments(postId: string, opts: { limit?: number } = {}): Promise<{ post?: RedditPost; comments: RedditComment[] }> {
  if (!composioEnabled()) return { comments: [] }
  try {
    const r = await tool<RedditCommentsResponse>('REDDIT_RETRIEVE_POST_COMMENTS', {
      article: postId,
      sort: 'top',
      depth: 1,
      limit: opts.limit ?? 30,
    })
    const post = r.post_listing?.data?.children?.[0]?.data
    const comments = (r.comments_listing?.data?.children ?? [])
      .filter((c) => c.kind === 't1')
      .map((c) => c.data)
      .filter((d): d is RedditComment => !!d)
    return { post, comments }
  } catch (e) {
    console.log(`[composio] reddit comments ${postId} failed: ${(e as Error).message}`)
    return { comments: [] }
  }
}

// ── cheap regex classifiers, shared by the subreddit-listing source and spikes/discover.check.ts ──

// "is there a/an … app/tool/extension/plugin/site", "looking for", "someone should/make/build",
// "i wish", "does … exist" — the shapes people use to ask Reddit for a tool that doesn't exist yet.
const REQUEST_PATTERNS = [
  /\bis there\s+an?\b[\s\S]{0,60}\b(app|tool|extension|plugin|site|website)\b/i,
  /\blooking for\b[\s\S]{0,60}\b(app|tool|extension|plugin|site|website)\b/i,
  /\bsomeone\s+(should|needs? to)?\s*(make|build)\b/i,
  /\bi wish\b/i,
  /\bdoes\b[\s\S]{0,40}\bexist\b/i,
]
export const looksLikeRequest = (text: string): boolean => REQUEST_PATTERNS.some((p) => p.test(text))

// "I built/made/launched", "introducing", a version number ("v1.2") — a launch post, not a wish,
// even if it happens to also contain "I wish" in the comments people leave on it.
const LAUNCH_PATTERNS = [/\bi('ve| have)?\s+(built|made|launched|shipped|created)\b/i, /\bintroducing\b/i, /\bv\d+(\.\d+){0,2}\b/i, /\bnow available\b/i]
export const looksLikeLaunch = (text: string): boolean => LAUNCH_PATTERNS.some((p) => p.test(text))

export const isRequestPost = (title: string, selftext = ''): boolean => {
  const text = `${title} ${selftext}`
  return looksLikeRequest(text) && !looksLikeLaunch(text)
}

// Obvious one-liner jokes/meta that aren't a wish of their own, even as a top comment on a wish thread.
const JOKE_PATTERNS = [
  /^(lol+|lmao+|haha+)\b/i,
  /\bunderrated comment\b/i,
  /\bthis is the way\b/i,
  /\bfound the (bot|marketer|developer)\b/i,
  /\btake my upvote\b/i,
  /\busername checks out\b/i,
  /^same\.?$/i,
  /^this\.?$/i,
]
export const looksLikeJoke = (body: string): boolean => JOKE_PATTERNS.some((p) => p.test(body.trim()))
