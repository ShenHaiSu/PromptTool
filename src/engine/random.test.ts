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
