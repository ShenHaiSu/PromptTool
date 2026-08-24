/**
 * 拼装引擎 — 对标 src/engine/assembly.py
 */
import { adaptToModel } from './adapters'
import { applyRules } from './rules'
import type { AssemblyConfig, SelectedItem } from './models'
import { PromptIR, type IRSegment } from './models'

export function assemble(
  selected: SelectedItem[],
  config: AssemblyConfig,
): { ir: PromptIR; finalPrompt: string } {
  const [filtered, warnings] = applyRules(selected)
  const ordered = sortByOrder(filtered, config.sortBy)
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

export function sortByOrder(items: SelectedItem[], mode: string): SelectedItem[] {
  if (mode === 'customDragOrder') return [...items]
  return [...items].sort((a, b) => {
    const oa = DIM_ORDER[a.module.dimensionKey ?? ''] ?? 99
    const ob = DIM_ORDER[b.module.dimensionKey ?? ''] ?? 99
    return oa - ob
  })
}
