/**
 * 前端 db.ts 的 invoke 映射单测（mock）。
 * 确保前端封装与 Rust command 参数命名一致（Tauri v2 默认 camelCase）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

// Need to import AFTER mock
import {
  dbGetDimensions,
  dbSearchModules,
  dbSaveAssembly,
  dbExportLibrary,
  dbImportLibrary,
  dbImportLibraryText,
} from './db'
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
    expect(payload).toHaveProperty('irJson')
    expect(payload).toHaveProperty('finalPrompt')
    expect(payload).toHaveProperty('isFavorite')
    const cfgArg = payload['config'] as Record<string, unknown>
    expect(cfgArg).toBeDefined()
  })

  it('dbExportLibrary without path returns JSON string', async () => {
    mockInvoke.mockResolvedValueOnce('{"format":"pmf-library"}')
    const json = await dbExportLibrary()
    expect(mockInvoke).toHaveBeenCalledWith('db_export_library', { path: null })
    expect(json).toContain('pmf-library')
  })

  it('dbExportLibrary with path passes path through', async () => {
    mockInvoke.mockResolvedValueOnce('{"format":"pmf-library"}')
    await dbExportLibrary('C:/tmp/pmf-library.json')
    expect(mockInvoke).toHaveBeenCalledWith('db_export_library', { path: 'C:/tmp/pmf-library.json' })
  })

  it('dbImportLibrary passes path and mode (camelCase keys)', async () => {
    const report = { dimensionsCreated: 1, dimensionsUpdated: 0, dimensionsSkipped: 0, modulesCreated: 2, modulesUpdated: 0, modulesSkipped: 0, rulesCreated: 0, rulesUpdated: 0, rulesSkipped: 0, tagsCreated: 0, tagsSkipped: 0, errors: [] }
    mockInvoke.mockResolvedValueOnce(report)
    const r = await dbImportLibrary('C:/tmp/in.json', 'skip')
    expect(mockInvoke).toHaveBeenCalledWith('db_import_library', { path: 'C:/tmp/in.json', mode: 'skip' })
    expect(r.dimensionsCreated).toBe(1)
  })

  it('dbImportLibraryText passes text and mode', async () => {
    const report = { dimensionsCreated: 0, dimensionsUpdated: 0, dimensionsSkipped: 1, modulesCreated: 0, modulesUpdated: 0, modulesSkipped: 0, rulesCreated: 0, rulesUpdated: 0, rulesSkipped: 0, tagsCreated: 0, tagsSkipped: 0, errors: [] }
    mockInvoke.mockResolvedValueOnce(report)
    await dbImportLibraryText('{"format":"pmf-library"}', 'overwrite')
    expect(mockInvoke).toHaveBeenCalledWith('db_import_library_text', {
      text: '{"format":"pmf-library"}',
      mode: 'overwrite',
    })
  })

  it('dbGetDefaultExportDir calls without args', async () => {
    mockInvoke.mockResolvedValueOnce('E:/app/data/output')
    const { dbGetDefaultExportDir } = await import('./db')
    const dir = await dbGetDefaultExportDir()
    expect(mockInvoke).toHaveBeenCalledWith('db_get_default_export_dir')
    expect(dir).toBe('E:/app/data/output')
  })

  it('dbExportLibraryToDir passes dir with camelCase key', async () => {
    const { dbExportLibraryToDir } = await import('./db')
    mockInvoke.mockResolvedValueOnce({ path: 'E:/app/data/output/pmf-library-20260829-153022.json', json: '{}', filename: 'pmf-library-20260829-153022.json' })
    const res = await dbExportLibraryToDir('E:/app/data/output')
    expect(mockInvoke).toHaveBeenCalledWith('db_export_library_to_dir', { dir: 'E:/app/data/output' })
    expect(res.filename).toContain('pmf-library-')
  })

  it('dbRevealInExplorer passes path with camelCase key', async () => {
    const { dbRevealInExplorer } = await import('./db')
    mockInvoke.mockResolvedValueOnce(undefined)
    await dbRevealInExplorer('E:/app/data/output/pm.json')
    expect(mockInvoke).toHaveBeenCalledWith('db_reveal_in_explorer', { path: 'E:/app/data/output/pm.json' })
  })

  it('dbListRules passes includeDisabled (camelCase)', async () => {
    const { dbListRules } = await import('./db')
    mockInvoke.mockResolvedValueOnce([])
    await dbListRules(false)
    expect(mockInvoke).toHaveBeenCalledWith('db_list_rules', { includeDisabled: false })
  })

  it('dbUpdateRule spreads id and payload flat (pitfalls/01)', async () => {
    const { dbUpdateRule } = await import('./db')
    const payload = { name: 'n', type: 'mutex' as const, sourceDimensionId: 'dim_05', sourceModuleId: null, targetDimensionId: 'dim_03', targetModuleId: null, message: 'm', isEnabled: true }
    mockInvoke.mockResolvedValueOnce({ id: 'rule_01', ...payload })
    await dbUpdateRule('rule_01', payload)
    expect(mockInvoke).toHaveBeenCalledWith('db_update_rule', { id: 'rule_01', payload })
  })

  it('dbToggleRule spreads id and isEnabled flat', async () => {
    const { dbToggleRule, dbCreateRule, dbDeleteRule } = await import('./db')
    mockInvoke.mockResolvedValueOnce({ id: 'r', isEnabled: false })
    await dbToggleRule('r', false)
    expect(mockInvoke).toHaveBeenCalledWith('db_toggle_rule', { id: 'r', isEnabled: false })
    mockInvoke.mockResolvedValueOnce({ id: 'r2' })
    const payload = { name: 'n', type: 'mutex' as const, sourceDimensionId: null, sourceModuleId: null, targetDimensionId: null, targetModuleId: null, message: 'm', isEnabled: true }
    await dbCreateRule(payload)
    expect(mockInvoke).toHaveBeenCalledWith('db_create_rule', { payload })
    mockInvoke.mockResolvedValueOnce(undefined)
    await dbDeleteRule('r2')
    expect(mockInvoke).toHaveBeenCalledWith('db_delete_rule', { id: 'r2' })
  })
})
