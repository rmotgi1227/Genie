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

export type Issue = {
  id: string
  source: Source
  text: string
  status: 'triaged' | 'fixing' | 'fixed' | 'ignored'
  reportedAt?: number
  fixedAt?: number
  version?: number // the version that shipped the fix
}

// What the owner was asked and what they replied. The board mirrors these.
export type Approval = { kind: 'build' | 'post'; text: string; image?: string; askedAt: number; reply?: string; repliedAt?: number }

// One line of the build checklist the board shows instead of logs.
export type Check = { label: string; ok: boolean }

export type App = {
  slug: string
  wish: { text: string; author: string; url: string; source: 'reddit' | 'imessage' }
  spec?: string // one-line spec from triage
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
  // Board-only fields. The loop fills them, nothing reads them back.
  stageAt?: Partial<Record<Stage, number>>
  approvals?: Approval[]
  checks?: Check[]
  existingTool?: { name: string; url: string; why: string }
  launchTitle?: string
  launchUrl?: string
}

export type State = {
  candidates: App[]
  apps: App[]
  pendingApproval?: { slug: string; kind: 'build' | 'post' }
  events?: { t: number; slug: string; stage: Stage }[] // every advance(), for the board's replay
  sample?: boolean // true once any fake step has run
}

// A bug report or feature request as it arrives, before triage.
export type Report = { id: string; source: Source; text: string; author?: string; url?: string }

export type TestResult = { ok: boolean; error?: string; screenshot?: string; checks?: Check[] }
