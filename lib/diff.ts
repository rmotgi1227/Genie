// Line diff for the board: what Cline changed in index.html, as green/red lines. Real code, runs on
// the file before and after every change, whoever made it. Plain LCS over lines; the files are small.
import type { DiffLine } from './types'

export function diffLines(before: string, after: string, context = 2, cap = 80): { lines: DiffLine[]; added: number; removed: number } {
  const a = before.split('\n'), b = after.split('\n')
  const n = a.length, m = b.length
  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..]
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const all: DiffLine[] = []
  let i = 0, j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { all.push({ type: ' ', text: a[i] }); i++; j++ }
    else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) { all.push({ type: '+', text: b[j] }); j++ }
    else { all.push({ type: '-', text: a[i] }); i++ }
  }
  const added = all.filter((l) => l.type === '+').length, removed = all.filter((l) => l.type === '-').length
  // keep only changed lines with a little context, and mark the gaps
  const keep = new Set<number>()
  all.forEach((l, k) => { if (l.type !== ' ') for (let c = -context; c <= context; c++) keep.add(k + c) })
  const lines: DiffLine[] = []
  let last = -1
  for (let k = 0; k < all.length; k++) {
    if (!keep.has(k)) continue
    if (last >= 0 && k !== last + 1) lines.push({ type: '@', text: `… ${k - last - 1} lines` })
    lines.push({ ...all[k], text: all[k].text.replace(/\t/g, '  ').slice(0, 110) })
    last = k
  }
  if (lines.length > cap) { const cut = lines.length - cap; lines.length = cap; lines.push({ type: '@', text: `… ${cut} more lines` }) }
  return { lines, added, removed }
}
