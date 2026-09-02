/**
 * Need01 — 结果解析与批量回填（前端宽容解析、合并与校验）
 * 契约：docs/need01/05_结果解析与批量回填设计.md 与 06_数据与接口契约.md
 */
import type { Dimension, Module } from '@/engine/models'

export const TRANSLATION_MAX_ZH_LEN = 500
export const TRANSLATION_MAX_ITEMS_PER_UPDATE = 1000

export type RawTranslationItem = { id: string; zh: string }

export type ParsedTranslationBlock = {
  kind: 'json' | 'unknown'
  chunkId?: string
  dimensionKey?: string
  format?: string
  formatVersion?: number
  items: RawTranslationItem[]
  errors: string[]
  warnings: string[]
}

export type MergeResult = {
  blocks: ParsedTranslationBlock[]
  pendingMap: Map<string, { zh: string; sourceChunkId?: string; warnings: string[] }>
  errors: string[]
  warnings: string[]
  stats: { blocks: number; totalItems: number; uniqueIds: number; duplicateIds: number }
}

export type TranslationRowStatus = 'ok' | 'unknownId' | 'emptyZh' | 'duplicate'
export type TranslationRow = {
  id: string
  contentEn: string
  oldDisplayName: string
  newZh: string
  status: TranslationRowStatus
  warnings: string[]
  selected: boolean
}
export type ParsedTranslation = {
  rows: TranslationRow[]
  stats: { totalUnique: number; hit: number; unknown: number; duplicate: number; empty: number }
  errors: string[]
  warnings: string[]
}

// ------------------------------------------------------------------
// 多块提取（平衡大括号 + 字符串感知）
// ------------------------------------------------------------------

function stripFences(text: string): string {
  // Remove ```json ... ``` wrappers globally but keep inner JSON
  // We keep a light pass: extract content inside fences if present
  // Global fence removal: replace ```json\n{...}\n``` -> {...}
  let out = text
  // Replace fenced blocks with inner content
  out = out.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (_m, inner: string) => inner as string)
  return out
}

export function extractTranslationJsonBlocks(text: string): string[] {
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
      // Not valid JSON, skip this brace and continue search
      i = start + 1
    }
  }
  // Fallback: if no blocks but whole text looks like single JSON object
  if (blocks.length === 0) {
    const trimmed = normalized.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try { JSON.parse(trimmed); blocks.push(trimmed) } catch {}
    }
  }
  return blocks
}

function toRawItemsFromParsed(obj: Record<string, unknown>): { items: RawTranslationItem[]; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const items: RawTranslationItem[] = []

  // pmf-translation items may be array or flat map
  const rawItems = (obj['items'] as unknown) ?? (obj['mappings'] as unknown)

  if (Array.isArray(rawItems)) {
    for (let idx = 0; idx < rawItems.length; idx++) {
      const row = rawItems[idx] as Record<string, unknown>
      if (!row || typeof row !== 'object') {
        errors.push(`items[${idx}] 不是对象，已跳过`)
        continue
      }
      const id = typeof row['id'] === 'string' ? (row['id'] as string).trim() : ''
      // zh may be under zh / displayName / nameCn / value
      const zhRaw = (row['zh'] as unknown) ?? (row['displayName'] as unknown) ?? (row['nameCn'] as unknown) ?? (row['value'] as unknown)
      const zh = typeof zhRaw === 'string' ? (zhRaw as string) : (zhRaw == null ? '' : String(zhRaw))
      const zhTrim = zh.trim()
      if (!id) {
        errors.push(`items[${idx}] id 为空，已丢弃`)
        continue
      }
      if (!zhTrim) {
        errors.push(`id ${id} 的 zh 为空，已丢弃`)
        continue
      }
      let finalZh = zhTrim
      if ([...finalZh].length > TRANSLATION_MAX_ZH_LEN) {
        warnings.push(`id ${id} 的 zh 超长，已截断至 ${TRANSLATION_MAX_ZH_LEN}`)
        finalZh = [...finalZh].slice(0, TRANSLATION_MAX_ZH_LEN).join('')
      }
      items.push({ id, zh: finalZh })
    }
  } else if (rawItems != null && typeof rawItems === 'object' && !Array.isArray(rawItems)) {
    // flat map: { "m_1": "中文", ... }
    const map = rawItems as Record<string, unknown>
    for (const [k, v] of Object.entries(map)) {
      const id = k.trim()
      const zh = typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim())
      if (!id) { errors.push('扁平 map 含空 id，已跳过'); continue }
      if (!zh) { errors.push(`id ${id} 的 zh 为空，已丢弃`); continue }
      let finalZh = zh
      if ([...finalZh].length > TRANSLATION_MAX_ZH_LEN) {
        warnings.push(`id ${id} 的 zh 超长，已截断至 ${TRANSLATION_MAX_ZH_LEN}`)
        finalZh = [...finalZh].slice(0, TRANSLATION_MAX_ZH_LEN).join('')
      }
      items.push({ id, zh: finalZh })
    }
  } else {
    errors.push('缺失 items（应为数组或扁平 map）')
  }

  return { items, errors, warnings }
}

