/**
 * need03 S6：db/registry 域 invoke 映射（含 temp carry JSON 编解码与 undefined→null）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockInvokeOk, tauriApiMock } from '@/tests/tauri-mock'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => tauriApiMock(invoke))

import {
  dbValidateBusiness,
  dbCreateBusiness,
  dbCheckAlias,
  dbSwitchActive,
  dbSetMaxActive,
  dbGetActiveInfo,
  dbListRegistry,
  dbRepairPath,
  dbRebuildMissing,
  dbRemoveRegistry,
  dbUpdateRegistryMeta,
  dbSetTempCarry,
  dbGetTempCarry,
  dbExportCsv,
  dbExportStatsLedgerToDir,
} from './registry'

const row = {
  id: 'g1',
  path: 'C:/lib',
  alias: '主库',
  remark: null,
  status: 'available' as const,
  createdAt: 1,
  lastOpenedAt: null,
  dimCount: 2,
  moduleCount: 3,
  favoriteCount: 0,
}

const activeInfo = { foreground: row, resident: [row], maxActive: 3 }

beforeEach(() => invoke.mockReset())

describe('db/registry 校验与切换', () => {
  it('dbValidateBusiness 传 { path }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ exists: true, valid: true, message: 'ok', normalizedPath: 'C:/lib' }))
    const r = await dbValidateBusiness('C:/lib')
    expect(invoke).toHaveBeenCalledWith('db_validate_business', { path: 'C:/lib' })
    expect(r.valid).toBe(true)
  })

  it('dbCreateBusiness 缺省 remark 转 null', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ normalizedPath: 'C:/lib', alias: '主库' }))
    const r = await dbCreateBusiness({ path: 'C:/lib', alias: '主库', withSeed: true })
    expect(invoke).toHaveBeenCalledWith('db_create_business', {
      path: 'C:/lib',
      alias: '主库',
      remark: null,
      withSeed: true,
    })
    expect(r.normalizedPath).toBe('C:/lib')
  })

  it('dbCreateBusiness 带 remark 透传', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ normalizedPath: 'C:/lib', alias: 'a' }))
    await dbCreateBusiness({ path: 'C:/lib', alias: 'a', remark: '备注', withSeed: false })
    expect(invoke.mock.calls[0]![1]).toMatchObject({ remark: '备注', withSeed: false })
  })

  it('dbCheckAlias 传 { alias }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ available: false, message: '别名已存在' }))
    const r = await dbCheckAlias('main')
    expect(invoke).toHaveBeenCalledWith('db_check_alias', { alias: 'main' })
    expect(r.available).toBe(false)
  })

  it('dbSwitchActive 传 { path }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ normalizedPath: 'C:/lib2' }))
    const r = await dbSwitchActive('C:/lib2')
    expect(invoke).toHaveBeenCalledWith('db_switch_active', { path: 'C:/lib2' })
    expect(r.normalizedPath).toBe('C:/lib2')
  })

  it('dbSetMaxActive 传 { maxActive }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbSetMaxActive(5)
    expect(invoke).toHaveBeenCalledWith('db_set_max_active', { maxActive: 5 })
  })

  it('dbGetActiveInfo 无参数调用', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(activeInfo))
    const info = await dbGetActiveInfo()
    expect(invoke).toHaveBeenCalledWith('db_get_active_info')
    expect(info.foreground!.path).toBe('C:/lib')
  })

  it('dbGetActiveInfo foreground 为 null', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ foreground: null, resident: [], maxActive: 3 }))
    const info = await dbGetActiveInfo()
    expect(info.foreground).toBeNull()
    expect(info.resident).toEqual([])
  })

  it('dbListRegistry 返回列表', async () => {
    invoke.mockImplementationOnce(mockInvokeOk([row]))
    const rows = await dbListRegistry()
    expect(invoke).toHaveBeenCalledWith('db_list_registry')
    expect(rows).toEqual([row])
  })
})

describe('db/registry 修复与移除', () => {
  it('dbRepairPath 传 { oldPath, newPath }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbRepairPath('C:/old', 'D:/new')
    expect(invoke).toHaveBeenCalledWith('db_repair_path', { oldPath: 'C:/old', newPath: 'D:/new' })
  })

  it('dbRebuildMissing 传 { path, withSeed }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbRebuildMissing('C:/lib', true)
    expect(invoke).toHaveBeenCalledWith('db_rebuild_missing', { path: 'C:/lib', withSeed: true })
  })

  it('dbRemoveRegistry 返回 wasForeground/nextForeground', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ wasForeground: true, nextForeground: 'D:/other' }))
    const r = await dbRemoveRegistry('C:/lib')
    expect(invoke).toHaveBeenCalledWith('db_remove_registry', { path: 'C:/lib' })
    expect(r).toEqual({ wasForeground: true, nextForeground: 'D:/other' })
  })

  it('dbRemoveRegistry nextForeground 可为 null', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ wasForeground: false, nextForeground: null }))
    const r = await dbRemoveRegistry('C:/lib')
    expect(r.nextForeground).toBeNull()
  })

  it('dbUpdateRegistryMeta alias/remark 缺省转 null', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbUpdateRegistryMeta('C:/lib')
    expect(invoke).toHaveBeenCalledWith('db_update_registry_meta', {
      path: 'C:/lib',
      alias: null,
      remark: null,
    })
  })

  it('dbUpdateRegistryMeta 全字段透传', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbUpdateRegistryMeta('C:/lib', '别名', '备注')
    expect(invoke.mock.calls[0]![1]).toEqual({ path: 'C:/lib', alias: '别名', remark: '备注' })
  })
})

describe('db/registry temp carry', () => {
  it('dbSetTempCarry 传 payloadJson 字符串', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    const payload = { selectedItemIds: ['m1', 'm2'], weightDraft: { m1: 1.2 } }
    await dbSetTempCarry(payload)
    expect(invoke).toHaveBeenCalledWith('db_set_temp_carry', {
      payloadJson: JSON.stringify(payload),
    })
  })

  it('dbSetTempCarry 无 weightDraft 时只序列化 selectedItemIds', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbSetTempCarry({ selectedItemIds: ['m1'] })
    expect(invoke.mock.calls[0]![1]).toEqual({ payloadJson: '{"selectedItemIds":["m1"]}' })
  })

  it('dbGetTempCarry 有 payloadJson 时反序列化', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ payloadJson: '{"selectedItemIds":["m1"],"weightDraft":{"m1":2}}' }))
    const r = await dbGetTempCarry()
    expect(invoke).toHaveBeenCalledWith('db_get_temp_carry')
    expect(r).toEqual({ selectedItemIds: ['m1'], weightDraft: { m1: 2 } })
  })

  it('dbGetTempCarry payloadJson 为 null 返回 null', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ payloadJson: null }))
    expect(await dbGetTempCarry()).toBeNull()
  })

  it('dbGetTempCarry 空字符串 payloadJson 返回 null', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ payloadJson: '' }))
    expect(await dbGetTempCarry()).toBeNull()
  })
})

describe('db/registry 导出', () => {
  it('dbExportCsv 传 { path, resultsJson }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbExportCsv('C:/out.csv', '[{"url":"x"}]')
    expect(invoke).toHaveBeenCalledWith('db_export_csv', { path: 'C:/out.csv', resultsJson: '[{"url":"x"}]' })
  })

  it('dbExportStatsLedgerToDir 传 { csvText, from, to }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ path: 'C:/out', filename: 'ledger.csv' }))
    const r = await dbExportStatsLedgerToDir('a,b', '2024-01-01', '2024-01-31')
    expect(invoke).toHaveBeenCalledWith('db_export_stats_ledger_to_dir', {
      csvText: 'a,b',
      from: '2024-01-01',
      to: '2024-01-31',
    })
    expect(r.filename).toBe('ledger.csv')
  })
})

describe('db/registry 失败分支', () => {
  it('后端 reject 时异常向上抛出', async () => {
    invoke.mockRejectedValueOnce(new Error('boom'))
    await expect(dbListRegistry()).rejects.toThrow('boom')
  })

  it('dbGetTempCarry 失败向上抛出', async () => {
    invoke.mockRejectedValueOnce(new Error('carry fail'))
    await expect(dbGetTempCarry()).rejects.toThrow('carry fail')
  })

  it('dbSwitchActive 失败向上抛出', async () => {
    invoke.mockRejectedValueOnce(new Error('locked'))
    await expect(dbSwitchActive('C:/lib2')).rejects.toThrow('locked')
  })
})