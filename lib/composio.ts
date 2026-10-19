// COMPOSIO — one helper for every tool call. Reddit and GitHub are connected in the Composio dashboard
// under COMPOSIO_USER_ID (default "default"). Throws on a failed call so callers can retry or skip.
import { Composio } from '@composio/core'

let client: Composio | undefined
export const composioEnabled = () => !!process.env.COMPOSIO_API_KEY

export async function tool<T = any>(slug: string, args: Record<string, unknown>): Promise<T> {
  client ??= new Composio({ apiKey: process.env.COMPOSIO_API_KEY })
  const r = await client.tools.execute(slug, {
    userId: process.env.COMPOSIO_USER_ID ?? 'default',
    arguments: args,
    dangerouslySkipVersionCheck: true,
  })
  if (!r.successful) throw new Error(`${slug}: ${r.error ?? 'failed'}`)
  return r.data as T
}
