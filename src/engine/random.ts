/**
 * 随机引擎 — 对标 src/engine/random_engine.py
 * random.choices → weightedSample 自实现；partialRandomAssembly 禁忌/多选收敛平移
 */
import { assemble } from './assembly'
import { applyRules } from './rules'
import type { AssemblyConfig, Dimension, Module, SelectedItem } from './models'
import { PromptIR } from './models'
import {
  MAX_ATTEMPTS_FACTOR,
  buildScopeKey,
  effectiveWeightsForPool,
  isInWindow,
  pushToWindow,
  recordHit,
  maybeDecay,
  type RandomHistoryState,
} from './randomHistory'

export function weightedSample<T>(pool: T[], weights: number[], k: number): T[] {
  if (pool.length === 0 || k <= 0) return []
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return Array.from({ length: k }, () => pool[Math.floor(Math.random() * pool.length)]!)
  const result: T[] = []
  for (let i = 0; i < k; i++) {
    let r = Math.random() * total
    for (let j = 0; j < pool.length; j++) {
      r -= weights[j]!
      if (r <= 0) { result.push(pool[j]!); break }
    }
    // floating point fallback
    if (result.length <= i) result.push(pool[pool.length - 1]!)
  }
  return result
}

export function randomAssembly(
  dimensions: Dimension[],
  modulesByDim: Record<string, Module[]>,
  lockedModuleIds: Set<string>,
  count: number,
  config: AssemblyConfig,
  allowNsfw = false,
  history?: RandomHistoryState,
): PromptIR[] {
  const enabledDimKeys = dimensions.filter((d) => d.isEnabled).map((d) => d.key)
  const scopeKey = history
    ? buildScopeKey({ lockedIds: lockedModuleIds, enabledDimKeys, allowNsfw, mode: 'random' })
    : ''
  const results: PromptIR[] = []
  const seen = new Set<string>()
  const maxAttempts = count * MAX_ATTEMPTS_FACTOR
  let attempts = 0

  while (results.length < count && attempts < maxAttempts) {
    attempts++
    const picked: SelectedItem[] = []

    for (const dim of dimensions) {
      if (!dim.isEnabled) continue
      let pool = modulesByDim[dim.key] ?? []
      pool = pool.filter((m) => m.isEnabled)
      if (!allowNsfw) pool = pool.filter((m) => !m.isNsfw)
      if (pool.length === 0) continue

      const lockedInDim = pool.filter((m) => lockedModuleIds.has(m.id))
      if (lockedInDim.length > 0) {
        for (const m of lockedInDim) picked.push({ module: m, locked: true })
        continue
      }

      let n: number
      if (dim.isMultiSelect) n = Math.floor(Math.random() * (Math.min(2, pool.length) + 1))
      else n = 1
      if (n === 0) continue

      const weights = history ? effectiveWeightsForPool(pool, history.hits) : pool.map((m) => m.weight)
      const sampled = weightedSample(pool, weights, n)
      for (const m of sampled) picked.push({ module: m, locked: false })
    }

    if (picked.length === 0) continue
    const { ir } = assemble(picked, config)
    const h = ir.hash()
    if (history && isInWindow(h, scopeKey, history.recentByScope)) continue
    if (seen.has(h)) continue
    seen.add(h)
    results.push(ir)
    if (history) {
      recordHit(history, ir)
      pushToWindow(h, scopeKey, history)
    }
  }

  if (history) maybeDecay(history)

  return results
}

