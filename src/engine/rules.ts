/**
 * 规则引擎 legacy 入口 — need02 已转调数据驱动的 ruleEngine（04 §6）
 * R01 套装互斥 / R02 裸足 / R03 室内外语义由 LEGACY_DEFAULT_RULES 承载。
 *
 * @deprecated 用 ruleEngine.evaluateRules 替代；保留以兼容既有单测与调用方
 */
import { evaluateRules, LEGACY_DEFAULT_RULES } from './ruleEngine'
import type { SelectedItem } from './models'

export function applyRules(selected: SelectedItem[]): [SelectedItem[], string[]] {
  const segments = selected.map((it) => ({
    dimensionKey: it.module.dimensionKey ?? '',
    text: it.module.contentEn,
    weight: it.weightOverride != null ? it.weightOverride : it.module.weight,
    sourceModuleId: it.module.id,
  }))
  const lockedIndexes = new Set<number>()
  selected.forEach((it, i) => { if (it.locked) lockedIndexes.add(i) })
  const findings = evaluateRules({ segments, rules: LEGACY_DEFAULT_RULES, lockedIndexes })
  // 按“删段”语义应用 fix：从后往前移除（fix.removeIndexes 已降序）
  const removed = new Set<number>()
  for (const f of findings) {
    if (!f.fix) continue
    for (const idx of f.fix.removeIndexes) removed.add(idx)
  }
  const filtered = selected.filter((_, i) => !removed.has(i))
  return [filtered, findings.map((f) => f.message)]
}
