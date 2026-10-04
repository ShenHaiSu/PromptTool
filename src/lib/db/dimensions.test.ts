/**
 * need03 S6：db/dimensions 域 invoke 映射 + DTO 映射（含字段缺失/空值）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockInvokeOk, tauriApiMock } from '@/tests/tauri-mock'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => tauriApiMock(invoke))
import {
  dbGetDimensions,
  dbCreateDimension,
  dbUpdateDimension,
  dbSoftDeleteDimension,
  dbMigrateDimension,
  dbClearDimension,
  toDimension,
} from './dimensions'

const dimDto = {
  id: 'd01',
  key: 'body',
  nameCn: '身材',
  nameEn: 'Body',
  sortOrder: 1,
  isMultiSelect: false,
  isEnabled: true,
  icon: null,
  createdAt: 1,
  updatedAt: 2,
}

beforeEach(() => invoke.mockReset())

describe('db/dimensions', () => {
  it('toDimension 正常映射', () => {
    expect(toDimension(dimDto)).toMatchObject({ id: 'd01', key: 'body', nameCn: '身材', isEnabled: true })
  })

  it('toDimension 字段缺失时按现有契约回落（nameEn 空串、时间戳 undefined）', () => {
    const partial = toDimension({ id: 'd02', nameEn: null, createdAt: null, updatedAt: null } as never)
    expect(partial.nameEn).toBe('')
    expect(partial.createdAt).toBeUndefined()
    expect(partial.updatedAt).toBeUndefined()
  })

  it('toDimension 对非空字段原样透传（含 icon null）', () => {
    const full = toDimension(dimDto)
    expect(full.nameEn).toBe('Body')
    expect(full.createdAt).toBe(1)
    expect(full.updatedAt).toBe(2)
    expect(full.icon).toBeNull()
    expect(full.sortOrder).toBe(1)
    expect(full.isMultiSelect).toBe(false)
  })

  it('dbGetDimensions 调 db_get_dimensions 并逐行映射', async () => {
    invoke.mockImplementationOnce(mockInvokeOk([dimDto]))
    const rows = await dbGetDimensions()
    expect(invoke).toHaveBeenCalledWith('db_get_dimensions')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('d01')
  })

  it('dbCreateDimension 调 db_create_dimension 并补默认参数', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(dimDto))
    const d = await dbCreateDimension('body', '身材')
    expect(invoke).toHaveBeenCalledWith('db_create_dimension', {
      key: 'body',
      nameCn: '身材',
      nameEn: null,
      sortOrder: null,
      isMultiSelect: false,
    })
    expect(d.id).toBe('d01')
  })

  it('dbCreateDimension 全参数透传', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(dimDto))
    await dbCreateDimension('body', '身材', 'Body', 3, true)
    expect(invoke.mock.calls[0]![1]).toMatchObject({ nameEn: 'Body', sortOrder: 3, isMultiSelect: true })
  })

  it('dbUpdateDimension 调 db_update_dimension 并透传整维度', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbUpdateDimension(toDimension(dimDto))
    expect(invoke.mock.calls[0]![0]).toBe('db_update_dimension')
    expect(invoke.mock.calls[0]![1]).toHaveProperty('d')
  })

  it('dbUpdateDimension 空 nameEn / 空时间戳转 null', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbUpdateDimension({ ...toDimension(dimDto), nameEn: '', createdAt: undefined, updatedAt: undefined })
    expect(invoke.mock.calls[0]![1]).toMatchObject({
      d: { nameEn: null, icon: null, createdAt: null, updatedAt: null },
    })
  })

  it('dbSoftDeleteDimension 调 db_soft_delete_dimension', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbSoftDeleteDimension('d01')
    expect(invoke).toHaveBeenCalledWith('db_soft_delete_dimension', { id: 'd01' })
  })

  it('dbMigrateDimension 返回归档/新维度/迁移条数', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ archive: dimDto, fresh: { ...dimDto, id: 'd02', key: 'body_v2' }, moved: 3 }))
    const r = await dbMigrateDimension({ dimensionId: 'd01' })
    expect(invoke.mock.calls[0]![0]).toBe('db_migrate_dimension')
    expect(r.moved).toBe(3)
    expect(r.fresh.id).toBe('d02')
  })

  it('dbClearDimension 返回清空条数', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ cleared: 12 }))
    const r = await dbClearDimension({ dimensionId: 'd01' })
    expect(invoke.mock.calls[0]![0]).toBe('db_clear_dimension')
    expect(r.cleared).toBe(12)
  })

  it('后端失败时异常向上抛出（不静默）', async () => {
    invoke.mockRejectedValueOnce(new Error('boom'))
    await expect(dbGetDimensions()).rejects.toThrow('boom')
  })
})