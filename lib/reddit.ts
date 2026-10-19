// COMPOSIO REDDIT (read side) — fills in the author Parallel's excerpts sometimes miss.
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
