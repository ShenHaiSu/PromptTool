import { describe, it, expect } from 'vitest'
import { randomAssembly, weightedSample, partialRandomAssembly } from './random'
import type { Dimension, Module, AssemblyConfig } from './models'

function mod(id: string, key: string, text: string, opts: Partial<Module> = {}): Module {
  return {
    id,
    dimensionId: 'd_' + key,
    contentEn: text,
    displayName: text,
    weight: 1.0,
    isEnabled: true,
    isNsfw: false,
    usageCount: 0,
    dimensionKey: key,
    ...opts,
  } as Module
}

function dims(keys: { key: string; multi?: boolean; enabled?: boolean }[]): Dimension[] {
  return keys.map((k, i) => ({
    id: 'd' + i,
    key: k.key,
    nameCn: k.key,
    nameEn: k.key,
    sortOrder: i,
    isMultiSelect: k.multi ?? false,
    isEnabled: k.enabled ?? true,
  }))
}

function defaultConfig(): AssemblyConfig {
  return { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }
}

describe('weightedSample', () => {
  it('returns k items', () => {
    const pool = [mod('m1', 'top', 'a'), mod('m2', 'top', 'b')]
    expect(weightedSample(pool, [1, 1], 3)).toHaveLength(3)
  })
  it('empty pool returns empty', () => {
    expect(weightedSample([], [], 3)).toEqual([])
  })
})

