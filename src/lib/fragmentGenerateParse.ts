/**
 * Need03 — pmf-fragments v1 结果解析与批量入库 payload 组装（纯前端）
 * 契约：docs/need03/05_结果解析与批量入库设计.md 与 06_数据与接口契约.md
 *
 * 解析照抄 translationParse 的容错策略（去 fence、平衡大括号 + 字符串感知、
 * 多形态兼容），格式是新建的 pmf-fragments v1（JSON 主 + 纯行 fallback）。
 * 入库零新代码：toBatchCreatePayload 直调 dbBatchCreateModules 的 payload 形态。
 */
import type { Dimension, Module } from '@/engine/models'
import { GENERATE_MAX_ITEMS } from '@/lib/fragmentGeneratePrompt'
import type { BatchCreatePayload } from '@/lib/db'

export type FragmentRowStatus = 'ok' | 'duplicate_in_batch' | 'duplicate_in_db' | 'empty' | 'error'

export type ParsedFragmentRow = {
  index: number
  contentEn: string
  displayName: string
  status: FragmentRowStatus
  tooLong: boolean
  warnings: string[]
  selected: boolean
}

export type ParsedFragmentBatch = {
  kind: 'json' | 'lines'
  rows: ParsedFragmentRow[]
  stats: { total: number; valid: number; dupBatch: number; dupDb: number; empty: number; tooLong: number }
  warnings: string[]
  errors: string[]
}

export type GenerateImportOptions = { mode: 'skip' | 'overwrite'; weight: number; isNsfw: boolean }

export const FRAGMENT_MAX_LEN = 500

type RawFragmentItem = {
  contentEn: string
  displayName: string
  weight?: number
  isNsfw?: boolean
  warnings: string[]
}

// ------------------------------------------------------------------
// 格式探测
// ------------------------------------------------------------------

function stripFences(text: string): string {
  return text.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (_m, inner: string) => inner as string)
}

function extractJsonBlocks(text: string): string[] {
  const normalized = stripFences(text)
  const blocks: string[] = []
  let i = 0
  const n = normalized.length
  while (i < n) {
    const start = normalized.indexOf('{', i)
    if (start === -1) break
    let depth = 0
    let inStr = false
    let esc = false
    let end = -1
    for (let j = start; j < n; j++) {
      const ch = normalized[j]!
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
      } else {
        if (ch === '"') inStr = true
        else if (ch === '{') depth++
        else if (ch === '}') {
          depth--
          if (depth === 0) { end = j; break }
        }
      }
    }
    if (end === -1) break
    const candidate = normalized.slice(start, end + 1)
    try {
      JSON.parse(candidate)
      blocks.push(candidate)
      i = end + 1
    } catch {
      i = start + 1
    }
  }
  if (blocks.length === 0) {
    const trimmed = normalized.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try { JSON.parse(trimmed); blocks.push(trimmed) } catch {}
    }
  }
  return blocks
}

export function detectFragmentFormat(text: string): 'json' | 'lines' | 'unknown' {
  const raw = (text ?? '').trim()
  if (!raw) return 'unknown'
  const blocks = extractJsonBlocks(raw)
  if (blocks.length > 0) {
    const joined = blocks.join(' ')
    if (/"contentEn"|"content_en"|"pmf-fragments"/.test(joined)) return 'json'
    return 'unknown'
  }
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length > 0 && lines.every((l) => !l.includes('{') && !l.includes('}'))) return 'lines'
  return 'unknown'
}

export function countDetectedContentEn(text: string): number {
  const m = (text ?? '').match(/"contentEn"\s*:/g)
  return m ? m.length : 0
}

// ------------------------------------------------------------------
// 字段别名归一
// ------------------------------------------------------------------

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k]
    if (typeof v === 'string') return v
    if (v != null && (typeof v === 'number' || typeof v === 'boolean')) return String(v)
  }
  return ''
}

