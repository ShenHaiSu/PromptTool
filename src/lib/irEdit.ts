/**
 * need02 IR 编辑纯函数（05 §3 唯一口径）
 * 全部不可变更新（返回新数组），无 IO，可单测。
 */
import { adaptToModel } from '@/engine/adapters'
import { PromptIR, IR_SNAPSHOT_VERSION, type AssemblyConfig, type FindingFix, type IRSegment, type SelectedItem } from '@/engine/models'

export function cloneSegments(segs: IRSegment[]): IRSegment[] {
  return segs.map((s) => ({ ...s }))
}

export function updateSegmentText(segs: IRSegment[], index: number, text: string): IRSegment[] {
  if (index < 0 || index >= segs.length) return cloneSegments(segs)
  return segs.map((s, i) => (i === index ? { ...s, text } : { ...s }))
}

export function clampWeight(w: number): number {
  if (!Number.isFinite(w)) return 1.0
  const clamped = Math.min(2.0, Math.max(0.5, w))
  return Math.round(clamped * 10) / 10
}

export function updateSegmentWeight(segs: IRSegment[], index: number, weight: number): IRSegment[] {
  if (index < 0 || index >= segs.length) return cloneSegments(segs)
  return segs.map((s, i) => (i === index ? { ...s, weight: clampWeight(weight) } : { ...s }))
}

export function removeSegment(segs: IRSegment[], index: number): IRSegment[] {
  if (index < 0 || index >= segs.length) return cloneSegments(segs)
  return segs.filter((_, i) => i !== index).map((s) => ({ ...s }))
}

export function moveSegment(segs: IRSegment[], from: number, to: number): IRSegment[] {
  const next = cloneSegments(segs)
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next
  const [moved] = next.splice(from, 1)
  if (moved) next.splice(to, 0, moved)
  return next
}

export function appendEmptySegment(segs: IRSegment[]): IRSegment[] {
  return [...cloneSegments(segs), { dimensionKey: '', text: '', weight: 1, sourceModuleId: '' }]
}

/** fix.removeIndexes 降序 splice 语义：按快照下标过滤（与降序 splice 等价，纯函数更直接） */
export function applyFindingFix(segs: IRSegment[], fix: FindingFix): IRSegment[] {
  const remove = new Set(fix.removeIndexes.filter((i) => i >= 0 && i < segs.length))
  return segs.filter((_, i) => !remove.has(i)).map((s) => ({ ...s }))
}

/** 过滤空 text 后 adaptToModel（05 §2.1/§2.5） */
export function buildPreview(segs: IRSegment[], profile: string, config: AssemblyConfig): string {
  const ir = new PromptIR(
    segs.filter((s) => s.text.trim()).map((s) => ({ ...s })),
    [],
    [],
    IR_SNAPSHOT_VERSION,
  )
  return adaptToModel(ir, profile, config)
}

/**
 * 回映射 SelectedItem（快照语义，01 D9）：
 * module 尽量回填 {id: sourceModuleId, dimensionKey, contentEn: text, displayName: text前24字, weight}，
 * dimensionId 需查 library（按 dimensionKey→id），查不到置 ''（允许但需标注快照语义）。
 */
export function toSelectedItems(
  segs: IRSegment[],
  opts: { lockedIndexes: Set<number>; dimKeyToId?: Record<string, string> },
): SelectedItem[] {
  return segs
    .filter((s) => s.text.trim())
    .map((s, filteredIdx) => {
      // lockedIndexes 指向 draft 全量下标；过滤空段后下标漂移——调用方应先过滤再传，或此处按原文查找
      void filteredIdx
      return s
    })
    .map((s) => {
      const originalIndex = segs.indexOf(s)
      const text = s.text.trim()
      return {
        module: {
          id: s.sourceModuleId || `snapshot_${originalIndex}`,
          dimensionId: (s.dimensionKey && opts.dimKeyToId?.[s.dimensionKey]) || '',
          contentEn: text,
          displayName: text.length > 24 ? text.slice(0, 24) : text,
          weight: s.weight,
          isEnabled: true,
          isNsfw: false,
          usageCount: 0,
          dimensionKey: s.dimensionKey,
        },
        weightOverride: s.weight !== 1 ? s.weight : null,
        locked: opts.lockedIndexes.has(originalIndex),
      }
    })
}

export function shortHash(ir: PromptIR): string {
  return ir.hash().slice(0, 8)
}
