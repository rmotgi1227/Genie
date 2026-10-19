// Text from Reddit and bug reports goes into model prompts (Parallel, Cline). Nothing from the
// internet gets to tell those models what to do: suspicious lines are dropped, and a report that
// is itself an instruction is ignored. Cheap regexes, no model involved.

const PATTERNS = [
  /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|messages?)/i,
  /disregard\s+(the\s+|all\s+|your\s+)?(previous|prior|above|system|earlier)/i,
  /forget\s+(everything|all|your)\s+(you|instructions|rules)/i,
  /\byou are now\b/i,
  /\bnew\s+(instructions?|rules?|task)\s*:/i,
  /\bsystem\s+prompt\b/i,
  /\b(as|act as|pretend to be)\s+(an?\s+)?(admin|administrator|developer|root|system|the owner)\b/i,
  /\[\s*(INST|SYSTEM|ASSISTANT|\/INST)\s*\]/i,
  /<\|?\s*(system|im_start|im_end|endoftext)\s*\|?>/i,
  /(print|reveal|show|output|leak|send)\b.{0,40}\b(api\s*key|secret|token|password|credential|\.env)/i,
  /\b(curl|wget|fetch|exec|eval|child_process)\b.{0,20}(https?:\/\/|\(|\s-)/i,
  /\brm\s+-rf\b|\bformat\s+c:|\bdel\s+\/f\b/i,
  /\bbase64\s*(decode|-d)\b/i,
]

export const suspicious = (text: string): boolean => PATTERNS.some((p) => p.test(text))

// Drops suspicious lines, collapses whitespace, caps length. Safe to put in a prompt.
export function scrub(text: string, max = 1200): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !suspicious(line))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}