export function parseTranslationBlock(block: string): ParsedTranslationBlock {
  let parsed: unknown
  try {
    parsed = JSON.parse(block)
  } catch (e) {
    return {
      kind: 'unknown',
      items: [],
      errors: [`JSON 解析失败: ${String((e as Error).message ?? e)}`],
      warnings: [],
    }
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'unknown', items: [], errors: ['顶层不是对象'], warnings: [] }
  }
  const obj = parsed as Record<string, unknown>
  const format = typeof obj['format'] === 'string' ? (obj['format'] as string) : undefined
  const formatVersion = typeof obj['formatVersion'] === 'number' ? (obj['formatVersion'] as number) : undefined
  const chunkId = typeof obj['chunkId'] === 'string' ? (obj['chunkId'] as string) : undefined
  const dimensionKey = typeof obj['dimensionKey'] === 'string' ? (obj['dimensionKey'] as string) : undefined

  const warnings: string[] = []
  const errors: string[] = []

  // format warning but still parse
  if (format != null && format !== 'pmf-translation') {
    warnings.push(`format 为 '${format}'（期望 pmf-translation）`)
  }
  if (formatVersion != null && formatVersion !== 1) {
    warnings.push(`formatVersion 为 ${formatVersion}（当前支持 1）`)
  }

  const hasItems = 'items' in obj || 'mappings' in obj
  const isCompatNoFormat = format == null && hasItems
  // If no format but has items, treat as compatible (warn)
  if (isCompatNoFormat) {
    warnings.push('缺失 format，已按兼容形态解析')
  }
  // If neither format nor items, unknown
  if (format == null && !hasItems) {
    // Try to detect flat map directly: all values are strings and keys look like ids
    const entries = Object.entries(obj)
    const allStringValues = entries.length > 0 && entries.every(([, v]) => typeof v === 'string')
    if (allStringValues) {
      const { items, errors: ie, warnings: iw } = toRawItemsFromParsed({ items: obj } as Record<string, unknown>)
      return {
        kind: 'json',
        chunkId,
        dimensionKey,
        format,
        formatVersion,
        items,
        errors: [...errors, ...ie],
        warnings: [...warnings, ...iw],
      }
    }
    return { kind: 'unknown', items: [], errors: ['无法识别的 pmf-translation 格式'], warnings }
  }

  const { items, errors: ie, warnings: iw } = toRawItemsFromParsed(obj)
  errors.push(...ie)
  warnings.push(...iw)

  return {
    kind: 'json',
    chunkId,
    dimensionKey,
    format,
    formatVersion,
    items,
    errors,
    warnings,
  }
}

export function parseTranslationText(text: string): MergeResult {
  const raw = text.trim()
  if (!raw) {
    return {
      blocks: [],
      pendingMap: new Map(),
      errors: ['输入为空'],
      warnings: [],
      stats: { blocks: 0, totalItems: 0, uniqueIds: 0, duplicateIds: 0 },
    }
  }
  const jsonBlocks = extractTranslationJsonBlocks(raw)
  if (jsonBlocks.length === 0) {
    // No JSON found at all
    const hint = /"zh"/.test(raw) || /"items"/.test(raw) ? 'JSON 解析失败或未提取到有效块' : '无法识别的 pmf-translation 格式'
    return {
      blocks: [],
      pendingMap: new Map(),
      errors: [hint],
      warnings: [],
      stats: { blocks: 0, totalItems: 0, uniqueIds: 0, duplicateIds: 0 },
    }
  }
  const blocks = jsonBlocks.map(parseTranslationBlock)
  return mergeTranslationBatches(blocks)
}

