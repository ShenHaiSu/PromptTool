/**
 * need02 T4：rules store 乐观回滚单测（阶段二：IndexedDB 真后端 + fake-indexeddb）。
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { IDB_NAME } from '@/lib/idb'
import { resetDbForTest } from '@/lib/seed'
import { useRulesStore } from './rules'

function clearDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(IDB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('删库失败'))
    req.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
  await resetDbForTest()
  await clearDb()
})

describe('rules store optimistic updates', () => {
  it('fetchAll 读取种子 3 规则', async () => {
    const store = useRulesStore()
    await store.fetchAll()
    expect(store.rules).toHaveLength(3)
    expect(store.loaded).toBe(true)
  })

  it('saveRule rolls back on backend failure', async () => {
    const store = useRulesStore()
    await store.fetchAll()
    const before = store.rules[0]!.name
    const payload = { name: 'R1x', type: 'mutex' as const, sourceDimensionId: 'dim_05', sourceModuleId: null, targetDimensionId: 'dim_03', targetModuleId: null, message: 'm', isEnabled: true }
    await expect(store.saveRule(payload, 'no-such-id')).rejects.toThrow()
    expect(store.rules[0]!.name).toBe(before)
  })

  it('deleteRule restores on failure', async () => {
    const store = useRulesStore()
    await store.fetchAll()
    await expect(store.deleteRule('no-such-id')).rejects.toThrow()
    expect(store.rules).toHaveLength(3)
  })

  it('toggleRule rolls back on failure', async () => {
    const store = useRulesStore()
    await store.fetchAll()
    const target = store.rules.find((r) => r.isEnabled)!
    await expect(store.toggleRule('no-such-id', false)).rejects.toThrow()
    expect(store.rules.find((r) => r.id === target.id)!.isEnabled).toBe(true)
  })

  it('fetchAll falls back to legacy rules when backend missing', async () => {
    const db = await import('@/lib/db')
    const spy = vi.spyOn(db, 'dbListRules').mockRejectedValueOnce(new Error('no backend'))
    const store = useRulesStore()
    await expect(store.fetchAll()).rejects.toThrow()
    expect(store.loaded).toBe(true)
    expect(store.rules.length).toBeGreaterThan(0)
    expect(store.loadError).toContain('no backend')
    spy.mockRestore()
  })

  it('toEngineRules fills dimKeys and legacy keywords', async () => {
    const store = useRulesStore()
    await store.fetchAll()
    const engine = store.toEngineRules()
    const r03 = engine.find((r) => r.id === 'rule_03')!
    expect(r03.sourceKeyword).toBe('studio')
    expect(r03.targetKeywords).toContain('beach')
  })
})
