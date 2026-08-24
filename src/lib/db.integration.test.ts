/**
 * 前端 db.ts 的 invoke 映射单测（mock）。
 * 确保前端封装与 Rust command 参数命名一致。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

// Need to import AFTER mock
import { dbGetDimensions, dbSearchModules, dbSaveAssembly } from './db'
import type { AssemblyConfig } from '@/engine/models'

beforeEach(() => mockInvoke.mockReset())

describe('lib/db invoke mapping', () => {
  it('dbGetDimensions calls db_get_dimensions', async () => {
    mockInvoke.mockResolvedValueOnce([
      { id: 'd01', key: 'body', nameCn: '身材', nameEn: 'Body', sortOrder: 1, isMultiSelect: false, isEnabled: true, icon: null, createdAt: 1, updatedAt: 1 },
    ])
    const dims = await dbGetDimensions()
    expect(mockInvoke).toHaveBeenCalledWith('db_get_dimensions')
    expect(dims[0]!.key).toBe('body')
  })

  it('dbSearchModules maps keyword correctly', async () => {
    mockInvoke.mockResolvedValueOnce([])
    await dbSearchModules('shirt')
    expect(mockInvoke).toHaveBeenCalledWith('db_search_modules', { keyword: 'shirt' })
  })

  it('dbSaveAssembly serializes config and items', async () => {
    mockInvoke.mockResolvedValueOnce('new-id')
    const cfg: AssemblyConfig = { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }
    const mod = { id: 'm01', dimensionId: 'd01', contentEn: 'white shirt', displayName: '白衬衫', weight: 1.0, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' }
    const id = await dbSaveAssembly(null, '{"segments":[]}', 'white shirt', cfg, [{ module: mod, locked: false }], false)
    expect(id).toBe('new-id')
    const payload = mockInvoke.mock.calls[0]![1] as Record<string, unknown>
    expect(mockInvoke.mock.calls[0]![0]).toBe('db_save_assembly')
    expect(payload).toHaveProperty('ir_json')
    expect(payload).toHaveProperty('final_prompt')
    expect(payload).toHaveProperty('is_favorite')
    const cfgArg = payload['config'] as Record<string, unknown>
    expect(cfgArg).toBeDefined()
  })
})
