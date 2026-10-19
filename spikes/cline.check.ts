// `npx tsx spikes/cline.check.ts` — feeds canned `cline --json` NDJSON lines through parseClineLine and
// checkGuardrail and checks what they produce. Never spawns cline.
import assert from 'node:assert'
import { resolve } from 'node:path'
import { parseClineLine, checkGuardrail } from '../steps/build'

let n = 0
let ok = 0
function check(label: string, line: string, want: { kind?: string; file?: string; undefined?: true; textIncludes?: string }) {
  n++
  try {
    const got = parseClineLine(line)
    if (want.undefined) {
      assert.strictEqual(got, undefined, `expected undefined, got ${JSON.stringify(got)}`)
    } else {
      assert.ok(got, 'expected a FeedLine, got undefined')
      if (want.kind) assert.strictEqual(got!.kind, want.kind)
      if (want.file) assert.strictEqual(got!.file, want.file)
      if (want.textIncludes) assert.ok(got!.text.includes(want.textIncludes), `"${got!.text}" does not include "${want.textIncludes}"`)
    }
    ok++
    console.log(`ok   - ${label}`)
  } catch (e) {
    console.log(`FAIL - ${label}: ${(e as Error).message}`)
  }
}

// 1. content_start text chunk → ignored (streaming spam)
check('content_start text chunk ignored', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'content_start', contentType: 'text', text: 'One ' } }), { undefined: true })

// 2. content_end text → thought
check('content_end text → thought', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'content_end', contentType: 'text', text: 'One static page, no backend.' } }), { kind: 'thought', textIncludes: 'static page' })

// 3. content_end reasoning → thought
check('content_end reasoning → thought', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'content_end', contentType: 'reasoning', reasoning: 'Thinking about the layout.' } }), { kind: 'thought', textIncludes: 'layout' })

// 4. read_files with {files:[{path}]}
check('read_files {files:[{path}]}', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'content_start', contentType: 'tool', toolName: 'read_files', input: { files: [{ path: 'CONTRACT.md' }] } } }), { kind: 'read', file: 'CONTRACT.md' })

// 5. read_files string form
check('read_files string form', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'content_start', contentType: 'tool', toolName: 'read_files', input: 'index.html' } }), { kind: 'read', file: 'index.html' })

// 6. editor create index.html (no old_text)
check('editor create → Writing', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'content_start', contentType: 'tool', toolName: 'editor', input: { path: 'index.html', new_text: '<html>' } } }), { kind: 'edit', file: 'index.html', textIncludes: 'Writing' })

// 7. editor with old_text → Editing
check('editor with old_text → Editing', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'content_start', contentType: 'tool', toolName: 'editor', input: { path: 'index.html', old_text: 'foo', new_text: 'bar' } } }), { kind: 'edit', file: 'index.html', textIncludes: 'Editing' })

// 8. apply_patch with an Update File marker
check('apply_patch Update File', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'content_start', contentType: 'tool', toolName: 'apply_patch', input: { input: '*** Update File: index.html\n@@\n-old\n+new\n' } } }), { kind: 'edit', file: 'index.html' })

// 9. legacy write_to_file
check('legacy write_to_file', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'content_start', contentType: 'tool', toolName: 'write_to_file', input: { path: 'index.html' } } }), { kind: 'edit', file: 'index.html', textIncludes: 'Writing' })

// 10. run_commands → shown as "Running …", first line only, paths trimmed to the file name
check('run_commands → Running', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'content_start', contentType: 'tool', toolName: 'run_commands', input: { command: 'wc -l /Users/x/apps/a/index.html\necho done' } } }), { kind: 'read', textIncludes: 'Running wc -l index.html' })

// 11. usage → ignored
check('usage ignored', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'usage', inputTokens: 10, outputTokens: 20 } }), { undefined: true })

// 12. run_result → ignored
check('run_result ignored', JSON.stringify({ ts: 't', type: 'run_result', finishReason: 'completed', text: 'done' }), { undefined: true })

// 13. stderr error line
check('stderr error line', JSON.stringify({ ts: 't', type: 'error', message: 'request timed out' }), { kind: 'thought', textIncludes: 'timed out' })

// 14. "not json" junk
check('junk non-json ignored', 'not json', { undefined: true })

// 15. empty line
check('empty line ignored', '', { undefined: true })

// ─────────────────────────── guardrail checks ───────────────────────────

const appRoot = resolve('apps/some-app')
function checkGuard(label: string, line: string, want: string | undefined) {
  n++
  const got = checkGuardrail(line, appRoot)
  if (got === want) {
    ok++
    console.log(`ok   - ${label}`)
  } else {
    console.log(`FAIL - ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
  }
}

// 16. run_commands → not a kill (real runs check their own work with shell commands)
checkGuard('run_commands → allowed', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'content_start', contentType: 'tool', toolName: 'run_commands', input: { command: 'wc -l index.html' } } }), undefined)

// 17. legacy execute_command → not a kill either
checkGuard('legacy execute_command → allowed', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'content_start', contentType: 'tool', toolName: 'execute_command', input: { command: 'ls' } } }), undefined)

// 18. editor writing inside the app dir → no violation
checkGuard('editor inside app dir → ok', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'content_start', contentType: 'tool', toolName: 'editor', input: { path: 'index.html', new_text: '<html>' } } }), undefined)

// 19. editor escaping the app dir with ../ → violation
checkGuard('editor escaping app dir → violation', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'content_start', contentType: 'tool', toolName: 'editor', input: { path: '../../etc/passwd', new_text: 'x' } } }), 'cline tried to edit outside the app dir: ../../etc/passwd')

// 20. apply_patch touching a path outside the app dir → violation
checkGuard('apply_patch escaping app dir → violation', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'content_start', contentType: 'tool', toolName: 'apply_patch', input: { input: '*** Update File: ../secrets.txt\n' } } }), 'cline tried to edit outside the app dir: ../secrets.txt')

// 21. read_files is not an edit tool, so no path check applies even if it reaches outside
checkGuard('read_files not guarded', JSON.stringify({ ts: 't', type: 'agent_event', event: { type: 'content_start', contentType: 'tool', toolName: 'read_files', input: { files: [{ path: '../secrets.txt' }] } } }), undefined)

console.log(`cline parser: ${ok}/${n} ok`)
if (ok !== n) process.exit(1)
