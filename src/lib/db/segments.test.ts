/**
 * need03 S6：db/segments 域 invoke 映射（分段导入 / 翻译回写 / 库导入导出）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockInvokeOk, tauriApiMock } from '@/tests/tauri-mock'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => tauriApiMock(invoke))

import {
  dbImportSegments,
  dbImportSegmentsText,
  dbBatchUpdateDisplayNames,
  dbBatchUpdateDisplayNamesText,
  dbExportLibrary,
  dbImportLibrary,
  dbImportLibraryText,
  dbImportLegacyDb,
  dbGetDefaultExportDir,
  dbExportLibraryToDir,
  dbRevealInExplorer,
  type SegmentImportPayload,
} from './segments'

const segReport = {
  prompts: 1,
  segmentsTotal: 2,
  segmentsImported: 2,
  segmentsSkipped: 0,
  segmentsIgnoredUnassigned: 0,
  modulesCreated: 2,
  modulesUpdated: 0,
  modulesSkipped: 0,
  errors: [],
  warnings: [],
}

const transReport = {
  totalRequested: 2,
  updated: 2,
  skipped: 0,
  warnings: [],
  errors: [],
}

const libReport = {
  dimensionsCreated: 1,
  dimensionsUpdated: 0,
  dimensionsSkipped: 0,
  modulesCreated: 2,
  modulesUpdated: 0,
  modulesSkipped: 0,
  rulesCreated: 0,
  rulesUpdated: 0,
  rulesSkipped: 0,
  tagsCreated: 1,
  tagsSkipped: 0,
  errors: [],
}

const payload: SegmentImportPayload = {
  format: 'promptstudio',
  formatVersion: 1,
  prompts: [
    {
      id: 'p1',
      raw: 'raw',
      segments: [{ dimensionKey: 'top', contentEn: 'a shirt' }],
    },
  ],
  unassignedStrategy: 'ignore',
  mode: 'skip',
}

beforeEach(() => invoke.mockReset())

describe('db/segments 分段导入', () => {
  it('dbImportSegments 传 { payload }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(segReport))
    const r = await dbImportSegments(payload)
    expect(invoke).toHaveBeenCalledWith('db_import_segments', { payload })
    expect(r.segmentsImported).toBe(2)
  })

  it('dbImportSegmentsText 传 { text, unassignedStrategy, mode }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(segReport))
    const r = await dbImportSegmentsText('raw text', 'to_camera', 'overwrite')
    expect(invoke).toHaveBeenCalledWith('db_import_segments_text', {
      text: 'raw text',
      unassignedStrategy: 'to_camera',
      mode: 'overwrite',
    })
    expect(r.modulesCreated).toBe(2)
  })
})

describe('db/segments 翻译回写', () => {
  it('dbBatchUpdateDisplayNames 只取 id/displayName', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(transReport))
    const r = await dbBatchUpdateDisplayNames({
      dimensionId: 'd01',
      items: [{ id: 'm1', displayName: '一' }, { id: 'm2', displayName: '二' }],
    })
    expect(invoke).toHaveBeenCalledWith('db_batch_update_display_names', {
      payload: {
        dimensionId: 'd01',
        items: [
          { id: 'm1', displayName: '一' },
          { id: 'm2', displayName: '二' },
        ],
      },
    })
    expect(r.updated).toBe(2)
  })

  it('dbBatchUpdateDisplayNames 空 items 也提交', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(transReport))
    await dbBatchUpdateDisplayNames({ dimensionId: 'd01', items: [] })
    expect(invoke.mock.calls[0]![1]).toEqual({ payload: { dimensionId: 'd01', items: [] } })
  })

  it('dbBatchUpdateDisplayNamesText 传 { text, dimensionId }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(transReport))
    const r = await dbBatchUpdateDisplayNamesText('m1=一', 'd01')
    expect(invoke).toHaveBeenCalledWith('db_batch_update_display_names_text', { text: 'm1=一', dimensionId: 'd01' })
    expect(r.totalRequested).toBe(2)
  })
})

describe('db/segments 库导入导出', () => {
  it('dbExportLibrary 未给 path 传 null', async () => {
    invoke.mockImplementationOnce(mockInvokeOk('C:/out/lib.json'))
    expect(await dbExportLibrary()).toBe('C:/out/lib.json')
    expect(invoke).toHaveBeenCalledWith('db_export_library', { path: null })
  })

  it('dbExportLibrary 指定 path 透传', async () => {
    invoke.mockImplementationOnce(mockInvokeOk('D:/lib.json'))
    await dbExportLibrary('D:/lib.json')
    expect(invoke.mock.calls[0]![1]).toEqual({ path: 'D:/lib.json' })
  })

  it('dbImportLibrary 传 { path, mode }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(libReport))
    const r = await dbImportLibrary('D:/lib.json', 'overwrite')
    expect(invoke).toHaveBeenCalledWith('db_import_library', { path: 'D:/lib.json', mode: 'overwrite' })
    expect(r.dimensionsCreated).toBe(1)
  })

  it('dbImportLibraryText 传 { text, mode }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(libReport))
    const r = await dbImportLibraryText('{"x":1}', 'skip')
    expect(invoke).toHaveBeenCalledWith('db_import_library_text', { text: '{"x":1}', mode: 'skip' })
    expect(r.modulesCreated).toBe(2)
  })

  it('dbImportLegacyDb 传 { legacyPath }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ dimensions: 1, modules: 2, assemblies: 3, templates: 4, skipped: 0 }))
    const r = await dbImportLegacyDb('C:/old.db')
    expect(invoke).toHaveBeenCalledWith('db_import_legacy_db', { legacyPath: 'C:/old.db' })
    expect(r.assemblies).toBe(3)
  })

  it('dbGetDefaultExportDir 无参数调用', async () => {
    invoke.mockImplementationOnce(mockInvokeOk('C:/out'))
    expect(await dbGetDefaultExportDir()).toBe('C:/out')
    expect(invoke).toHaveBeenCalledWith('db_get_default_export_dir')
  })

  it('dbExportLibraryToDir 传 { dir } 并返回结果', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ path: 'C:/out', json: '{}', filename: 'lib.json' }))
    const r = await dbExportLibraryToDir('C:/out')
    expect(invoke).toHaveBeenCalledWith('db_export_library_to_dir', { dir: 'C:/out' })
    expect(r.filename).toBe('lib.json')
  })

  it('dbRevealInExplorer 传 { path }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbRevealInExplorer('C:/out/lib.json')
    expect(invoke).toHaveBeenCalledWith('db_reveal_in_explorer', { path: 'C:/out/lib.json' })
  })
})

describe('db/segments 失败分支', () => {
  it('后端 reject 时异常向上抛出', async () => {
    invoke.mockRejectedValueOnce(new Error('boom'))
    await expect(dbImportSegments(payload)).rejects.toThrow('boom')
  })

  it('dbExportLibrary 失败向上抛出', async () => {
    invoke.mockRejectedValueOnce(new Error('disk full'))
    await expect(dbExportLibrary('D:/x.json')).rejects.toThrow('disk full')
  })
})