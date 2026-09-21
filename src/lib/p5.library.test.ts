/**
 * 阶段五测试（08 导入导出与隐私）：导出格式兼容 / 完整备份 / 预览 / 清空 / 词库 CSV。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { IDB_NAME } from './idb'
import { resetDbForTest } from './seed'
import {
  dbClearLocalData,
  dbExportLibrary,
  dbGetDimensions,
  dbImportLibraryText,
  dbPreviewLibraryText,
} from './db'
import { dbSaveTemplate } from './db.templates'
import { dbSaveAssembly } from './db.assemblies'
import { buildLibraryCsvText } from './export'
import type { AssemblyConfig } from '@/engine/models'

const cfg: AssemblyConfig = {
  separator: ', ',
  useWeightBrackets: true,
  modelProfile: 'sd',
  sortBy: 'dimensionOrder',
}

function clearDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(IDB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('删库失败'))
    req.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  await resetDbForTest()
  await clearDb()
})

describe('导出格式（08§1）', () => {
  it('顶层含 snake_case 主键 + 旧版 camelCase 兼容别名，默认不含历史/模板', async () => {
    const json = await dbExportLibrary()
    const doc = JSON.parse(json) as Record<string, unknown>
    expect(doc['format']).toBe('pmf-library')
    expect(doc['version']).toBe(1)
    expect(doc['formatVersion']).toBe(1)
    expect(doc['exported_at']).toBe(doc['exportedAt'])
    expect(typeof doc['exported_at']).toBe('number')
    expect(doc['dimensions']).toHaveLength(14)
    expect(doc['modules']).toHaveLength(356)
    expect(doc['module_tags']).toEqual([])
    expect(doc['templates']).toEqual([])
    // 默认导出不含拼装快照（避免臃肿）
    expect(doc['assemblies']).toEqual([])
  })

  it('完整备份含模板与历史快照', async () => {
    const dims = await dbGetDimensions()
    const top = dims.find((d) => d.key === 'top')!
    const grouped = await import('./db').then((m) => m.dbGetAllModulesGrouped())
    const first = grouped[top.id]?.[0] ?? grouped[top.key]?.[0]!
    await dbSaveTemplate('t1', null, cfg, [top.key], null, [
      { module: { ...first, dimensionKey: top.key }, weightOverride: null, locked: false },
    ])
    await dbSaveAssembly(null, '{"segments":[]}', 'hello world', cfg, [], false)
    const slim = JSON.parse(await dbExportLibrary()) as { templates: unknown[]; assemblies: unknown[] }
    expect(slim.templates).toEqual([])
    expect(slim.assemblies).toEqual([])
    const full = JSON.parse(await dbExportLibrary(undefined, { includeHistory: true })) as {
      templates: { id: string; items: unknown[] }[]
      assemblies: { id: string; items: unknown[] }[]
    }
    expect(full.templates).toHaveLength(1)
    expect(full.templates[0]!.items).toHaveLength(1)
    expect(full.assemblies).toHaveLength(1)
  })
})

describe('导入兼容与预览（08§2）', () => {
  it('旧版格式（仅 camelCase）可导入', async () => {
    const json = await dbExportLibrary()
    const oldStyle = JSON.parse(json) as Record<string, unknown>
    delete oldStyle['version']
    delete oldStyle['exported_at']
    delete oldStyle['module_tags']
    delete oldStyle['templates']
    const r = await dbImportLibraryText(JSON.stringify(oldStyle), 'skip')
    expect(r.dimensionsSkipped).toBe(14)
    expect(r.modulesSkipped).toBe(356)
  })

  it('预览只读不写库，计数与真实导入一致', async () => {
    const json = await dbExportLibrary()
    const before = await dbGetDimensions()
    const p = await dbPreviewLibraryText(json, 'skip')
    expect(p.dimensionsSkipped).toBe(14)
    expect(p.modulesSkipped).toBe(356)
    expect((await dbGetDimensions()).length).toBe(before.length)
    const r = await dbImportLibraryText(json, 'skip')
    expect(r.dimensionsSkipped).toBe(p.dimensionsSkipped)
    expect(r.modulesSkipped).toBe(p.modulesSkipped)
  })

  it('完整备份 → 清空 → 导入可恢复模板与历史', async () => {
    const dims = await dbGetDimensions()
    const top = dims.find((d) => d.key === 'top')!
    const grouped = await import('./db').then((m) => m.dbGetAllModulesGrouped())
    const first = grouped[top.id]?.[0] ?? grouped[top.key]?.[0]!
    await dbSaveTemplate('t-backup', null, cfg, [top.key], null, [
      { module: { ...first, dimensionKey: top.key }, weightOverride: null, locked: false },
    ])
    await dbSaveAssembly(null, '{"segments":[]}', 'backup prompt', cfg, [], false)
    const full = await dbExportLibrary(undefined, { includeHistory: true })
    await dbClearLocalData()
    expect(await dbGetDimensions()).toHaveLength(0)
    const r = await dbImportLibraryText(full, 'skip')
    expect(r.dimensionsCreated).toBe(14)
    // 种子自带 2 组同维度 (dimensionKey+contentEn) 重复词条，按去重规则跳过（与 Rust 口径一致）
    expect(r.modulesCreated).toBe(354)
    expect(r.modulesSkipped).toBe(2)
    expect(r.templatesCreated).toBe(1)
    expect(r.assembliesCreated).toBe(1)
  })

  it('错误行宽容跳过并汇总', async () => {
    const doc = {
      format: 'pmf-library',
      version: 1,
      dimensions: [{ id: 'x', nameCn: '缺key' }],
      modules: [{ id: 'm-x', dimensionId: 'no-such', contentEn: 'ghost' }],
      rules: [{ id: 'r-x' }],
      tags: [],
    }
    const r = await dbImportLibraryText(JSON.stringify(doc), 'skip')
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.dimensionsCreated).toBe(0)
    expect(r.modulesCreated).toBe(0)
  })
})

describe('清空本地数据（08§2）', () => {
  it('清空后维度/词条归零', async () => {
    expect((await dbGetDimensions()).length).toBe(14)
    await dbClearLocalData()
    expect(await dbGetDimensions()).toHaveLength(0)
  })
})

describe('词库 CSV（08§2）', () => {
  it('列为 序号/维度Key/维度名/词条EN/显示名/权重/启用，含 BOM，转义双引号', () => {
    const text = buildLibraryCsvText([
      { dimensionKey: 'top', dimensionName: '上装', contentEn: 'say "hi"', displayName: '问候', weight: 1.2, isEnabled: true },
    ])
    expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(text).toContain('维度Key')
    expect(text).toContain('词条EN')
    expect(text).toContain('say ""hi""')
    expect(text).toContain('上装')
  })
})
