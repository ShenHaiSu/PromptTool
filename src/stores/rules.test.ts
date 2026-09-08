/**
 * need02 T4：rules store 乐观回滚单测（mock invoke 失败）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

import { useRulesStore } from './rules'

beforeEach(() => {
  setActivePinia(createPinia())
  mockInvoke.mockReset()
})

describe('rules store optimistic updates', () => {
  it('saveRule rolls back on backend failure', async () => {
    const store = useRulesStore()
    mockInvoke.mockResolvedValueOnce([
      { id: 'r1', name: 'R1', type: 'mutex', sourceDimensionId: 'dim_05', sourceModuleId: null, targetDimensionId: 'dim_03', targetModuleId: null, message: 'm', isEnabled: true },
    ])
    await store.fetchAll()
    expect(store.rules).toHaveLength(1)

    mockInvoke.mockRejectedValueOnce(new Error('backend down'))
    const payload = { name: 'R1x', type: 'mutex' as const, sourceDimensionId: 'dim_05', sourceModuleId: null, targetDimensionId: 'dim_03', targetModuleId: null, message: 'm', isEnabled: true }
    await expect(store.saveRule(payload, 'r1')).rejects.toThrow()
    expect(store.rules[0]!.name).toBe('R1')
  })

  it('deleteRule restores on failure', async () => {
    const store = useRulesStore()
    mockInvoke.mockResolvedValueOnce([
      { id: 'r1', name: 'R1', type: 'mutex', sourceDimensionId: null, sourceModuleId: null, targetDimensionId: null, targetModuleId: null, message: 'm', isEnabled: true },
    ])
    await store.fetchAll()
    mockInvoke.mockRejectedValueOnce(new Error('nope'))
    await expect(store.deleteRule('r1')).rejects.toThrow()
    expect(store.rules).toHaveLength(1)
  })

  it('toggleRule rolls back on failure', async () => {
    const store = useRulesStore()
    mockInvoke.mockResolvedValueOnce([
      { id: 'r1', name: 'R1', type: 'mutex', sourceDimensionId: null, sourceModuleId: null, targetDimensionId: null, targetModuleId: null, message: 'm', isEnabled: true },
    ])
    await store.fetchAll()
    mockInvoke.mockRejectedValueOnce(new Error('nope'))
    await expect(store.toggleRule('r1', false)).rejects.toThrow()
    expect(store.rules[0]!.isEnabled).toBe(true)
  })

  it('fetchAll falls back to legacy rules when backend missing', async () => {
    const store = useRulesStore()
    mockInvoke.mockRejectedValueOnce(new Error('no backend'))
    await expect(store.fetchAll()).rejects.toThrow()
    expect(store.loaded).toBe(true)
    expect(store.rules.length).toBeGreaterThan(0)
    expect(store.loadError).toContain('no backend')
  })

  it('toEngineRules fills dimKeys and legacy keywords', async () => {
    const store = useRulesStore()
    mockInvoke.mockResolvedValueOnce([
      { id: 'rule_03', name: '室内外', type: 'excludes', sourceDimensionId: 'dim_10', sourceModuleId: null, targetDimensionId: 'dim_10', targetModuleId: null, message: 'm', isEnabled: true },
    ])
    await store.fetchAll()
    const engine = store.toEngineRules()
    expect(engine[0]!.sourceKeyword).toBe('studio')
    expect(engine[0]!.targetKeywords).toContain('beach')
  })
})
