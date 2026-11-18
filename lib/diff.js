/**
 * Small line/field diff used by the memory panel and CLI.
 * Texts are at most a few thousand lines; longer inputs fall back to a
 * prefix/suffix diff so the UI never allocates an LCS matrix for huge values.
 */

const MAX_MATRIX_LINES = 600
const MAX_OUTPUT_LINES = 400

/**
 * @param {string} before
 * @param {string} after
 * @returns {{ type: 'context' | 'add' | 'del', text: string }[]}
 */
export function diffLines(before, after) {
  const beforeLines = String(before ?? '').split('\n')
  const afterLines = String(after ?? '').split('\n')
  if (beforeLines.length > MAX_MATRIX_LINES || afterLines.length > MAX_MATRIX_LINES) {
    return prefixSuffixDiff(beforeLines, afterLines)
  }
  const rows = beforeLines.length
  const cols = afterLines.length
  const width = cols + 1
  const table = new Uint32Array((rows + 1) * width)
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i * width + j] = beforeLines[i] === afterLines[j]
        ? table[(i + 1) * width + (j + 1)] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)])
    }
  }
  const lines = []
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (beforeLines[i] === afterLines[j]) {
      lines.push({ type: 'context', text: beforeLines[i] })
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      lines.push({ type: 'del', text: beforeLines[i] })
      i += 1
    } else {
      lines.push({ type: 'add', text: afterLines[j] })
      j += 1
    }
  }
  while (i < rows) { lines.push({ type: 'del', text: beforeLines[i] }); i += 1 }
  while (j < cols) { lines.push({ type: 'add', text: afterLines[j] }); j += 1 }
  return trim(lines)
}

/** Cheap fallback for large texts: common prefix/suffix with the middle replaced. */
function prefixSuffixDiff(beforeLines, afterLines) {
  let prefix = 0
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) suffix += 1
  const lines = []
  for (let i = 0; i < prefix; i += 1) lines.push({ type: 'context', text: beforeLines[i] })
  for (let i = prefix; i < beforeLines.length - suffix; i += 1) lines.push({ type: 'del', text: beforeLines[i] })
  for (let i = prefix; i < afterLines.length - suffix; i += 1) lines.push({ type: 'add', text: afterLines[i] })
  for (let i = beforeLines.length - suffix; i < beforeLines.length; i += 1) lines.push({ type: 'context', text: beforeLines[i] })
  return trim(lines)
}

/**
 * Keep every changed line with a little context; if that is still too large,
 * keep the head/tail and annotate the cut.
 */
function trim(lines) {
  if (lines.length <= MAX_OUTPUT_LINES) return lines
  const keep = new Set()
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].type === 'context') continue
    for (let offset = Math.max(0, index - 3); offset <= Math.min(lines.length - 1, index + 3); offset += 1) keep.add(offset)
  }
  for (let index = 0; index < Math.min(20, lines.length); index += 1) keep.add(index)
  for (let index = Math.max(0, lines.length - 20); index < lines.length; index += 1) keep.add(index)
  if (keep.size <= MAX_OUTPUT_LINES) {
    const kept = lines.filter((_, index) => keep.has(index))
    return kept
  }
  const head = lines.slice(0, 160)
  const tail = lines.slice(-160)
  return [
    ...head,
    { type: 'context', text: `… ${lines.length - head.length - tail.length} lines hidden …` },
    ...tail,
  ]
}

/**
 * Field-level record diff (text diff is separate).
 * @param {Record<string, any>} before
 * @param {Record<string, any>} after
 */
export function diffFields(before, after) {
  const fields = ['kind', 'scope', 'status', 'tier', 'importance', 'tags', 'details', 'signature', 'workspace', 'supersededBy', 'archivedAt']
  const changes = []
  for (const field of fields) {
    const left = normalize(before?.[field])
    const right = normalize(after?.[field])
    if (left !== right) changes.push({ field, before: left, after: right })
  }
  return changes
}

function normalize(value) {
  if (value === undefined || value === null) return null
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

/**
 * Unified diff text for CLI output.
 * @param {{ type: string, text: string }[]} lines
 */
export function formatDiff(lines) {
  return lines
    .map((line) => `${line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}${line.text}`)
    .join('\n')
}
