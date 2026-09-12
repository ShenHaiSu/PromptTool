/** db 适配层内部行类型（camelCase；布尔存 0/1 number，对标 SQLite INTEGER）与共享工具。 */
import type { Assembly, Dimension, Module, Template } from '@/engine/models'
import { getAll, getAllByIndex, tx } from './idb'
import { getDb } from './seed'

export type DimRow = {
  id: string; key: string; nameCn: string; nameEn: string | null
  sortOrder: number; isMultiSelect: 0 | 1; isEnabled: 0 | 1; icon: string | null
  createdAt: number; updatedAt: number; isDeleted: 0 | 1
}
export type ModRow = {
  id: string; dimensionId: string; contentEn: string; displayName: string
  weight: number; isEnabled: 0 | 1; isNsfw: 0 | 1; usageCount: number
  exampleImage: string | null; notes: string | null
  createdAt: number; updatedAt: number; isDeleted: 0 | 1
}
export type AsmRow = {
  id: string; title: string | null; promptIr: string; finalPrompt: string
  modelProfile: string; createdAt: number; isFavorite: 0 | 1; isDeleted: 0 | 1
}
export type AsmItemRow = {
  id: string; assemblyId: string; moduleId: string; sortOrder: number
  weightOverride: number | null; isLocked: 0 | 1; dimensionKey: string
}
export type TplRow = {
  id: string; name: string; description: string | null; configJson: string
  coverPrompt: string | null; createdAt: number; isDeleted: 0 | 1
}
export type TplItemRow = {
  id: string; templateId: string; moduleId: string; dimensionKey: string
  sortOrder: number; weightOverride: number | null; isLocked: 0 | 1
}
export type RuleRow = {
  id: string; name: string; type: string
  sourceDimensionId: string | null; sourceModuleId: string | null
  targetDimensionId: string | null; targetModuleId: string | null
  message: string; isEnabled: 0 | 1; createdAt: number; isDeleted: 0 | 1
}
export type TagRow = { id: string; name: string; color: string | null; createdAt: number; isDeleted: 0 | 1 }

export function b(v: boolean): 0 | 1 {
  return v ? 1 : 0
}

export function uid(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  }
}

export function safeTruncate(s: string, maxChars: number): string {
  const chars = [...s]
  return chars.length <= maxChars ? s : chars.slice(0, maxChars).join('')
}

export function shortTitleFromPrompt(finalPrompt: string, ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (!finalPrompt.trim()) return `${ymd} · (空方案)`
  const short = safeTruncate(finalPrompt, 30)
  return [...finalPrompt].length > 30 ? `${ymd} · ${short}...` : `${ymd} · ${short}`
}

/** Rust round1：(w*10).round()/10 的 JS 等价。 */
export function round1(w: number): number {
  return Math.round(w * 10) / 10
}

/** 权重归一：默认 1.0，非有限重置，超 [0.5,2.0] clamp，均 round1 位。 */
export function normWeight(raw: number | null | undefined, dflt: number, warnings: string[], ctx: string): number {
  const w = raw ?? dflt
  if (!Number.isFinite(w)) {
    warnings.push(`${ctx}权重非数值，已重置为 1.0`)
    return 1.0
  }
  if (w < 0.5 || w > 2.0) {
    const clamped = Math.min(2.0, Math.max(0.5, w))
    warnings.push(`${ctx}权重 ${w} 超范围，已 clamp 至 ${round1(clamped)}`)
    return round1(clamped)
  }
  return round1(w)
}

export function normMode(mode: string, raw: string): 'skip' | 'overwrite' {
  const m = mode.trim().toLowerCase()
  if (m !== 'skip' && m !== 'overwrite') throw new Error(`未知导入模式 '${raw}'（可选：skip / overwrite）`)
  return m
}

export function byteLen(s: string): number {
  return new TextEncoder().encode(s).length
}

export function rowToDimension(d: DimRow): Dimension {
  return {
    id: d.id, key: d.key, nameCn: d.nameCn, nameEn: d.nameEn ?? '',
    sortOrder: d.sortOrder, isMultiSelect: d.isMultiSelect !== 0, isEnabled: d.isEnabled !== 0,
    icon: d.icon, createdAt: d.createdAt, updatedAt: d.updatedAt,
  }
}

export function rowToModule(m: ModRow, dimKey: string | null): Module {
  return {
    id: m.id, dimensionId: m.dimensionId, contentEn: m.contentEn, displayName: m.displayName,
    weight: m.weight, isEnabled: m.isEnabled !== 0, isNsfw: m.isNsfw !== 0,
    usageCount: m.usageCount, exampleImage: m.exampleImage, notes: m.notes, dimensionKey: dimKey,
  }
}