export function partialRandomAssembly(
  dimensions: Dimension[],
  modulesByDim: Record<string, Module[]>,
  anchoredItems: SelectedItem[],
  count: number,
  config: AssemblyConfig,
  allowNsfw = false,
  history?: RandomHistoryState,
): PromptIR[] {
  if (anchoredItems.length === 0) {
    return randomAssembly(dimensions, modulesByDim, new Set(), count, config, allowNsfw, history)
  }

  const [cleanAnchor] = applyRules([...anchoredItems])
  if (cleanAnchor.length === 0) {
    return randomAssembly(dimensions, modulesByDim, new Set(), count, config, allowNsfw, history)
  }

  const anchorDimKeys = new Set(
    cleanAnchor.map((it) => it.module.dimensionKey).filter(Boolean) as string[],
  )
  const forbiddenDims = new Set<string>()
  if (anchorDimKeys.has('outfit')) { forbiddenDims.add('top'); forbiddenDims.add('bottom') }
  if (anchorDimKeys.has('top') || anchorDimKeys.has('bottom')) forbiddenDims.add('outfit')

  const gapDimensions = dimensions.filter(
    (d) => d.isEnabled && !anchorDimKeys.has(d.key) && !forbiddenDims.has(d.key) && (modulesByDim[d.key]?.length ?? 0) > 0,
  )

  const anchoredIds = cleanAnchor.map((it) => it.module.id)
  const enabledDimKeys = dimensions.filter((d) => d.isEnabled).map((d) => d.key)
  const scopeKey = history
    ? buildScopeKey({ anchoredIds, enabledDimKeys, allowNsfw, mode: 'partial' })
    : ''

  const results: PromptIR[] = []
  const seen = new Set<string>()
  const maxAttempts = count * MAX_ATTEMPTS_FACTOR
  let attempts = 0

  while (results.length < count && attempts < maxAttempts) {
    attempts++
    const picked: SelectedItem[] = cleanAnchor.map((it) => ({ ...it, module: { ...it.module } }))

    for (const dim of gapDimensions) {
      let pool = modulesByDim[dim.key] ?? []
      pool = pool.filter((m) => m.isEnabled)
      if (!allowNsfw) pool = pool.filter((m) => !m.isNsfw)
      if (pool.length === 0) continue
      pool = filterPoolByAnchor(pool, cleanAnchor, dim.key)
      if (pool.length === 0) continue

      let n: number
      if (dim.isMultiSelect) {
        const anchoredInDim = cleanAnchor.filter((it) => it.module.dimensionKey === dim.key).length
        if (anchoredInDim > 0) n = Math.floor(Math.random() * (Math.min(1, pool.length) + 1))
        else n = Math.floor(Math.random() * (Math.min(2, pool.length) + 1))
      } else n = 1
      if (n === 0) continue
      const weights = history ? effectiveWeightsForPool(pool, history.hits) : pool.map((m) => m.weight)
      const sampled = weightedSample(pool, weights, n)
      for (const m of sampled) picked.push({ module: m, locked: false })
    }

    if (picked.length === 0) continue
    const { ir } = assemble(picked, config)
    const h = ir.hash()
    if (history && isInWindow(h, scopeKey, history.recentByScope)) continue
    if (seen.has(h)) continue
    seen.add(h)
    results.push(ir)
    if (history) {
      recordHit(history, ir)
      pushToWindow(h, scopeKey, history)
    }
  }

  if (history) maybeDecay(history)

  return results
}

function filterPoolByAnchor(pool: Module[], anchoredItems: SelectedItem[], dimKey: string): Module[] {
  if (dimKey === 'shoes') {
    const hasBarefootAnchor = anchoredItems.some(
      (it) => it.module.dimensionKey === 'shoes' && it.module.contentEn.toLowerCase().includes('barefoot'),
    )
    const hasShoesAnchor = anchoredItems.some(
      (it) => it.module.dimensionKey === 'shoes' && !it.module.contentEn.toLowerCase().includes('barefoot'),
    )
    if (hasBarefootAnchor && !hasShoesAnchor) return pool.filter((m) => m.contentEn.toLowerCase().includes('barefoot'))
    if (hasShoesAnchor && !hasBarefootAnchor) return pool.filter((m) => !m.contentEn.toLowerCase().includes('barefoot'))
  }
  if (dimKey === 'background') {
    const hasStudio = anchoredItems.some(
      (it) => it.module.dimensionKey === 'background' && it.module.contentEn.toLowerCase().includes('studio'),
    )
    const hasOutdoor = anchoredItems.some(
      (it) => it.module.dimensionKey === 'background' && ['beach', 'sunset', 'street', 'rooftop'].some((kw) => it.module.contentEn.toLowerCase().includes(kw)),
    )
    if (hasStudio) return pool.filter((m) => !['beach', 'sunset', 'street', 'rooftop'].some((kw) => m.contentEn.toLowerCase().includes(kw)))
    if (hasOutdoor) return pool.filter((m) => !m.contentEn.toLowerCase().includes('studio'))
  }
  return pool
}