function toRawItem(row: unknown, idx: number): { item: RawFragmentItem | null; error: string | null } {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { item: null, error: `items[${idx}] 不是对象，已跳过` }
  }
  const r = row as Record<string, unknown>
  const contentEn = pickString(r, ['contentEn', 'content_en', 'en', 'text']).trim()
  const displayName = pickString(r, ['displayName', 'display_name', 'zh', 'nameCn', 'name_cn', 'value']).trim()
  const warnings: string[] = []
  let weight: number | undefined
  const wRaw = r['weight']
  if (typeof wRaw === 'number' && Number.isFinite(wRaw)) weight = wRaw
  let isNsfw: boolean | undefined
  const nRaw = r['isNsfw']
  if (typeof nRaw === 'boolean') isNsfw = nRaw
  if (!contentEn) return { item: null, error: `items[${idx}] 英文为空，已丢弃` }
  let en = contentEn
  let zh = displayName
  let tooLongNote = ''
  if ([...en].length > FRAGMENT_MAX_LEN) {
    en = [...en].slice(0, FRAGMENT_MAX_LEN).join('')
    tooLongNote = '英文超长，已截断至 500'
  }
  if ([...zh].length > FRAGMENT_MAX_LEN) {
    zh = [...zh].slice(0, FRAGMENT_MAX_LEN).join('')
    tooLongNote = tooLongNote ? `${tooLongNote}；中文超长，已截断至 500` : '中文超长，已截断至 500'
  }
  if (tooLongNote) warnings.push(tooLongNote)
  return { item: { contentEn: en, displayName: zh, weight, isNsfw, warnings }, error: null }
}

function rawItemsFromObject(obj: Record<string, unknown>): { items: RawFragmentItem[]; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const items: RawFragmentItem[] = []
  const rawItems = (obj['items'] as unknown) ?? null
  if (Array.isArray(rawItems)) {
    rawItems.forEach((row, idx) => {
      const { item, error } = toRawItem(row, idx)
      if (error) errors.push(error)
      if (item) items.push(item)
    })
    return { items, errors, warnings }
  }
  // 兼容：顶层扁平数组在外层处理；此处若 items 缺失则报错
  errors.push('缺失 items（应为数组）')
  return { items, errors, warnings }
}

// ------------------------------------------------------------------
// JSON / 纯行解析
// ------------------------------------------------------------------

function parseJsonInput(text: string): { items: RawFragmentItem[]; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const items: RawFragmentItem[] = []
  // 优先整体解析：顶层扁平数组 [{contentEn,…}] 直接逐条
  try {
    const whole = JSON.parse(stripFences(text).trim())
    if (Array.isArray(whole)) {
      whole.forEach((row, idx) => {
        const { item, error } = toRawItem(row, idx)
        if (error) errors.push(error)
        if (item) items.push(item)
      })
      return { items, errors, warnings }
    }
  } catch { /* 非整体 JSON，走块提取 */ }
  const blocks = extractJsonBlocks(text)
  if (blocks.length === 0) return { items, errors: ['无法识别的 pmf-fragments 格式'], warnings }
  for (const b of blocks) {
    let obj: unknown
    try {
      obj = JSON.parse(b)
    } catch (e) {
      errors.push(`JSON 解析失败: ${String((e as Error).message ?? e)}`)
      continue
    }
    if (Array.isArray(obj)) {
      // 顶层扁平数组 [{contentEn,…}]
      obj.forEach((row, idx) => {
        const { item, error } = toRawItem(row, idx)
        if (error) errors.push(error)
        if (item) items.push(item)
      })
      continue
    }
    if (obj == null || typeof obj !== 'object') {
      errors.push('顶层不是对象，已跳过')
      continue
    }
    const rec = obj as Record<string, unknown>
    const format = rec['format']
    if (format == null) {
      warnings.push('缺失 format 声明，已按 pmf-fragments 解析')
    } else if (format !== 'pmf-fragments') {
      warnings.push(`format 为 '${String(format)}'（期望 pmf-fragments）`)
    }
    const fv = rec['formatVersion']
    if (fv != null && fv !== 1) warnings.push(`formatVersion 为 ${String(fv)}（当前支持 1）`)
    const expected = rec['count']
    if (typeof expected === 'number') {
      const actual = Array.isArray(rec['items']) ? (rec['items'] as unknown[]).length : -1
      if (actual >= 0 && actual !== expected) warnings.push(`count 声明 ${expected} 与实际 ${actual} 不一致，已按实际解析`)
    }
    const { items: got, errors: ie, warnings: iw } = rawItemsFromObject(rec)
    errors.push(...ie)
    warnings.push(...iw)
    items.push(...got)
  }
  return { items, errors, warnings }
}

const LINE_SPLIT_RE = /\s*[|｜丨—–―─]\s*|\s+—\s+|\s*：\s*|\s*:\s*/