export function rowToAssembly(a: AsmRow): Assembly {
  return {
    id: a.id, title: a.title, promptIrJson: a.promptIr, finalPrompt: a.finalPrompt,
    modelProfile: a.modelProfile, createdAt: a.createdAt, isFavorite: a.isFavorite !== 0,
  }
}

export function rowToTemplate(t: TplRow): Template {
  return {
    id: t.id, name: t.name, description: t.description,
    configJson: t.configJson ?? '', coverPrompt: t.coverPrompt, createdAt: t.createdAt,
  }
}

export async function dimKeyMap(): Promise<Map<string, { key: string; sortOrder: number }>> {
  const db = await getDb()
  const rows = await tx(db, 'dimensions', 'readonly', (s) => getAll<DimRow>(s['dimensions']!))
  const map = new Map<string, { key: string; sortOrder: number }>()
  for (const d of rows) map.set(d.id, { key: d.key, sortOrder: d.sortOrder })
  return map
}

/** 同维度 + contentEn 精确命中（取 createdAt 最早），对标 find_module_hit。 */
export async function findModuleHit(dimensionId: string, contentEn: string): Promise<ModRow | null> {
  const db = await getDb()
  const rows = await tx(db, 'modules', 'readonly', (s) =>
    getAllByIndex<ModRow>(s['modules']!, 'contentEn', contentEn),
  )
  const hits = rows
    .filter((m) => m.dimensionId === dimensionId && m.isDeleted === 0)
    .sort((a, b) => a.createdAt - b.createdAt)
  return hits[0] ?? null
}

/** 事务内按维度 + contentEn 精确查找（最早 created）。 */
export async function findModuleHitTx(store: IDBObjectStore, dimensionId: string, contentEn: string): Promise<ModRow | null> {
  const rows = await getAllByIndex<ModRow>(store, 'contentEn', contentEn)
  const hits = rows
    .filter((m) => m.dimensionId === dimensionId && m.isDeleted === 0)
    .sort((a, b) => a.createdAt - b.createdAt)
  return hits[0] ?? null
}

/** 快照占位：原条目缺失/已删时用 IR 快照或 [已失效] 占位，对标 resolve_module_with_fallback。 */
export function resolveModuleWithFallback(args: {
  mid: string
  contentEn: string | null
  displayName: string | null
  modWeight: number | null
  dimensionId: string | null
  dimKey: string | null
  isDeleted: boolean
  snapshot: { text: string; dk: string; weight: number } | null
  fallbackDk: string | null
}): Module {
  const { mid, contentEn, displayName, modWeight, dimensionId, dimKey, isDeleted, snapshot, fallbackDk } = args
  if (contentEn == null || isDeleted) {
    const text = snapshot?.text ?? `[已失效:${safeTruncate(mid, 8)}]`
    const dk = snapshot?.dk ?? fallbackDk ?? dimKey ?? ''
    const w = snapshot?.weight ?? 1.0
    return {
      id: mid, dimensionId: dimensionId ?? '', contentEn: text,
      displayName: `[已失效] ${safeTruncate(text, 20)}`,
      weight: modWeight ?? w, isEnabled: false, isNsfw: false, usageCount: 0,
      exampleImage: null, notes: '[原条目已删除，已用快照占位]', dimensionKey: dk,
    }
  }
  return {
    id: mid, dimensionId: dimensionId ?? '', contentEn, displayName: displayName ?? '',
    weight: modWeight ?? 1.0, isEnabled: true, isNsfw: false, usageCount: 0,
    exampleImage: null, notes: null, dimensionKey: dimKey,
  }
}

export type IrSegmentDto = { dimensionKey: string; text: string; weight: number; sourceModuleId: string }

export function parseIrJson(irJson: string): IrSegmentDto[] {
  let v: unknown
  try {
    v = JSON.parse(irJson)
  } catch (e) {
    throw new Error(`prompt_ir 解析失败: ${e instanceof Error ? e.message : String(e)}`)
  }
  const segs = (v as { segments?: unknown }).segments
  if (!Array.isArray(segs)) throw new Error('prompt_ir 解析失败: 缺少 segments 数组')
  return (segs as Record<string, unknown>[]).map((s) => ({
    dimensionKey: String(s['dimensionKey'] ?? ''),
    text: String(s['text'] ?? ''),
    weight: Number(s['weight'] ?? 1.0),
    sourceModuleId: String(s['sourceModuleId'] ?? ''),
  }))
}
