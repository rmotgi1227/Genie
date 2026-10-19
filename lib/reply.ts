// The approval switch. Deterministic: no model reads the owner's reply.
export type Reply = 'yes' | 'no' | 'different' | 'idea' | 'unknown'

export function routeReply(text: string): Reply {
  const r = text.trim().toLowerCase()
  if (/^(y|yes|yep|yeah|build|go|post|add|do it|ship|👍)$/u.test(r)) return 'yes'
  if (/^(n|no|nope|skip|pass|👎)$/u.test(r)) return 'no'
  if (/^(d|different|another|next|other)$/.test(r)) return 'different'
  if (r.length >= 8) return 'idea'
  return 'unknown'
}

export const HELP = 'Reply YES, NO, DIFFERENT, or text me your own idea'
export const HELP_POST = 'Reply YES, NO, or tell me what to change'
export const HELP_ISSUE = 'Reply YES or NO'
