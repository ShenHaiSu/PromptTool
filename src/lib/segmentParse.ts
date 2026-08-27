/**
 * Segment parse — pmf-segments JSON + Tagged Text 解析与校验
 * 契约：docs/need03/01_分段文本格式与分部逻辑方案.md §2/§4
 */

import type { Dimension } from '@/engine/models'

// ------------------------------------------------------------------
// Raw types
// ------------------------------------------------------------------
export type RawSegment = {
  dimensionKey: string
  dimensionId?: string | null
  contentEn: string
  displayName?: string | null
  weight?: number | null
  isNsfw?: boolean
  confidence?: number | null
  notes?: string | null
}

export type RawPromptEntry = {
  id?: string
  raw: string
  segments: RawSegment[]
}

export type RawBatch = {
  format?: string
  formatVersion?: number
  createdAt?: number
  generator?: string
  source?: { note?: string; rawCount?: number }
  counts?: { prompts?: number; segments?: number; unassigned?: number }
  prompts: RawPromptEntry[]
}

// ------------------------------------------------------------------
// Parsed types
// ------------------------------------------------------------------
export type ParsedSegment = RawSegment & {
  status: 'ok' | 'warning' | 'error'
  warnings: string[]
}

export type ParsedPrompt = {
  id: string
  raw: string
  segments: ParsedSegment[]
  status: 'ok' | 'needs_review' | 'error'
  warnings: string[]
  errors: string[]
  stats: { total: number; unassigned: number; unknownDimension: number }
}

