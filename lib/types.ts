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

export type Asker = { author: string; url: string; quote: string; source: string; postedAt?: string }

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
}

// What the owner was asked and what they replied. The board mirrors these.
export type ApprovalKind = 'build' | 'post' | 'issue'
export type Approval = { kind: ApprovalKind; issueId?: string; text: string; image?: string; askedAt: number; reply?: string; repliedAt?: number }

// One line of the build checklist the board shows instead of logs.
export type Check = { label: string; ok: boolean }

export type App = {
  slug: string
  wish: { text: string; author: string; url: string; source: 'reddit' | 'imessage' }
  spec?: string // one-line spec from triage, doubles as the app's name
  why?: string // one line on why this wish, goes in the approval text
  askers: Asker[]
  stage: Stage
  url?: string // served by our box: /apps/<slug>/
  pagesUrl?: string // public GitHub Pages link used in Reddit posts
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
}

export type State = {
  candidates: App[]
  apps: App[]
  pendingApproval?: { slug: string; kind: ApprovalKind; issueId?: string }
  builder?: { slug: string } // the wish the build loop is on right now (board's left side)
  events?: { t: number; slug: string; stage: Stage }[] // every advance(), for the board's replay
  sample?: boolean // true once any fake step has run
}

// A bug report or feature request as it arrives, before triage.
export type Report = { id: string; slug: string; source: Source; text: string; author?: string; url?: string }

export type TestResult = { ok: boolean; error?: string; screenshot?: string; checks?: Check[] }