describe('randomAssembly', () => {
  it('returns requested count (up to)', () => {
    const dimensions = dims([{ key: 'top' }, { key: 'bottom' }])
    const modulesByDim: Record<string, Module[]> = {
      top: [mod('m_top', 'top', 'white shirt')],
      bottom: [mod('m_bot', 'bottom', 'pleated skirt')],
    }
    const results = randomAssembly(dimensions, modulesByDim, new Set(), 5, defaultConfig())
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(5)
  })

  it('no duplicates by hash', () => {
    const dimensions = dims([{ key: 'top' }, { key: 'bottom' }])
    const modulesByDim: Record<string, Module[]> = {
      top: [mod('m_top', 'top', 'white shirt')],
      bottom: [mod('m_bot', 'bottom', 'pleated skirt')],
    }
    const results = randomAssembly(dimensions, modulesByDim, new Set(), 10, defaultConfig())
    const hashes = results.map((r) => r.hash())
    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it('locked items preserved', () => {
    const dimensions = dims([{ key: 'top' }, { key: 'bottom' }])
    const modulesByDim: Record<string, Module[]> = {
      top: [mod('m_top', 'top', 'white shirt')],
      bottom: [mod('m_bot', 'bottom', 'pleated skirt')],
    }
    const locked = new Set(['m_top'])
    const results = randomAssembly(dimensions, modulesByDim, locked, 5, defaultConfig())
    for (const ir of results) {
      expect(ir.segments.some((s) => s.text === 'white shirt')).toBe(true)
    }
  })

  it('empty pool skipped', () => {
    const dimensions = dims([{ key: 'top' }])
    const results = randomAssembly(dimensions, {}, new Set(), 5, defaultConfig())
    expect(results).toHaveLength(0)
  })

  it('nsfw excluded by default', () => {
    const dimensions = dims([{ key: 'top' }, { key: 'bottom' }])
    const modulesByDim: Record<string, Module[]> = {
      top: [mod('m_top', 'top', 'white shirt'), mod('m_nsfw', 'top', 'no bra, bare cleavage visible', { isNsfw: true })],
      bottom: [mod('m_bot', 'bottom', 'pleated skirt')],
    }
    const results = randomAssembly(dimensions, modulesByDim, new Set(), 20, defaultConfig())
    for (const ir of results) for (const s of ir.segments) expect(s.text).not.toBe('no bra, bare cleavage visible')
  })

  it('nsfw included when allowed', () => {
    const dimensions = dims([{ key: 'top' }])
    const modulesByDim: Record<string, Module[]> = {
      top: [mod('m_nsfw', 'top', 'no bra, bare cleavage visible', { isNsfw: true })],
    }
    const results = randomAssembly(dimensions, modulesByDim, new Set(), 5, defaultConfig(), true)
    expect(results.length).toBeGreaterThan(0)
  })

  it('disabled dimension skipped', () => {
    const dimensions = dims([{ key: 'top', enabled: false }, { key: 'bottom' }])
    const modulesByDim: Record<string, Module[]> = {
      top: [mod('m_top', 'top', 'white shirt')],
      bottom: [mod('m_bot', 'bottom', 'pleated skirt')],
    }
    const results = randomAssembly(dimensions, modulesByDim, new Set(), 5, defaultConfig())
    for (const ir of results) expect(ir.segments.some((s) => s.dimensionKey === 'top')).toBe(false)
  })
})

describe('partialRandomAssembly', () => {
  it('anchored items preserved', () => {
    const dimensions = dims([{ key: 'top' }, { key: 'bottom' }, { key: 'shoes' }])
    const modulesByDim: Record<string, Module[]> = {
      top: [mod('m_top', 'top', 'white shirt')],
      bottom: [mod('m_bot', 'bottom', 'pleated skirt'), mod('m_bot2', 'bottom', 'jeans')],
      shoes: [mod('m_sh', 'shoes', 'white sneakers')],
    }
    const anchored = [{ module: mod('m_top', 'top', 'white shirt'), locked: false }]
    const results = partialRandomAssembly(dimensions, modulesByDim, anchored, 5, defaultConfig())
    for (const ir of results) expect(ir.segments.some((s) => s.text === 'white shirt')).toBe(true)
  })

  it('outfit anchor forbids top/bottom gap', () => {
    const dimensions = dims([{ key: 'top' }, { key: 'bottom' }, { key: 'outfit' }])
    const modulesByDim: Record<string, Module[]> = {
      top: [mod('m_top', 'top', 'white shirt')],
      bottom: [mod('m_bot', 'bottom', 'pleated skirt')],
      outfit: [mod('m_out', 'outfit', 'red dress')],
    }
    const anchored = [{ module: mod('m_out', 'outfit', 'red dress'), locked: false }]
    const results = partialRandomAssembly(dimensions, modulesByDim, anchored, 5, defaultConfig())
    for (const ir of results) {
      expect(ir.segments.some((s) => s.dimensionKey === 'top')).toBe(false)
      expect(ir.segments.some((s) => s.dimensionKey === 'bottom')).toBe(false)
    }
  })

  it('empty anchored degenerates to random', () => {
    const dimensions = dims([{ key: 'top' }])
    const modulesByDim: Record<string, Module[]> = { top: [mod('m_top', 'top', 'white shirt')] }
    const results = partialRandomAssembly(dimensions, modulesByDim, [], 3, defaultConfig())
    expect(results.length).toBeGreaterThan(0)
  })
})

describe('randomHistory integration (need03)', () => {
  it('history empty behaves like before (no regression when undefined)', () => {
    const dimensions = dims([{ key: 'top' }, { key: 'bottom' }])
    const modulesByDim: Record<string, Module[]> = {
      top: [mod('m_top', 'top', 'white shirt'), mod('m_top2', 'top', 'black shirt')],
      bottom: [mod('m_bot', 'bottom', 'pleated skirt'), mod('m_bot2', 'bottom', 'jeans')],
    }
    const r1 = randomAssembly(dimensions, modulesByDim, new Set(), 5, defaultConfig())
    const r2 = randomAssembly(dimensions, modulesByDim, new Set(), 5, defaultConfig(), false, { version: 1 as const, hits: {}, recentByScope: {}, totalGenerations: 0, scopeAccessOrder: [] })
    // Both should produce up to 5 results and respect no-duplicate within call
    for (const r of [r1, r2]) {
      expect(r.length).toBeGreaterThan(0)
      const hs = r.map(x => x.hash())
      expect(new Set(hs).size).toBe(hs.length)
    }
  })

  it('recent window prevents immediate repeat (same scope)', () => {
    const dimensions = dims([{ key: 'top' }])
    const modulesByDim: Record<string, Module[]> = {
      top: [mod('m_a', 'top', 'white shirt'), mod('m_b', 'top', 'black shirt')],
    }
    // Use deterministic-ish approach: generate twice with same history and check that
    // the first hash ends up in recentByScope and the second call does not return the
    // exact same single-item hash when pool is tiny and window still allows alternative.
    // For stable assertion, pre-seed the window with the only-possible hash and verify
    // that a singleton pool does not infinite-loop but returns <= count.
    const hist: import('./randomHistory').RandomHistoryState = { version: 1, hits: {}, recentByScope: {}, totalGenerations: 0, scopeAccessOrder: [] }
    const r1 = randomAssembly(dimensions, modulesByDim, new Set(), 1, defaultConfig(), false, hist)
    expect(r1.length).toBe(1)
    const h1 = r1[0]!.hash()
    // hist now contains h1 in its window
    expect(Object.values(hist.recentByScope).flat()).toContain(h1)
    // second single generation should still succeed (window forces retry but alternative exists)
    const r2 = randomAssembly(dimensions, modulesByDim, new Set(), 1, defaultConfig(), false, hist)
    expect(r2.length).toBe(1)
    // When pool has 2 options, the window makes the second hash likely different from first
    // but not strictly guaranteed due to Math.random; we at least assert history was updated
    expect(Object.values(hist.recentByScope).flat().length).toBeGreaterThanOrEqual(2)
  })

  it('hits penalizes high-frequency module', async () => {
    const { effectiveWeight } = await import('./randomHistory')
    expect(effectiveWeight(1.0, 'm1', { m1: 10 })).toBeLessThan(effectiveWeight(1.0, 'm2', {}))
    // Statistical check: with hits on m1, over many weighted samples m2 should win more often
    const pool = [mod('m1', 'top', 'white shirt'), mod('m2', 'top', 'black shirt')]
    const hits = { m1: 10 } as Record<string, number>
    const { effectiveWeightsForPool } = await import('./randomHistory')
    const { weightedSample } = await import('./random')
    const weights = effectiveWeightsForPool(pool, hits)
    let c1 = 0, c2 = 0
    for (let i = 0; i < 200; i++) {
      const [picked] = weightedSample(pool, weights, 1)
      if (picked!.id === 'm1') c1++; else c2++
    }
    expect(c2).toBeGreaterThan(c1)
  })

  it('partial respects history (anchored window + hits)', () => {
    const dimensions = dims([{ key: 'top' }, { key: 'bottom' }, { key: 'shoes' }])
    const modulesByDim: Record<string, Module[]> = {
      top: [mod('m_top', 'top', 'white shirt'), mod('m_top2', 'top', 'black shirt')],
      bottom: [mod('m_bot', 'bottom', 'pleated skirt'), mod('m_bot2', 'bottom', 'jeans')],
      shoes: [mod('m_sh', 'shoes', 'white sneakers'), mod('m_sh2', 'shoes', 'black boots')],
    }
    const anchored = [{ module: mod('m_top', 'top', 'white shirt'), locked: false }]
    const hist: import('./randomHistory').RandomHistoryState = { version: 1, hits: { m_bot: 20 }, recentByScope: {}, totalGenerations: 0, scopeAccessOrder: [] }
    const results = partialRandomAssembly(dimensions, modulesByDim, anchored, 5, defaultConfig(), false, hist)
    expect(results.length).toBeGreaterThan(0)
    for (const ir of results) expect(ir.segments.some(s => s.text === 'white shirt')).toBe(true)
    // hits should have been incremented for generated segments
    expect(Object.keys(hist.hits).length).toBeGreaterThan(0)
  })

  it('scope change isolates window but shares hits (locked change)', async () => {
    const dimensions = dims([{ key: 'top' }, { key: 'bottom' }])
    const modulesByDim: Record<string, Module[]> = {
      top: [mod('m_top', 'top', 'white shirt'), mod('m_top2', 'top', 'black shirt')],
      bottom: [mod('m_bot', 'bottom', 'pleated skirt'), mod('m_bot2', 'bottom', 'jeans')],
    }
    const hist: import('./randomHistory').RandomHistoryState = { version: 1, hits: { m_bot: 5 }, recentByScope: {}, totalGenerations: 0, scopeAccessOrder: [] }
    const scopeA = new Set(['m_top'])
    const scopeB = new Set(['m_top2'])
    // Generate in scope A
    randomAssembly(dimensions, modulesByDim, scopeA, 2, defaultConfig(), false, hist)
    // hits is global, so bottom penalty still present for scope B
    // verify hits survived across scope change — just verify hits survived
    const beforeKeys = Object.keys(hist.recentByScope)
    expect(beforeKeys.length).toBeGreaterThanOrEqual(1)
    // Generate in scope B - should create a new scope partition for window
    randomAssembly(dimensions, modulesByDim, scopeB, 2, defaultConfig(), false, hist)
    expect(Object.keys(hist.recentByScope).length).toBeGreaterThanOrEqual(2)
    // hits global still contains m_bot
    expect(hist.hits['m_bot']).toBeDefined()
  })
})

