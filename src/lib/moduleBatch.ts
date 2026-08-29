export type BatchLineStatus =
  | 'ok'
  | 'empty'
  | 'duplicate_in_batch'
  | 'too_long'

export type ParsedBatchLine = {
  lineNo: number
  raw: string
  contentEn: string
  displayName: string
  status: BatchLineStatus
  warnings: string[]
}

export type ParsedBatch = {
  lines: ParsedBatchLine[]
  stats: {
    total: number
    valid: number
    empty: number
    duplicateInBatch: number
    tooLong: number
  }
  warnings: string[]
}

export type BatchOptions = {
  maxLines?: number
  maxLen?: number
  dedupCaseSensitive?: boolean
}

const DEFAULT_MAX_LINES = 500
const DEFAULT_MAX_LEN = 500

export function parseBatchText(text: string, opts?: BatchOptions): ParsedBatch {
  const maxLines = opts?.maxLines ?? DEFAULT_MAX_LINES
  const maxLen = opts?.maxLen ?? DEFAULT_MAX_LEN
  const dedupCaseSensitive = opts?.dedupCaseSensitive ?? true

  const rawLines = text.split(/\r?\n/)
  const totalInput = rawLines.length

  const warnings: string[] = []
  let truncatedByLimit = false

  let lines: string[]
  if (rawLines.length > maxLines) {
    lines = rawLines.slice(0, maxLines)
    truncatedByLimit = true
    warnings.push(`已截断至 ${maxLines} 行，剩余 ${totalInput - maxLines} 行请分批`)
  } else {
    lines = rawLines
  }

  // Single empty input yields one element "" -> normalize to empty preview?
  // Keep 1:1 line mapping for truncated set.

  const seen = new Map<string, number>()
  const parsed: ParsedBatchLine[] = []

  let valid = 0
  let empty = 0
  let dup = 0
  let tooLong = 0

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const trimmed = raw.trim()
    const lineNo = i + 1

    if (trimmed === '') {
      parsed.push({ lineNo, raw, contentEn: '', displayName: '', status: 'empty', warnings: [] })
      empty++
      continue
    }

    let contentEn = trimmed
    const lineWarnings: string[] = []
    let status: BatchLineStatus = 'ok'

    if (contentEn.length > maxLen) {
      lineWarnings.push(`超长已截断至 ${maxLen}`)
      contentEn = [...contentEn].slice(0, maxLen).join('')
      status = 'too_long'
      tooLong++
    }

    const dedupKey = dedupCaseSensitive ? contentEn : contentEn.toLowerCase()
    if (seen.has(dedupKey)) {
      status = 'duplicate_in_batch'
      dup++
      // if it was too_long we already counted; duplicate takes precedence for display
      // tooLong count stays as-is per spec: too_long is for warning, duplicate for status
      parsed.push({
        lineNo,
        raw,
        contentEn,
        displayName: [...contentEn].slice(0, 20).join(''),
        status: 'duplicate_in_batch',
        warnings: [...lineWarnings],
      })
      continue
    }
    seen.set(dedupKey, i)

    // valid statuses: ok or too_long (both countable)
    if (status === 'ok' || status === 'too_long') valid++

    // For too_long we already counted valid; ok path no extra

    parsed.push({
      lineNo,
      raw,
      contentEn,
      displayName: [...contentEn].slice(0, 20).join(''),
      status,
      warnings: lineWarnings,
    })
  }

  // Special case: text === "" -> rawLines = [""] -> one empty row; that's fine.
  // If input was truncated, valid/empty/dup reflect the truncated set.

  void truncatedByLimit

  return {
    lines: parsed,
    stats: { total: truncatedByLimit ? totalInput : lines.length, valid, empty, duplicateInBatch: dup, tooLong },
    warnings,
  }
}

export function filterValidItems(parsed: ParsedBatch): Array<{ contentEn: string; displayName: string }> {
  return parsed.lines
    .filter((l) => l.status === 'ok' || l.status === 'too_long')
    .map((l) => ({ contentEn: l.contentEn, displayName: l.displayName }))
}

export function toBatchItems(parsed: ParsedBatch): Array<{ contentEn: string; displayName: string }> {
  return filterValidItems(parsed)
}
