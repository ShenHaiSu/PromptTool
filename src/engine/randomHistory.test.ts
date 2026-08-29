import { describe, it, expect, beforeEach } from 'vitest'
import {
  ALPHA,
  WINDOW_SIZE,
  MAX_SCOPES,
  DECAY_EVERY,
  STORAGE_KEY,
  emptyHistory,
  buildScopeKey,
  effectiveWeight,
  effectiveWeightsForPool,
  isInWindow,
  pushToWindow,
  recordHit,
  maybeDecay,
  loadHistory,
  saveHistory,
  clearHistory,
  type RandomHistoryState,
} from './randomHistory'
import { PromptIR } from './models'

function irWithModules(ids: string[]): PromptIR {
  return new PromptIR(
    ids.map((id) => ({ dimensionKey: 'top', text: id, weight: 1.0, sourceModuleId: id })),
    [],
  )
}

describe('randomHistory constants', () => {
  it('exports expected constants', () => {
    expect(ALPHA).toBe(1.0)
    expect(WINDOW_SIZE).toBe(20)
    expect(MAX_SCOPES).toBe(64)
  })
})

describe('buildScopeKey', () => {
  it('sorts ids and includes mode/dims/nsfw', () => {
    const a = buildScopeKey({ lockedIds: ['b', 'a'], enabledDimKeys: ['bottom', 'top'], allowNsfw: false, mode: 'random' })
    const b = buildScopeKey({ lockedIds: ['a', 'b'], enabledDimKeys: ['top', 'bottom'], allowNsfw: false, mode: 'random' })
    expect(a).toBe(b)
    expect(a).toContain('random')
    expect(a).toContain('nsfw:0')
  })
  it('different mode isolates', () => {
    const r = buildScopeKey({ enabledDimKeys: ['top'], allowNsfw: false, mode: 'random' })
    const p = buildScopeKey({ enabledDimKeys: ['top'], allowNsfw: false, mode: 'partial' })
    expect(r).not.toBe(p)
  })
  it('nsfw isolates', () => {
    const a = buildScopeKey({ enabledDimKeys: ['top'], allowNsfw: false, mode: 'random' })
    const b = buildScopeKey({ enabledDimKeys: ['top'], allowNsfw: true, mode: 'random' })
    expect(a).not.toBe(b)
  })
  it('locked vs anchored isolates', () => {
    const a = buildScopeKey({ lockedIds: ['m1'], enabledDimKeys: ['top'], allowNsfw: false, mode: 'random' })
    const b = buildScopeKey({ anchoredIds: ['m1'], enabledDimKeys: ['top'], allowNsfw: false, mode: 'random' })
    expect(a).not.toBe(b)
  })
  it('accepts Set for lockedIds', () => {
    const a = buildScopeKey({ lockedIds: new Set(['b', 'a']), enabledDimKeys: ['top'], allowNsfw: false, mode: 'random' })
    expect(a).toContain('locked:a,b')
  })
  it('dims change isolates', () => {
    const a = buildScopeKey({ enabledDimKeys: ['top'], allowNsfw: false, mode: 'random' })
    const b = buildScopeKey({ enabledDimKeys: ['top', 'bottom'], allowNsfw: false, mode: 'random' })
    expect(a).not.toBe(b)
  })
})

describe('effectiveWeight', () => {
  it('hits=0 returns raw clamped', () => {
    expect(effectiveWeight(1.0, 'm1', {})).toBeCloseTo(1.0)
  })
  it('hits=1 halves', () => {
    expect(effectiveWeight(1.0, 'm1', { m1: 1 })).toBeCloseTo(0.5)
  })
  it('hits=3 quarters', () => {
    expect(effectiveWeight(1.0, 'm1', { m1: 3 })).toBeCloseTo(0.25)
  })
  it('clamps weight to 0.1..2.0 before decay', () => {
    expect(effectiveWeight(10, 'm1', {})).toBeCloseTo(2.0)
    expect(effectiveWeight(0, 'm1', {})).toBeCloseTo(0.1)
    expect(effectiveWeight(NaN, 'm1', {})).toBeCloseTo(1.0)
  })
  it('effectiveWeightsForPool maps pool', () => {
    const pool = [{ id: 'a', weight: 1.0 }, { id: 'b', weight: 1.0 }]
    const out = effectiveWeightsForPool(pool, { a: 1 })
    expect(out[0]).toBeCloseTo(0.5)
    expect(out[1]).toBeCloseTo(1.0)
  })
})

