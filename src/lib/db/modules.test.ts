/**
 * need03 S6：db/modules 域 invoke 映射 + DTO 双向映射（含字段缺失/空值）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockInvokeOk, tauriApiMock } from '@/tests/tauri-mock'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => tauriApiMock(invoke))

import {
  toModule,
  toModuleDto,
  dbGetModulesByDimension,
  dbGetAllModulesGrouped,
  dbSearchModules,
  dbCreateModule,
  dbUpdateModule,
  dbSoftDeleteModule,
  dbBatchCreateModules,
  dbBatchCreateModulesText,
} from './modules'
import type { Module } from '@/engine/models'

const moduleDto = {
  id: 'm01',
  dimensionId: 'd01',
  contentEn: 'a white shirt',
  displayName: '白衬衫',
  weight: 1.5,
  isEnabled: true,
  isNsfw: false,
  usageCount: 3,
  exampleImage: 'img.png',
  notes: 'n',
  dimensionKey: 'top',
}

const moduleModel: Module = {
  id: 'm01',
  dimensionId: 'd01',
  contentEn: 'a white shirt',
  displayName: '白衬衫',
  weight: 1.5,
  isEnabled: true,
  isNsfw: false,
  usageCount: 3,
  exampleImage: 'img.png',
  notes: 'n',
  dimensionKey: 'top',
}

beforeEach(() => invoke.mockReset())

describe('db/modules 映射函数', () => {
  it('toModule 原样透传全字段', () => {
    expect(toModule(moduleDto)).toEqual(moduleModel)
  })

  it('toModule 字段缺失时透传 undefined（不做兜底）', () => {
    const m = toModule({ id: 'm02' } as never)
    expect(m.id).toBe('m02')
    expect(m.contentEn).toBeUndefined()
    expect(m.exampleImage).toBeUndefined()
    expect(m.dimensionKey).toBeUndefined()
  })

  it('toModuleDto 可空字段 undefined → null', () => {
    const dto = toModuleDto({
      ...moduleModel,
      exampleImage: undefined,
      notes: undefined,
      dimensionKey: undefined,
    })
    expect(dto.exampleImage).toBeNull()
    expect(dto.notes).toBeNull()
    expect(dto.dimensionKey).toBeNull()
  })

  it('toModuleDto 已有值时原样透传', () => {
    expect(toModuleDto(moduleModel)).toEqual(moduleDto)
  })
})

describe('db/modules 查询', () => {
  it('dbGetModulesByDimension 带 { dimId }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk([moduleDto]))
    const rows = await dbGetModulesByDimension('d01')
    expect(invoke).toHaveBeenCalledWith('db_get_modules_by_dimension', { dimId: 'd01' })
    expect(rows[0]!.id).toBe('m01')
  })

  it('dbGetAllModulesGrouped 按维度分组映射', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ top: [moduleDto], bottom: [] }))
    const map = await dbGetAllModulesGrouped()
    expect(invoke.mock.calls[0]![0]).toBe('db_get_all_modules_grouped')
    expect(map.top![0]!.id).toBe('m01')
    expect(map.bottom).toEqual([])
  })

  it('dbSearchModules 带 { keyword }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk([moduleDto]))
    const rows = await dbSearchModules('shirt')
    expect(invoke).toHaveBeenCalledWith('db_search_modules', { keyword: 'shirt' })
    expect(rows).toHaveLength(1)
  })
})

describe('db/modules 写入', () => {
  it('dbCreateModule 默认 weight=1.0', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(moduleDto))
    const m = await dbCreateModule('d01', 'a white shirt', '白衬衫')
    expect(invoke).toHaveBeenCalledWith('db_create_module', {
      dimId: 'd01',
      contentEn: 'a white shirt',
      displayName: '白衬衫',
      weight: 1.0,
    })
    expect(m.id).toBe('m01')
  })

  it('dbCreateModule 指定 weight', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(moduleDto))
    await dbCreateModule('d01', 'c', 'C', 2.5)
    expect(invoke.mock.calls[0]![1]).toMatchObject({ weight: 2.5 })
  })

  it('dbUpdateModule 传 { m: dto }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbUpdateModule(moduleModel)
    expect(invoke).toHaveBeenCalledWith('db_update_module', { m: moduleDto })
  })

  it('dbSoftDeleteModule 传 { id }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbSoftDeleteModule('m01')
    expect(invoke).toHaveBeenCalledWith('db_soft_delete_module', { id: 'm01' })
  })
})

describe('db/modules 批量导入', () => {
  const report = {
    totalRequested: 2,
    valid: 2,
    modulesCreated: 1,
    modulesUpdated: 1,
    modulesSkipped: 0,
    emptyIgnored: 0,
    duplicateInBatch: 0,
    truncated: 0,
    errors: [],
    warnings: [],
  }

  it('dbBatchCreateModules 缺省可选字段转 null', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(report))
    const r = await dbBatchCreateModules({
      dimId: 'd01',
      items: [{ contentEn: 'a' }, { contentEn: 'b', displayName: 'B', weight: 2, isNsfw: true, notes: 'n' }],
      mode: 'skip',
    })
    expect(invoke).toHaveBeenCalledWith('db_batch_create_modules', {
      dimId: 'd01',
      items: [
        { contentEn: 'a', displayName: null, weight: null, isNsfw: null, notes: null },
        { contentEn: 'b', displayName: 'B', weight: 2, isNsfw: true, notes: 'n' },
      ],
      mode: 'skip',
      weight: null,
      isNsfw: null,
    })
    expect(r.modulesCreated).toBe(1)
  })

  it('dbBatchCreateModules 顶层 weight/isNsfw 透传', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(report))
    await dbBatchCreateModules({ dimId: 'd01', items: [], mode: 'overwrite', weight: 1.2, isNsfw: true })
    expect(invoke.mock.calls[0]![1]).toMatchObject({ mode: 'overwrite', weight: 1.2, isNsfw: true })
  })

  it('dbBatchCreateModulesText 缺省 weight/isNsfw 转 null', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(report))
    const r = await dbBatchCreateModulesText('d01', 'line1\nline2', 'skip')
    expect(invoke).toHaveBeenCalledWith('db_batch_create_modules_text', {
      dimId: 'd01',
      text: 'line1\nline2',
      mode: 'skip',
      weight: null,
      isNsfw: null,
    })
    expect(r.totalRequested).toBe(2)
  })

  it('dbBatchCreateModulesText 全参数透传', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(report))
    await dbBatchCreateModulesText('d01', 'x', 'overwrite', 0.9, false)
    expect(invoke.mock.calls[0]![1]).toMatchObject({ mode: 'overwrite', weight: 0.9, isNsfw: false })
  })
})

describe('db/modules 失败分支', () => {
  it('后端 reject 时异常向上抛出', async () => {
    invoke.mockRejectedValueOnce(new Error('boom'))
    await expect(dbGetModulesByDimension('d01')).rejects.toThrow('boom')
  })

  it('dbUpdateModule 失败向上抛出', async () => {
    invoke.mockRejectedValueOnce(new Error('db down'))
    await expect(dbUpdateModule(moduleModel)).rejects.toThrow('db down')
  })
})