export function mergeTranslationBatches(blocks: ParsedTranslationBlock[]): MergeResult {
  const errors: string[] = []
  const warnings: string[] = []
  // Include warnings/errors from each block into top-level
  for (const b of blocks) {
    if (b.errors.length) errors.push(...b.errors.map((e) => `[${b.chunkId ?? 'unknown'}] ${e}`))
    if (b.warnings.length) warnings.push(...b.warnings.map((w) => `[${b.chunkId ?? 'unknown'}] ${w}`))
  }

  const pendingMap = new Map<string, { zh: string; sourceChunkId?: string; warnings: string[] }>()
  let totalItems = 0
  let duplicateIds = 0

  for (const b of blocks) {
    for (const it of b.items) {
      totalItems++
      if (pendingMap.has(it.id)) duplicateIds++
      const prev = pendingMap.get(it.id)
      if (prev) {
        warnings.push(`id ${it.id} 重复，已取最后一次的值`)
      }
      pendingMap.set(it.id, { zh: it.zh, sourceChunkId: b.chunkId, warnings: [] })
    }
  }

  const uniqueIds = pendingMap.size
  return {
    blocks,
    pendingMap,
    errors,
    warnings,
    stats: { blocks: blocks.length, totalItems, uniqueIds, duplicateIds },
  }
}

export function validateTranslationBatch(
  merge: MergeResult,
  ctx: { dimension: Dimension; modules: Module[] },
): ParsedTranslation {
  const { pendingMap } = merge
  const errors: string[] = [...merge.errors]
  const warnings: string[] = [...merge.warnings]

  const byId = new Map<string, Module>()
  for (const m of ctx.modules) byId.set(m.id, m)

  const rows: TranslationRow[] = []
  let hit = 0
  let unknown = 0
  let empty = 0
  const duplicate = merge.stats.duplicateIds

  // Track duplicate id warning already counted; rows themselves are deduped via pendingMap

  for (const [id, val] of pendingMap.entries()) {
    const module = byId.get(id)
    if (!module) {
      unknown++
      rows.push({
        id,
        contentEn: '',
        oldDisplayName: '',
        newZh: val.zh,
        status: 'unknownId',
        warnings: ['非本维度 id'],
        selected: false,
      })
      continue
    }
    const zhTrim = val.zh.trim()
    if (!zhTrim) {
      empty++
      rows.push({
        id,
        contentEn: module.contentEn,
        oldDisplayName: module.displayName,
        newZh: val.zh,
        status: 'emptyZh',
        warnings: ['空中文'],
        selected: false,
      })
      continue
    }
    const status: TranslationRowStatus = 'ok'
    hit++
    rows.push({
      id,
      contentEn: module.contentEn,
      oldDisplayName: module.displayName,
      newZh: zhTrim,
      status,
      warnings: val.warnings,
      selected: true,
    })
  }

  // Sort rows by ctx.modules order, unknown at tail
  const order = new Map<string, number>()
  ctx.modules.forEach((m, idx) => order.set(m.id, idx))
  rows.sort((a, b) => {
    const ao = order.get(a.id)
    const bo = order.get(b.id)
    if (ao != null && bo != null) return ao - bo
    if (ao != null) return -1
    if (bo != null) return 1
    return a.id.localeCompare(b.id)
  })

  return {
    rows,
    stats: { totalUnique: pendingMap.size, hit, unknown, duplicate, empty },
    errors,
    warnings,
  }
}

export function toTranslationUpdatePayload(
  rows: TranslationRow[],
  dimensionId: string,
): { dimensionId: string; items: Array<{ id: string; displayName: string }> } {
  const items = rows
    .filter((r) => r.selected && r.status === 'ok')
    .map((r) => ({ id: r.id, displayName: r.newZh.trim() }))
    .filter((i) => i.displayName.length > 0)
  return { dimensionId, items }
}