export type ParsedBatch = {
  kind: 'json' | 'tagged'
  prompts: ParsedPrompt[]
  warnings: string[]
  errors: string[]
  stats: { prompts: number; segments: number; unassigned: number; errors: number }
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function clampWeight(v: number): number {
  if (!Number.isFinite(v)) return 1.0
  if (v < 0.5) return 0.5
  if (v > 2.0) return 2.0
  return Math.round(v * 10) / 10
}

function extractJsonBlock(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  const candidate = text.slice(start, end + 1)
  try {
    JSON.parse(candidate)
    return candidate
  } catch {
    return null
  }
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase()
}

export function detectFormat(text: string): 'json' | 'tagged' | 'unknown' {
  const t = text.trim()
  if (!t) return 'unknown'
  if (t.startsWith('{') || t.startsWith('[')) {
    const block = extractJsonBlock(t) ?? t
    try {
      JSON.parse(block)
      const hasKeywords = /"(format|prompts|segments|dimensionKey)"/.test(block)
      if (hasKeywords || t.startsWith('{')) return 'json'
    } catch {
      // fallthrough — maybe still json with fences
    }
    // Try stripping fences
    const stripped = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    if (stripped.startsWith('{') || stripped.startsWith('[')) {
      try { JSON.parse(stripped); return 'json' } catch {}
      const inner = extractJsonBlock(stripped)
      if (inner) return 'json'
    }
  }
  if (/^\s*\[[a-z0-9_]+\]/im.test(t)) return 'tagged'
  if (/"(format|prompts|segments|dimensionKey)"/.test(t)) return 'json'
  const fenced = t.replace(/^```(?:json)?\s*/i, '').trim()
  if (fenced.startsWith('{')) {
    const inner = extractJsonBlock(fenced)
    if (inner) return 'json'
  }
  return 'unknown'
}

// ------------------------------------------------------------------
// JSON branch: parse + normalize
// ------------------------------------------------------------------
function normalizeRawBatch(parsed: unknown): { batch: RawBatch; errors: string[] } {
  const errors: string[] = []
  if (parsed == null || typeof parsed !== 'object') {
    return { batch: { prompts: [] }, errors: ['顶层不是对象'] }
  }
  const obj = parsed as Record<string, unknown>

  // Support single-entry shorthand: { raw, segments } without prompts wrapper
  if (!Array.isArray(obj['prompts'])) {
    if (typeof obj['raw'] === 'string' && Array.isArray(obj['segments'])) {
      const entry: RawPromptEntry = {
        id: typeof obj['id'] === 'string' ? (obj['id'] as string) : 'p01',
        raw: obj['raw'] as string,
        segments: (obj['segments'] as unknown[]).map(sanitizeRawSegment).filter(Boolean) as RawSegment[],
      }
      return {
        batch: {
          format: typeof obj['format'] === 'string' ? (obj['format'] as string) : 'pmf-segments',
          formatVersion: typeof obj['formatVersion'] === 'number' ? (obj['formatVersion'] as number) : 1,
          createdAt: typeof obj['createdAt'] === 'number' ? (obj['createdAt'] as number) : undefined,
          generator: typeof obj['generator'] === 'string' ? (obj['generator'] as string) : undefined,
          prompts: [entry],
        },
        errors,
      }
    }
    if (Array.isArray(obj) || Array.isArray((obj as Record<string, unknown>)['segments'])) {
      // ignore - handled above
    }
    // No prompts array, but maybe array of entries at top level
    if (Array.isArray(parsed)) {
      const arr = parsed as unknown[]
      const prompts: RawPromptEntry[] = []
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i] as Record<string, unknown>
        if (e && typeof e['raw'] === 'string' && Array.isArray(e['segments'])) {
          prompts.push({
            id: typeof e['id'] === 'string' ? (e['id'] as string) : `p${String(i + 1).padStart(2, '0')}`,
            raw: e['raw'] as string,
            segments: (e['segments'] as unknown[]).map(sanitizeRawSegment).filter(Boolean) as RawSegment[],
          })
        }
      }
      if (prompts.length > 0) {
        return { batch: { format: 'pmf-segments', formatVersion: 1, prompts }, errors }
      }
    }
    errors.push('缺失 prompts 数组')
    return { batch: { format: obj['format'] as string | undefined, formatVersion: obj['formatVersion'] as number | undefined, prompts: [] }, errors }
  }

  const promptsRaw = obj['prompts'] as unknown[]
  const prompts: RawPromptEntry[] = []
  for (let i = 0; i < promptsRaw.length; i++) {
    const row = promptsRaw[i] as Record<string, unknown>
    if (!row || typeof row !== 'object') {
      errors.push(`prompts[${i}] 不是对象，已跳过`)
      continue
    }
    const raw = typeof row['raw'] === 'string' ? (row['raw'] as string) : ''
    const id = typeof row['id'] === 'string' && (row['id'] as string).trim() ? (row['id'] as string).trim() : `p${String(i + 1).padStart(2, '0')}`
    const segsRaw = Array.isArray(row['segments']) ? (row['segments'] as unknown[]) : null
    if (segsRaw == null) {
      errors.push(`prompts[${i}] 缺失 segments 数组，已置空`)
      prompts.push({ id, raw, segments: [] })
      continue
    }
    const segments: RawSegment[] = []
    for (const s of segsRaw) {
      const seg = sanitizeRawSegment(s)
      if (seg) segments.push(seg)
    }
    prompts.push({ id, raw, segments })
  }

  return {
    batch: {
      format: typeof obj['format'] === 'string' ? (obj['format'] as string) : undefined,
      formatVersion: typeof obj['formatVersion'] === 'number' ? (obj['formatVersion'] as number) : undefined,
      createdAt: typeof obj['createdAt'] === 'number' ? (obj['createdAt'] as number) : undefined,
      generator: typeof obj['generator'] === 'string' ? (obj['generator'] as string) : undefined,
      source: obj['source'] as RawBatch['source'],
      counts: obj['counts'] as RawBatch['counts'],
      prompts,
    },
    errors,
  }
}

function sanitizeRawSegment(raw: unknown): RawSegment | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const dimensionKey = typeof r['dimensionKey'] === 'string' ? (r['dimensionKey'] as string).trim() : ''
  const contentEn = typeof r['contentEn'] === 'string' ? (r['contentEn'] as string) : (typeof r['text'] === 'string' ? (r['text'] as string) : '')
  // allow null-ish contentEn to be caught at validate stage
  return {
    dimensionKey,
    dimensionId: typeof r['dimensionId'] === 'string' ? (r['dimensionId'] as string) : (r['dimensionId'] == null ? null : String(r['dimensionId'])),
    contentEn: String(contentEn ?? ''),
    displayName: typeof r['displayName'] === 'string' ? (r['displayName'] as string) : (r['displayName'] == null ? null : String(r['displayName'])),
    weight: r['weight'] == null ? null : Number(r['weight']),
    isNsfw: typeof r['isNsfw'] === 'boolean' ? (r['isNsfw'] as boolean) : (r['isNsfw'] == null ? undefined : Boolean(r['isNsfw'])),
    confidence: r['confidence'] == null ? null : Number(r['confidence']),
    notes: typeof r['notes'] === 'string' ? (r['notes'] as string) : (r['notes'] == null ? null : String(r['notes'])),
  }
}

// ------------------------------------------------------------------
// Tagged branch
// ------------------------------------------------------------------
function parseTaggedText(text: string): RawBatch {
  const lines = text.split(/\r?\n/)
  const entries: RawPromptEntry[] = []
  let currentSegments: RawSegment[] = []
  let currentRawParts: string[] = []
  let currentIndex = 1

  function flush(): void {
    if (currentSegments.length === 0 && currentRawParts.length === 0) return
    const raw = currentRawParts.join(', ').trim() || currentSegments.map(s => s.contentEn).join(', ')
    entries.push({
      id: `p${String(currentIndex).padStart(2, '0')}`,
      raw: raw || `Prompt ${currentIndex}`,
      segments: currentSegments,
    })
    currentIndex++
    currentSegments = []
    currentRawParts = []
  }

  const tagRe = /^\s*\[([a-z0-9_]+)\]\s*(.*)$/i
  for (const lineRaw of lines) {
    const line = lineRaw.trimEnd()
    if (!line.trim()) {
      // blank line — keep as separator, don't flush unless we see explicit ---
      continue
    }
    if (/^\s*---\s*$/.test(line) || /^\s*###\s*Prompt/i.test(line)) {
      flush()
      continue
    }
    if (/^\s*#/.test(line)) continue
    const m = tagRe.exec(line)
    if (m) {
      const key = normalizeKey(m[1] ?? '')
      let content = (m[2] ?? '').trim()
      let weight: number | null = null
      // support [key] text :1.3  or [key] (text:1.3)
      const weightSuffix = content.match(/\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*$/)
      if (weightSuffix) {
        weight = Number(weightSuffix[1])
        content = content.slice(0, weightSuffix.index ?? content.length).trim()
      }
      const parenWeight = content.match(/^\(\s*(.+?)\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*\)\s*$/)
      if (parenWeight) {
        content = (parenWeight[1] ?? '').trim()
        weight = Number(parenWeight[2])
      }
      // strip surrounding parens if whole content wrapped
      if (content.startsWith('(') && content.endsWith(')') && !parenWeight) {
        // keep as-is, do not strip — let content stay
      }
      currentSegments.push({
        dimensionKey: key,
        contentEn: content,
        weight,
        isNsfw: false,
      })
      if (content) currentRawParts.push(content)
    } else {
      // continuation line — append to last segment
      if (currentSegments.length > 0) {
        const last = currentSegments[currentSegments.length - 1]!
        last.contentEn = `${last.contentEn} ${line.trim()}`.trim()
        if (currentRawParts.length > 0) {
          currentRawParts[currentRawParts.length - 1] = last.contentEn
        }
      } else {
        currentRawParts.push(line.trim())
      }
    }
  }
  flush()
  return {
    format: 'pmf-segments',
    formatVersion: 1,
    prompts: entries,
  }
}

// ------------------------------------------------------------------
// Public: parseSegmentsText (format detection + raw batch)
// ------------------------------------------------------------------
export function parseSegmentsText(text: string): { batch: RawBatch; kind: 'json' | 'tagged' | 'unknown'; errors: string[] } {
  const raw = text.trim()
  if (!raw) {
    return { batch: { prompts: [] }, kind: 'unknown', errors: ['输入为空'] }
  }
  const kind = detectFormat(raw)
  if (kind === 'tagged') {
    const batch = parseTaggedText(raw)
    return { batch, kind, errors: [] }
  }
  if (kind === 'json') {
    // strip fences
    let candidate = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    const inner = extractJsonBlock(candidate)
    if (inner) candidate = inner
    try {
      const parsed = JSON.parse(candidate)
      const { batch, errors } = normalizeRawBatch(parsed)
      // Top-level array shorthand already handled; also support raw array of strings? No
      return { batch, kind: 'json', errors }
    } catch (e) {
      return { batch: { prompts: [] }, kind: 'json', errors: [`JSON 解析失败: ${String((e as Error).message ?? e)}`] }
    }
  }
  return {
    batch: { prompts: [] },
    kind: 'unknown',
    errors: ['无法识别格式，请粘贴 pmf-segments JSON 或 [dimension] Tagged 文本'],
  }
}

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------
export function validateBatch(batch: RawBatch, dimensions: Dimension[]): ParsedBatch {
  const keySet = new Set(dimensions.map(d => normalizeKey(d.key)).concat(['unassigned']))
  const multiSet = new Set(dimensions.filter(d => d.isMultiSelect).map(d => normalizeKey(d.key)))

  const warnings: string[] = []
  const errors: string[] = []

  // Top-level format check — only when caller provided format fields
  if (batch.format != null && batch.format !== 'pmf-segments') {
    errors.push(`不支持的格式 '${batch.format}'（应为 pmf-segments）`)
  }
  if (batch.formatVersion != null && batch.formatVersion !== 1) {
    errors.push(`不支持的格式版本 ${batch.formatVersion}（当前支持 1）`)
  }

  // counts mismatch is warning only
  if (batch.counts) {
    const actualPrompts = batch.prompts.length
    if (batch.counts.prompts != null && batch.counts.prompts !== actualPrompts) {
      warnings.push(`counts.prompts=${batch.counts.prompts} 与实际 ${actualPrompts} 不一致`)
    }
  }

  const prompts: ParsedPrompt[] = batch.prompts.map((entry) => {
    const pWarnings: string[] = []
    const pErrors: string[] = []
    let status: ParsedPrompt['status'] = 'ok'
    const segs: ParsedSegment[] = []
    let unassigned = 0
    let unknownDimension = 0

    // raw checks
    const raw = entry.raw ?? ''
    if (!raw.trim()) {
      pErrors.push('raw 为空')
      status = 'error'
    } else if (raw.length > 2000) {
      pWarnings.push(`raw 超长 ${raw.length} 字符，已截断至 2000`)
    }

    const segmentsArr = Array.isArray(entry.segments) ? entry.segments : []
    if (!Array.isArray(entry.segments)) {
      pErrors.push('segments 不是数组')
      status = 'error'
    }

    // per-segment
    for (let idx = 0; idx < segmentsArr.length; idx++) {
      const s = segmentsArr[idx]!
      const w: string[] = []
      let segStatus: ParsedSegment['status'] = 'ok'
      const keyRaw = (s.dimensionKey ?? '').trim()
      const keyNorm = normalizeKey(keyRaw)
      if (!keyRaw) {
        pErrors.push(`segments[${idx}] dimensionKey 为空`)
        segStatus = 'error'
        status = status === 'ok' ? 'needs_review' : status
        segs.push({
          dimensionKey: '',
          dimensionId: s.dimensionId ?? null,
          contentEn: s.contentEn ?? '',
          displayName: s.displayName ?? null,
          weight: s.weight ?? null,
          isNsfw: s.isNsfw,
          confidence: s.confidence ?? null,
          notes: s.notes ?? null,
          status: segStatus,
          warnings: ['dimensionKey 为空'],
        })
        continue
      }
      if (!keySet.has(keyNorm)) {
        w.push(`未知维度 '${keyRaw}'`)
        segStatus = 'warning'
        unknownDimension++
        if (status === 'ok') status = 'needs_review'
      }
      if (keyNorm === 'unassigned') {
        unassigned++
        if (segStatus === 'ok') segStatus = 'warning'
        if (status === 'ok') status = 'needs_review'
      }

      const contentEnRaw = (s.contentEn ?? '').trim()
      if (!contentEnRaw) {
        w.push('contentEn 为空，已丢弃')
        // mark error but do not push this segment? Spec says discard; we keep with error for visibility
        segStatus = 'error'
        if (status === 'ok') status = 'needs_review'
        segs.push({
          dimensionKey: keyNorm || keyRaw,
          dimensionId: s.dimensionId ?? null,
          contentEn: '',
          displayName: s.displayName ?? null,
          weight: s.weight ?? null,
          isNsfw: s.isNsfw,
          confidence: s.confidence ?? null,
          notes: s.notes ?? null,
          status: segStatus,
          warnings: w,
        })
        continue
      }
      if (contentEnRaw.length > 500) {
        w.push('contentEn 超长，已截断至 500')
        segStatus = 'warning'
        if (status === 'ok') status = 'needs_review'
      }

      let weight = s.weight
      if (weight != null) {
        const n = Number(weight)
        if (!Number.isFinite(n)) {
          w.push('weight 非数值，已重置为 1.0')
          weight = 1.0
          segStatus = 'warning'
          if (status === 'ok') status = 'needs_review'
        } else if (n < 0.5 || n > 2.0) {
          const clamped = clampWeight(n)
          w.push(`weight ${n} 超范围，已 clamp 至 ${clamped}`)
          weight = clamped
          segStatus = 'warning'
          if (status === 'ok') status = 'needs_review'
        } else {
          weight = Math.round(n * 10) / 10
        }
      }

      if (s.isNsfw != null && typeof s.isNsfw !== 'boolean') {
        w.push('isNsfw 非布尔，已忽略')
        if (status === 'ok') status = 'needs_review'
      }

      if (s.notes != null && typeof s.notes === 'string' && s.notes.length > 500) {
        w.push('notes 超长，已截断至 500')
        segStatus = 'warning'
      }

      if (s.confidence != null) {
        const c = Number(s.confidence)
        if (!Number.isFinite(c) || c < 0 || c > 1) {
          w.push('confidence 超范围，已忽略')
        }
      }

      segs.push({
        dimensionKey: keyNorm || keyRaw,
        dimensionId: s.dimensionId ?? null,
        contentEn: contentEnRaw.slice(0, 500),
        displayName: s.displayName != null ? String(s.displayName).slice(0, 500) : null,
        weight: weight ?? null,
        isNsfw: typeof s.isNsfw === 'boolean' ? s.isNsfw : undefined,
        confidence: s.confidence ?? null,
        notes: typeof s.notes === 'string' ? s.notes.slice(0, 500) : (s.notes ?? null),
        status: segStatus,
        warnings: w,
      })
    }

    // Single-select multi-segment warning
    const countByKey = new Map<string, number>()
    for (const s of segs) {
      if (s.status === 'error') continue
      const k = normalizeKey(s.dimensionKey)
      countByKey.set(k, (countByKey.get(k) ?? 0) + 1)
    }
    for (const [k, cnt] of countByKey.entries()) {
      if (cnt > 1 && !multiSet.has(k) && k !== 'unassigned') {
        pWarnings.push(`单选维度 '${k}' 出现 ${cnt} 条片段，将按多模块入库（拼装时按规则处理）`)
        if (status === 'ok') status = 'needs_review'
      }
    }

    // outfit vs top/bottom互斥警告
    const hasOutfit = (countByKey.get('outfit') ?? 0) > 0
    const hasTopOrBottom = (countByKey.get('top') ?? 0) > 0 || (countByKey.get('bottom') ?? 0) > 0
    if (hasOutfit && hasTopOrBottom) {
      pWarnings.push('套装（outfit）与上/下装（top/bottom）互斥，同时出现需复核')
      if (status === 'ok') status = 'needs_review'
    }

    // Promote error status if any segment error
    if (segs.some(s => s.status === 'error') || pErrors.length > 0) {
      if (status !== 'error') status = 'needs_review'
      if (pErrors.length > 0) status = 'error'
    }

    const id = entry.id?.trim() || `p${String(prompts.length + 1).padStart(2, '0')}`

    return {
      id,
      raw: raw.slice(0, 2000),
      segments: segs,
      status,
      warnings: pWarnings,
      errors: pErrors,
      stats: { total: segs.length, unassigned, unknownDimension },
    }
  })

  const totalSegments = prompts.reduce((a, p) => a + p.segments.filter(s => s.status !== 'error' || s.contentEn).length, 0)
  const totalUnassigned = prompts.reduce((a, p) => a + p.stats.unassigned, 0)
  const errorPrompts = prompts.filter(p => p.status === 'error').length

  return {
    kind: 'json',
    prompts,
    warnings,
    errors,
    stats: { prompts: prompts.length, segments: totalSegments, unassigned: totalUnassigned, errors: errorPrompts },
  }
}

export function parseAndValidate(text: string, dimensions: Dimension[]): ParsedBatch {
  const { batch, kind, errors } = parseSegmentsText(text)
  if (kind === 'unknown') {
    return {
      kind: 'json',
      prompts: [],
      warnings: [],
      errors,
      stats: { prompts: 0, segments: 0, unassigned: 0, errors: errors.length },
    }
  }
  const validated = validateBatch(batch, dimensions)
  // preserve kind
  validated.kind = kind
  if (errors.length > 0) {
    validated.errors = [...errors, ...validated.errors]
    if (kind === 'json' && errors.some(e => e.includes('JSON 解析失败'))) {
      validated.stats.errors += 1
    }
  }
  return validated
}

// ------------------------------------------------------------------
// Serializers
// ------------------------------------------------------------------
export function toTaggedText(batch: ParsedBatch): string {
  const lines: string[] = []
  for (let i = 0; i < batch.prompts.length; i++) {
    const p = batch.prompts[i]!
    if (i > 0) lines.push('---')
    for (const s of p.segments) {
      if (!s.contentEn.trim()) continue
      let suffix = ''
      if (s.weight != null && s.weight !== 1 && Number.isFinite(s.weight)) {
        suffix = ` :${s.weight}`
      }
      lines.push(`[${s.dimensionKey}] ${s.contentEn}${suffix}`)
    }
  }
  return lines.join('\n')
}

export function toSegmentsJson(batch: ParsedBatch): string {
  const payload: RawBatch = {
    format: 'pmf-segments',
    formatVersion: 1,
    createdAt: Math.floor(Date.now() / 1000),
    generator: 'manual',
    source: { rawCount: batch.prompts.length },
    counts: {
      prompts: batch.prompts.length,
      segments: batch.prompts.reduce((a, p) => a + p.segments.length, 0),
      unassigned: batch.prompts.reduce((a, p) => a + p.stats.unassigned, 0),
    },
    prompts: batch.prompts.map(p => ({
      id: p.id,
      raw: p.raw,
      segments: p.segments
        .filter(s => s.status !== 'error' || s.contentEn.trim())
        .map(s => {
          const seg: RawSegment = {
            dimensionKey: s.dimensionKey,
            contentEn: s.contentEn,
          }
          if (s.dimensionId) seg.dimensionId = s.dimensionId
          if (s.displayName) seg.displayName = s.displayName
          if (s.weight != null) seg.weight = s.weight
          if (s.isNsfw) seg.isNsfw = s.isNsfw
          if (s.confidence != null) seg.confidence = s.confidence
          if (s.notes) seg.notes = s.notes
          return seg
        }),
    })),
  }
  return JSON.stringify(payload, null, 2)
}
