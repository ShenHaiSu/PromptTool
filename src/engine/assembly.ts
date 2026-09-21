/**
 * 拼装引擎 — 对标 src/engine/assembly.py
 */
import { adaptToModel } from './adapters'
import { applyRules } from './rules'
import { evaluateRules } from './ruleEngine'
import type { AssemblyConfig, Dimension, SelectedItem } from './models'
import { PromptIR, IR_SNAPSHOT_VERSION, type IRSegment } from './models'
import type { EngineRule } from './ruleTypes'

export function assemble(
  selected: SelectedItem[],
  config: AssemblyConfig,
  rules?: EngineRule[],
  dimOrderMap?: Record<string, number>,
): { ir: PromptIR; finalPrompt: string } {
  // need02：传入 rules 即走数据驱动求值（段快照 + 锁定集合由 SelectedItem 映射），否则回退 legacy applyRules
  let filtered: SelectedItem[]
  let warnings: string[]
  let findings: PromptIR['findings'] = []
  if (rules) {
    const segments = selected.map(
      (it): IRSegment => ({
        dimensionKey: it.module.dimensionKey ?? '',
        text: it.module.contentEn,
        weight: it.weightOverride != null ? it.weightOverride : it.module.weight,
        sourceModuleId: it.module.id,
      }),
    )
    const lockedIndexes = new Set<number>()
    selected.forEach((it, i) => { if (it.locked) lockedIndexes.add(i) })
    findings = evaluateRules({ segments, rules, lockedIndexes })
    const removed = new Set<number>()
    for (const f of findings) {
      if (!f.fix) continue
      for (const idx of f.fix.removeIndexes) removed.add(idx)
    }
    filtered = selected.filter((_, i) => !removed.has(i))
    warnings = [...new Set(findings.map((f) => f.message))]
  } else {
    ;[filtered, warnings] = applyRules(selected)
  }
  const ordered = sortByOrder(filtered, config.sortBy, dimOrderMap)
  const ir = new PromptIR(
    ordered.map(
      (it): IRSegment => ({
        dimensionKey: it.module.dimensionKey ?? '',
        text: it.module.contentEn,
        weight: it.weightOverride != null ? it.weightOverride : it.module.weight,
        sourceModuleId: it.module.id,
      }),
    ),
    warnings,
    findings,
    IR_SNAPSHOT_VERSION,
  )
  const finalPrompt = adaptToModel(ir, config.modelProfile, config)
  return { ir, finalPrompt }
}

const DIM_ORDER: Record<string, number> = {
  gender: 0,
  ethnicity: 1,
  height: 2,
  body: 3,
  face: 4,
  top: 5,
  bottom: 6,
  outfit: 7,
  shoes: 8,
  accessories: 9,
  pose: 10,
  props: 11,
  background: 12,
  camera: 13,
}

export function buildDimOrderMap(dims: Dimension[]): Record<string, number> {
  return Object.fromEntries(dims.map((d) => [d.key, d.sortOrder]))
}

export function sortByOrder(items: SelectedItem[], mode: string, dimOrderMap?: Record<string, number>): SelectedItem[] {
  if (mode === 'customDragOrder') return [...items]
  // need04：L1 dimOrderMap（DB sortOrder 唯一真相源）> L2 legacy DIM_ORDER > L3 沉底
  return [...items].sort((a, b) => {
    const ka = a.module.dimensionKey ?? ''
    const kb = b.module.dimensionKey ?? ''
    const oa = dimOrderMap?.[ka] ?? DIM_ORDER[ka] ?? Number.MAX_SAFE_INTEGER
    const ob = dimOrderMap?.[kb] ?? DIM_ORDER[kb] ?? Number.MAX_SAFE_INTEGER
    return oa - ob
  })
}
