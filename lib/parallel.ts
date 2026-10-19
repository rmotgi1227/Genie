// Thin Parallel client. Shapes verified against parallel-web@1.3.5 types and docs.parallel.ai (Oct 2026).
//   Search:    POST /v1/search      header x-api-key           ~3s (advanced) / ~700ms (fast)
//   Responses: POST /v1/responses   header Authorization Bearer ~5-10s (effort low), structured JSON output
// Task API (/v1/tasks/runs, lite = 10s-2min) is slower than Responses for the same job, so Genie uses Responses.

const BASE = 'https://api.parallel.ai/v1'
const KEY = process.env.PARALLEL_API_KEY ?? ''

export const parallelEnabled = () => KEY.length > 0

export type SearchHit = { url: string; title: string | null; publish_date: string | null; excerpts: string[] }

export async function search(opts: {
  objective: string
  queries: string[]
  domains?: string[]
  maxResults?: number
  afterDate?: string // YYYY-MM-DD
  mode?: 'turbo' | 'fast' | 'basic' | 'advanced'
  maxCharsPerResult?: number
}): Promise<SearchHit[]> {
  const res = await fetch(`${BASE}/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify({
      objective: opts.objective,
      search_queries: opts.queries,
      mode: opts.mode ?? 'advanced',
      advanced_settings: {
        max_results: opts.maxResults ?? 10,
        source_policy: { include_domains: opts.domains, after_date: opts.afterDate },
        excerpt_settings: { max_chars_per_result: opts.maxCharsPerResult ?? 1500 },
      },
    }),
  })
  if (!res.ok) throw new Error(`parallel search ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as { results: SearchHit[]; warnings?: unknown }
  if (data.warnings) console.log('[parallel] warnings:', JSON.stringify(data.warnings).slice(0, 300))
  return data.results ?? []
}

// Structured answer from the Responses API. `schema` must be an object schema with every property
// in `required` and additionalProperties: false (Parallel's rule). Web research is on by default;
// `domains` restricts it.
export async function respond<T>(opts: {
  input: string
  schema: Record<string, unknown>
  name?: string
  domains?: string[]
  effort?: 'low' | 'medium' | 'high'
}): Promise<T> {
  const body: Record<string, unknown> = {
    model: 'parallel',
    input: opts.input,
    reasoning: { effort: opts.effort ?? 'low' },
    text: { format: { type: 'json_schema', name: opts.name ?? 'answer', schema: opts.schema } },
  }
  if (opts.domains) body.tools = [{ type: 'web_search', filters: { allowed_domains: opts.domains } }]
  const res = await fetch(`${BASE}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`parallel responses ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as { output_text?: string; output?: { type: string; content?: { type: string; text?: string }[] }[] }
  const text =
    data.output_text ??
    data.output?.find((o) => o.type === 'message')?.content?.find((c) => typeof c.text === 'string')?.text
  if (!text) throw new Error(`parallel responses: no text in ${JSON.stringify(data).slice(0, 300)}`)
  return JSON.parse(text) as T
}

// Schema helper: Parallel wants every property required and no extras.
export const obj = (props: Record<string, unknown>) => ({
  type: 'object',
  properties: props,
  required: Object.keys(props),
  additionalProperties: false,
})
export const str = (description?: string) => ({ type: 'string', description })
export const bool = (description?: string) => ({ type: 'boolean', description })
export const en = (values: string[], description?: string) => ({ type: 'string', enum: values, description })
export const arr = (items: unknown, description?: string) => ({ type: 'array', items, description })
