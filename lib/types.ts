// Shared contract between the core loop and every step.

export type Stage =
  | 'found'
  | 'validating'
  | 'awaiting_approval'
  | 'building'
  | 'testing'
  | 'awaiting_post_approval'
  | 'launched'
  | 'maintaining'
  | 'exists'
  | 'rejected'
  | 'shelved'
  | 'failed'

export type Source = 'reddit' | 'github' | 'imessage'

export type Asker = { author: string; url: string; quote: string; source: string; postedAt?: string; foundAt?: number }

// A step's timing. Every sponsor step records one so the board can say "Cline built it in 48s".
export type Span = { startedAt: number; endedAt?: number }
// A Reddit post as it came back from search. `query` is the search that found it, `foundAt` when.
export type Hit = { title: string; subreddit: string; author?: string; url: string; postedAt?: string; query?: string; foundAt?: number }
// One search Parallel ran, as it ran.
export type Search = Span & { query: string; found: number }
// One line of what Cline is doing, from its --json output: a thought in plain words, a file it read,
// or an edit it made. Real mapping: text/reasoning blocks → 'thought', read_file → 'read', write_to_file /
// replace_in_file → 'edit' with the path.
export type FeedLine = { t: number; text: string; file?: string; kind?: 'thought' | 'read' | 'edit' }
// One line of the diff the board shows: added, removed, context, or a gap marker.
export type DiffLine = { type: '+' | '-' | ' ' | '@'; text: string }
// A tool Parallel looked at during the prior-art check.
export type Checked = { name: string; url: string; verdict: string }

// A report on a live app, from the moment it arrives until Genie replies on it.
//   triaged → awaiting_approval → fixing → testing → shipping → fixed
//                              ↘ declined (owner said NO)        ignored: noise or an injection attempt
export type IssueStatus = 'triaged' | 'awaiting_approval' | 'fixing' | 'testing' | 'shipping' | 'fixed' | 'declined' | 'ignored'

export type Issue = {
  id: string
  source: Source
  kind: 'bug' | 'feature'
  text: string // what they wrote, scrubbed
  title: string // short form for the changelog and the board, e.g. "dark mode"
  status: IssueStatus
  author?: string
  url?: string
  reportedAt?: number
  askedAt?: number // when the owner was texted about it
  repliedAt?: number
  fixedAt?: number
  resolvedAt?: number // fixed, declined or ignored
  version?: number // the version that shipped the change
  before?: string // screenshot before the change, /apps/<slug>/v1.png
  after?: string // screenshot after, /apps/<slug>/v2.png
  // What each sponsor did on this issue, as it happened.
  change?: Span & { feed: FeedLine[] } // Cline
  diff?: { file: string; lines: DiffLine[]; added: number; removed: number } // what actually changed in the file
  test?: Span & { checks: Check[] } // Playwright
  publish?: Span // GitHub push
  reply?: { text: string; url?: string; at: number } // the comment Genie left
  closedAt?: number
}

// What the owner was asked and what they replied. The board mirrors these.
export type ApprovalKind = 'build' | 'post' | 'issue'
export type Approval = { kind: ApprovalKind; issueId?: string; text: string; image?: string; askedAt: number; reply?: string; repliedAt?: number }

// One line of the build checklist the board shows instead of logs.
export type Check = { label: string; ok: boolean; at?: number }

export type App = {
  slug: string
  wish: { text: string; author: string; url: string; source: 'reddit' | 'imessage' }
  spec?: string // one-line spec from triage, doubles as the app's name
  why?: string // one line on why this wish, goes in the approval text
  kind?: string // discover()'s buildability label: 'web_page' | 'browser_extension' | 'editor_plugin' | 'cli' | 'needs_backend' | 'not_software'
  upvotes?: number // the wish's own Reddit score, carried through from discover() for ranking
  starPotential?: 'high' | 'medium' | 'low' // discover()'s guess at whether developers would star an open-source repo of this
  askers: Asker[]
  stage: Stage
  url?: string // served by our box: /apps/<slug>/
  repo?: string // GitHub repo name under GITHUB_ORG, set on first publish
  pagesUrl?: string // public Vercel URL used in Reddit posts
  screenshot?: string
  launchPostId?: string
  wisherCommentId?: string
  issues: Issue[]
  version: number
  changelog?: { version: number; text: string; by?: string; at: number }[]
  // Board-only fields. The loop fills them, nothing reads them back.
  stageAt?: Partial<Record<Stage, number>>
  approvals?: Approval[]
  checks?: Check[]
  existingTool?: { name: string; url: string; why: string }
  launchTitle?: string
  launchUrl?: string
  seeded?: boolean // a library app created by --reset in fake mode, "built yesterday"
  // What each sponsor did on this wish, as it happened. The board shows these, nothing reads them back.
  found?: Span // Parallel, the search that turned this wish up (a copy of state.discovery at the time)
  validation?: Span & { queries: string[]; searches: Search[]; checked: Checked[]; priorArt?: 'none' | 'partial' | 'strong_existing_tool'; verdict?: string } // Parallel
  build?: Span & { feed: FeedLine[] } // Cline
  test?: Span // Playwright (the checks are app.checks)
  launch?: Span // GitHub push + Composio post
}

export type State = {
  candidates: App[]
  apps: App[]
  pendingApproval?: { slug: string; kind: ApprovalKind; issueId?: string }
  builder?: { slug: string } // the wish the build loop is on right now (board's left side)
  discovery?: Span & { queries: string[]; searches: Search[]; hits: Hit[] } // the last Parallel sweep over Reddit, query by query
  nextDiscoveryAt?: number // when the build loop sweeps Reddit again
  watch?: { reddit?: number; github?: number } // last time each was checked; served live, not saved
  events?: { t: number; slug: string; stage: Stage }[] // every advance(), for the board's replay
  sample?: boolean // true once any fake step has run
}

// A bug report or feature request as it arrives, before triage.
export type Report = { id: string; slug: string; source: Source; text: string; author?: string; url?: string }

export type TestResult = { ok: boolean; error?: string; screenshot?: string; checks?: Check[] }