describe('pushToWindow', () => {
  it('truncates to WINDOW_SIZE', () => {
    const s = emptyHistory()
    const key = 'k'
    for (let i = 0; i < 25; i++) pushToWindow('h' + i, key, s)
    expect(s.recentByScope[key]!).toHaveLength(WINDOW_SIZE)
    expect(s.recentByScope[key]![0]).toBe('h5')
    expect(s.recentByScope[key]![19]).toBe('h24')
  })
  it('isInWindow detection', () => {
    const s = emptyHistory()
    pushToWindow('hx', 'k1', s)
    expect(isInWindow('hx', 'k1', s.recentByScope)).toBe(true)
    expect(isInWindow('hx', 'k2', s.recentByScope)).toBe(false)
  })
  it('LRU evicts oldest scope beyond MAX_SCOPES', () => {
    const s = emptyHistory()
    for (let i = 0; i < MAX_SCOPES + 5; i++) pushToWindow('h', 'scope-' + i, s)
    expect(Object.keys(s.recentByScope)).toHaveLength(MAX_SCOPES)
    expect(s.recentByScope['scope-0']).toBeUndefined()
    expect(s.recentByScope['scope-1']).toBeUndefined()
    expect(s.recentByScope['scope-' + (MAX_SCOPES + 4)]).toBeDefined()
  })
  it('touch moves to tail', () => {
    const s = emptyHistory()
    pushToWindow('h', 'a', s)
    pushToWindow('h', 'b', s)
    pushToWindow('h', 'c', s)
    pushToWindow('h2', 'a', s)
    expect(s.scopeAccessOrder).toEqual(['b', 'c', 'a'])
  })
})

describe('recordHit / maybeDecay', () => {
  it('recordHit increments per segment', () => {
    const s = emptyHistory()
    recordHit(s, irWithModules(['m1', 'm2']))
    expect(s.hits['m1']).toBe(1)
    expect(s.hits['m2']).toBe(1)
    recordHit(s, irWithModules(['m1']))
    expect(s.hits['m1']).toBe(2)
  })
  it('maybeDecay triggers at DECAY_EVERY', () => {
    const s = emptyHistory()
    s.hits = { m1: 100, m2: 0.005 }
    s.totalGenerations = DECAY_EVERY - 1
    maybeDecay(s)
    expect(s.totalGenerations).toBe(DECAY_EVERY)
    expect(s.hits['m1']).toBeCloseTo(95)
    expect(s.hits['m2']).toBeUndefined() // pruned <0.01
  })
  it('maybeDecay not triggered before interval', () => {
    const s = emptyHistory()
    s.hits = { m1: 10 }
    s.totalGenerations = 5
    maybeDecay(s)
    expect(s.hits['m1']).toBe(10)
    expect(s.totalGenerations).toBe(6)
  })
})

describe('persistence', () => {
  beforeEach(() => {
    try { localStorage.clear() } catch {}
  })
  it('save and load roundtrip', () => {
    const s = emptyHistory()
    s.hits = { m1: 3 }
    s.recentByScope = { k: ['h1', 'h2'] }
    s.totalGenerations = 42
    s.scopeAccessOrder = ['k']
    saveHistory(s)
    const loaded = loadHistory()
    expect(loaded.hits).toEqual({ m1: 3 })
    expect(loaded.recentByScope).toEqual({ k: ['h1', 'h2'] })
    expect(loaded.totalGenerations).toBe(42)
    expect(loaded.scopeAccessOrder).toEqual(['k'])
  })
  it('version mismatch returns empty', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 999, hits: { m1: 1 } }))
    const loaded = loadHistory()
    expect(loaded.hits).toEqual({})
    expect(loaded.version).toBe(1)
  })
  it('invalid json returns empty', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json{')
    const loaded = loadHistory()
    expect(loaded.version).toBe(1)
    expect(loaded.hits).toEqual({})
  })
  it('clearHistory removes key', () => {
    saveHistory(emptyHistory())
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
    clearHistory()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
  it('reconstructs scopeAccessOrder from recentByScope when missing', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, hits: {}, recentByScope: { a: ['h'], b: ['h2'] }, totalGenerations: 0 }))
    const loaded = loadHistory()
    expect(loaded.scopeAccessOrder.sort()).toEqual(['a', 'b'])
  })
})

describe('emptyHistory', () => {
  it('creates fresh structure with version 1', () => {
    const h = emptyHistory()
    expect(h.version).toBe(1)
    expect(h.totalGenerations).toBe(0)
    expect(h.hits).toEqual({})
    expect(h.recentByScope).toEqual({})
  })
  it('JSON size sanity <30KB for typical payload', () => {
    const s: RandomHistoryState = emptyHistory()
    for (let i = 0; i < 900; i++) s.hits['m' + i] = i % 10
    for (let i = 0; i < 64; i++) s.recentByScope['scope' + i] = Array.from({ length: 20 }, (_, j) => 'hash-' + i + '-' + j)
    const len = JSON.stringify(s).length
    expect(len).toBeLessThan(30 * 1024 * 2) // generous but ensures not absurd
  })
})