function parseLineInput(text: string): { items: RawFragmentItem[]; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const items: RawFragmentItem[] = []
  const lines = text.split('\n')
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.split(LINE_SPLIT_RE)
    const en = (parts[0] ?? '').trim()
    const zh = parts.length > 1 ? parts.slice(1).join(' ').trim() : ''
    if (!en) {
      errors.push(`空英文行已丢弃：${line.slice(0, 30)}`)
      continue
    }
    const { item, error } = toRawItem({ contentEn: en, displayName: zh }, items.length)
    if (error) errors.push(error)
    if (item) items.push(item)
  }
  if (items.length === 0 && errors.length === 0) errors.push('未能识别格式，请确认 LLM 返回了 JSON 或一行一条文本')
  return { items, errors, warnings }
}

// ------------------------------------------------------------------
// 归一键与校验
// ------------------------------------------------------------------

export function normalizeFragmentKey(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
}

export function validateFragmentBatch(
  items: RawFragmentItem[],
  ctx: { dimension: Dimension; modules: Module[] },
): ParsedFragmentBatch {
  void ctx.dimension
  const warnings: string[] = []
  const errors: string[] = []
  const seenBatch = new Set<string>()
  const dbKeys = new Set((ctx.modules ?? []).map((m) => normalizeFragmentKey(m.contentEn ?? '')))

  let limited = items
  if (items.length > GENERATE_MAX_ITEMS) {
    warnings.push(`超过单次上限 ${GENERATE_MAX_ITEMS} 条，仅取前 ${GENERATE_MAX_ITEMS} 条`)
    limited = items.slice(0, GENERATE_MAX_ITEMS)
  }

  const rows: ParsedFragmentRow[] = []
  let valid = 0
  let dupBatch = 0
  let dupDb = 0
  let empty = 0
  let tooLong = 0
  limited.forEach((it, i) => {
    const en = (it.contentEn ?? '').trim()
    const zh = (it.displayName ?? '').trim()
    if (!en) {
      empty++
      rows.push({ index: i, contentEn: '', displayName: zh, status: 'empty', tooLong: false, warnings: ['空英文行'], selected: false })
      return
    }
    const key = normalizeFragmentKey(en)
    const isTooLong = it.warnings.length > 0
    if (isTooLong) tooLong++
    if (seenBatch.has(key)) {
      dupBatch++
      rows.push({ index: i, contentEn: en, displayName: zh, status: 'duplicate_in_batch', tooLong: isTooLong, warnings: [...it.warnings, '批内重复（归一）'], selected: false })
      return
    }
    seenBatch.add(key)
    if (dbKeys.has(key)) {
      dupDb++
      rows.push({ index: i, contentEn: en, displayName: zh, status: 'duplicate_in_db', tooLong: isTooLong, warnings: [...it.warnings, '可能重复（归一）：库内已有相似英文'], selected: false })
      return
    }
    valid++
    rows.push({ index: i, contentEn: en, displayName: zh, status: 'ok', tooLong: isTooLong, warnings: [...it.warnings], selected: true })
  })

  return {
    kind: 'json',
    rows,
    stats: { total: limited.length, valid, dupBatch, dupDb, empty, tooLong },
    warnings,
    errors,
  }
}

export function parseFragmentText(
  text: string,
  ctx: { dimension: Dimension; modules: Module[] },
): ParsedFragmentBatch {
  const kind = detectFragmentFormat(text)
  if (kind === 'unknown') {
    return {
      kind: 'json',
      rows: [],
      stats: { total: 0, valid: 0, dupBatch: 0, dupDb: 0, empty: 0, tooLong: 0 },
      warnings: [],
      errors: ['未能识别格式，请确认 LLM 返回了 JSON 或一行一条文本'],
    }
  }
  const { items, errors, warnings } = kind === 'json' ? parseJsonInput(text) : parseLineInput(text)
  const batch = validateFragmentBatch(items, ctx)
  batch.kind = kind
  batch.errors = [...errors, ...batch.errors]
  batch.warnings = [...warnings, ...batch.warnings]
  return batch
}

// ------------------------------------------------------------------
// 入库 payload
// ------------------------------------------------------------------

export function toBatchCreatePayload(
  rows: ParsedFragmentRow[],
  dimension: Dimension,
  opts: GenerateImportOptions,
): BatchCreatePayload {
  const date = new Date().toISOString().slice(0, 10)
  const items = rows
    .filter((r) => r.selected && r.status === 'ok' && r.contentEn.trim().length > 0)
    .map((r) => ({
      contentEn: r.contentEn.trim(),
      displayName: r.displayName.trim() ? r.displayName.trim() : null,
      weight: opts.weight,
      isNsfw: opts.isNsfw,
      notes: `pmf-generate ${date}`,
    }))
  return { dimId: dimension.id, items, mode: opts.mode, weight: opts.weight, isNsfw: opts.isNsfw }
}
