/**
 * db.idb 行为测试（阶段二）：fake-indexeddb 内存库，覆盖种子/CRUD/拼装/模板/
 * 批量/片段/翻译/规则/词库/temp_carry/NotSupported 口径。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { IDB_NAME } from './idb'
import { resetDbForTest } from './seed'
import {
  dbApplyTemplate,
  dbBatchCreateModules,
  dbBatchCreateModulesText,
  dbBatchUpdateDisplayNames,
  dbBatchUpdateDisplayNamesText,
  dbCreateDimension,
  dbCreateModule,
  dbCreateRule,
  dbDeleteRule,
  dbExportCsv,
  dbExportLibrary,
  dbExportLibraryToDir,
  dbGetActiveInfo,
  dbGetAllModulesGrouped,
  dbGetDefaultExportDir,
  dbGetDimensions,
  dbGetModulesByDimension,
  dbGetTempCarry,
  dbImportLibraryText,
  dbImportSegments,
  dbImportSegmentsText,
  dbListFavorites,
  dbListRecent,
  dbListRules,
  dbListTemplates,
  dbLoadSelectedItems,
  dbRenameAssembly,
  dbSaveAssembly,
  dbSaveAssemblyFromIr,
  dbSaveTemplate,
  dbSearchAssemblies,
  dbSearchModules,
  dbSetTempCarry,
  dbSoftDeleteDimension,
  dbSoftDeleteModule,
  dbSoftDeleteTemplate,
  dbToggleFavorite,
  dbToggleRule,
  dbUpdateDimension,
  dbUpdateModule,
  dbUpdateRule,
  dbValidateBusiness,
} from './db'
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

describe('seed', () => {
  it('首次 open 写入 14 维 / 356 词条 / 3 规则', async () => {
    const dims = await dbGetDimensions()
    expect(dims).toHaveLength(14)
    expect(dims.map((d) => d.key)).toContain('body')
    expect(dims[0]!.key).toBe('gender')
    const grouped = await dbGetAllModulesGrouped()
    const total = Object.values(grouped).reduce((n, arr) => n + arr.length, 0)
    expect(total).toBe(356)
    expect(await dbListRules()).toHaveLength(3)
  })

  it('重复 open 不重复 seed（幂等）', async () => {
    await dbGetDimensions()
    await resetDbForTest()
    const dims = await dbGetDimensions()
    expect(dims).toHaveLength(14)
  })
})

describe('维度 / 词条', () => {
  it('CRUD 与软删除', async () => {
    const d = await dbCreateDimension('testkey', '测试维', 'Test', 99, false)
    expect(d.key).toBe('testkey')
    await expect(dbCreateDimension('testkey', '重复')).rejects.toThrow('已存在')
    await expect(dbCreateDimension('  ', '空键')).rejects.toThrow('键名不能为空')
    const m = await dbCreateModule(d.id, 'red hat xyz123', '红帽子', 1.5)
    expect(m.dimensionKey).toBe('testkey')
    await dbUpdateModule({ ...m, displayName: '大红帽' })
    expect((await dbGetModulesByDimension(d.id))[0]!.displayName).toBe('大红帽')
    expect((await dbSearchModules('xyz123'))).toHaveLength(1)
    await expect(dbSoftDeleteDimension(d.id)).rejects.toThrow('仍有 1 个词条')
    await dbSoftDeleteModule(m.id)
    expect(await dbGetModulesByDimension(d.id)).toHaveLength(0)
    await dbSoftDeleteDimension(d.id)
    expect((await dbGetDimensions()).some((x) => x.id === d.id)).toBe(false)
  })

  it('维度更新校验', async () => {
    const dims = await dbGetDimensions()
    const body = dims.find((d) => d.key === 'body')!
    await expect(dbUpdateDimension({ ...body, nameCn: '  ' })).rejects.toThrow('中文名称不能为空')
    await dbUpdateDimension({ ...body, nameCn: '身材' })
    expect((await dbGetDimensions()).find((d) => d.id === body.id)!.nameCn).toBe('身材')
  })
})

describe('拼装', () => {
  it('保存 / 列表 / 收藏 / 回填', async () => {
    const dims = await dbGetDimensions()
    const body = dims.find((d) => d.key === 'body')!
    const mods = await dbGetModulesByDimension(body.id)
    const mod = mods[0]!
    const ir = JSON.stringify({
      segments: [{ dimensionKey: 'body', text: mod.contentEn, weight: 1, sourceModuleId: mod.id }],
      warnings: [],
    })
    const id = await dbSaveAssembly(null, ir, mod.contentEn, cfg, [{ module: mod, locked: false }], false)
    expect((await dbListRecent()).map((a) => a.id)).toContain(id)
    expect(await dbToggleFavorite(id)).toBe(true)
    expect(await dbListFavorites()).toHaveLength(1)
    const back = await dbLoadSelectedItems(id)
    expect(back[0]!.module.id).toBe(mod.id)
    await dbRenameAssembly(id, '我的方案')
    expect((await dbSearchAssemblies('我的方案'))).toHaveLength(1)
  })

  it('fromIr 保存并按 weight 写 override', async () => {
    const dims = await dbGetDimensions()
    const top = dims.find((d) => d.key === 'top')!
    const mod = (await dbGetModulesByDimension(top.id))[0]!
    const ir = JSON.stringify({
      segments: [{ dimensionKey: 'top', text: mod.contentEn, weight: 1.5, sourceModuleId: mod.id }],
      warnings: [],
    })
    const id = await dbSaveAssemblyFromIr(ir, mod.contentEn, cfg, false)
    const back = await dbLoadSelectedItems(id)
    expect(back[0]!.weightOverride).toBe(1.5)
  })

  it('已删词条回填 [已失效] 占位', async () => {
    const dims = await dbGetDimensions()
    const body = dims.find((d) => d.key === 'body')!
    const mod = (await dbGetModulesByDimension(body.id))[0]!
    const ir = JSON.stringify({
      segments: [{ dimensionKey: 'body', text: mod.contentEn, weight: 1, sourceModuleId: mod.id }],
      warnings: [],
    })
    const id = await dbSaveAssembly('t', ir, mod.contentEn, cfg, [{ module: mod, locked: false }])
    await dbSoftDeleteModule(mod.id)
    const back = await dbLoadSelectedItems(id)
    expect(back[0]!.module.displayName).toContain('[已失效]')
    expect(back[0]!.module.dimensionKey).toBe('body')
  })
})

describe('模板', () => {
  it('保存 / 回填 / 删除', async () => {
    const dims = await dbGetDimensions()
    const body = dims.find((d) => d.key === 'body')!
    const mod = (await dbGetModulesByDimension(body.id))[0]!
    await expect(dbSaveTemplate('空', null, cfg, ['body'], null, [])).rejects.toThrow('模板内容为空')
    const tid = await dbSaveTemplate('t1', 'desc', cfg, ['body'], null, [{ module: mod, locked: true }])
    expect(await dbListTemplates()).toHaveLength(1)
    const [c, keys, items] = await dbApplyTemplate(tid)
    expect(c.modelProfile).toBe('sd')
    expect(keys).toEqual(['body'])
    expect(items[0]!.module.id).toBe(mod.id)
    expect(items[0]!.locked).toBe(true)
    await dbSoftDeleteTemplate(tid)
    expect(await dbListTemplates()).toHaveLength(0)
  })
})

describe('批量', () => {
  it('skip 去重 / overwrite 更新', async () => {
    const dims = await dbGetDimensions()
    const top = dims.find((d) => d.key === 'top')!
    const r1 = await dbBatchCreateModules({
      dimId: top.id,
      items: [{ contentEn: 'new hat' }, { contentEn: 'new hat' }, { contentEn: '  ' }],
      mode: 'skip',
    })
    expect(r1.modulesCreated).toBe(1)
    expect(r1.duplicateInBatch).toBe(1)
    expect(r1.emptyIgnored).toBe(1)
    const r2 = await dbBatchCreateModules({ dimId: top.id, items: [{ contentEn: 'new hat' }], mode: 'skip' })
    expect(r2.modulesSkipped).toBe(1)
    const r3 = await dbBatchCreateModules({
      dimId: top.id,
      items: [{ contentEn: 'new hat', displayName: '新帽' }],
      mode: 'overwrite',
    })
    expect(r3.modulesUpdated).toBe(1)
    const hit = (await dbSearchModules('new hat'))[0]!
    expect(hit.displayName).toBe('新帽')
  })

  it('text 版按行拆分', async () => {
    const dims = await dbGetDimensions()
    const top = dims.find((d) => d.key === 'top')!
    const r = await dbBatchCreateModulesText(top.id, 'alpha\n\nbeta', 'skip')
    expect(r.totalRequested).toBe(3)
    expect(r.modulesCreated).toBe(2)
  })
})

describe('片段', () => {
  it('ignore 与 to_camera 策略', async () => {
    const r = await dbImportSegments({
      format: 'pmf-segments',
      formatVersion: 1,
      prompts: [
        {
          id: 'p1',
          raw: 'raw text',
          segments: [
            { dimensionKey: 'top', contentEn: 'seg top new' },
            { dimensionKey: 'unassigned', contentEn: 'seg lost' },
          ],
        },
      ],
      unassignedStrategy: 'ignore',
      mode: 'skip',
    })
    expect(r.prompts).toBe(1)
    expect(r.segmentsTotal).toBe(2)
    expect(r.segmentsIgnoredUnassigned).toBe(1)
    expect(r.modulesCreated).toBe(1)
    const r2 = await dbImportSegmentsText(
      JSON.stringify({ raw: 'raw text', segments: [{ dimensionKey: 'unassigned', contentEn: 'seg cam new' }] }),
      'to_camera',
      'skip',
    )
    expect(r2.modulesCreated).toBe(1)
    const cams = await dbSearchModules('seg cam new')
    const dims = await dbGetDimensions()
    const camera = dims.find((d) => d.key === 'camera')!
    expect(cams[0]!.dimensionId).toBe(camera.id)
  })

  it('prompt_new 预检拦截 unassigned', async () => {
    await expect(
      dbImportSegments({
        format: 'pmf-segments',
        formatVersion: 1,
        prompts: [{ id: 'p1', raw: 'x', segments: [{ dimensionKey: 'unassigned', contentEn: 'y' }] }],
        unassignedStrategy: 'prompt_new',
        mode: 'skip',
      }),
    ).rejects.toThrow('未分配片段')
  })
})

describe('翻译', () => {
  it('payload 回填与归属校验', async () => {
    const dims = await dbGetDimensions()
    const top = dims.find((d) => d.key === 'top')!
    const body = dims.find((d) => d.key === 'body')!
    const mod = (await dbGetModulesByDimension(top.id))[0]!
    const r = await dbBatchUpdateDisplayNames({ dimensionId: top.id, items: [{ id: mod.id, displayName: '上衣一' }] })
    expect(r.updated).toBe(1)
    const r2 = await dbBatchUpdateDisplayNames({ dimensionId: body.id, items: [{ id: mod.id, displayName: '错维' }] })
    expect(r2.updated).toBe(0)
    expect(r2.skipped).toBe(1)
    const r3 = await dbBatchUpdateDisplayNames({ dimensionId: top.id, items: [{ id: 'no-such', displayName: 'x' }] })
    expect(r3.skipped).toBe(1)
  })

  it('text 版解析 pmf-translation', async () => {
    const dims = await dbGetDimensions()
    const top = dims.find((d) => d.key === 'top')!
    const mod = (await dbGetModulesByDimension(top.id))[0]!
    const text = JSON.stringify({ format: 'pmf-translation', items: [{ id: mod.id, zh: '翻译名' }] })
    const r = await dbBatchUpdateDisplayNamesText(text, top.id)
    expect(r.updated).toBe(1)
  })
})

describe('规则', () => {
  it('CRUD 与校验', async () => {
    await expect(
      dbCreateRule({ name: '  ', type: 'mutex', sourceDimensionId: null, sourceModuleId: null, targetDimensionId: null, targetModuleId: null, message: 'm', isEnabled: true }),
    ).rejects.toThrow('名称不能为空')
    const dims = await dbGetDimensions()
    const outfit = dims.find((d) => d.key === 'outfit')!
    const r = await dbCreateRule({
      name: 't-rule', type: 'mutex',
      sourceDimensionId: outfit.id, sourceModuleId: null,
      targetDimensionId: null, targetModuleId: null,
      message: 'msg', isEnabled: true,
    })
    expect(r.id.startsWith('rule_')).toBe(true)
    expect((await dbListRules(false)).some((x) => x.id === r.id)).toBe(true)
    const off = await dbToggleRule(r.id, false)
    expect(off.isEnabled).toBe(false)
    expect((await dbListRules(false)).some((x) => x.id === r.id)).toBe(false)
    const upd = await dbUpdateRule(r.id, { ...r, message: 'msg2' })
    expect(upd.message).toBe('msg2')
    await dbDeleteRule(r.id)
    expect((await dbListRules()).some((x) => x.id === r.id)).toBe(false)
  })
})

describe('词库', () => {
  it('导出自导入 skip 全跳过', async () => {
    const json = await dbExportLibrary()
    const doc = JSON.parse(json) as { format: string; counts: { dimensions: number; modules: number } }
    expect(doc.format).toBe('pmf-library')
    expect(doc.counts.dimensions).toBe(14)
    expect(doc.counts.modules).toBe(356)
    const r = await dbImportLibraryText(json, 'skip')
    expect(r.dimensionsSkipped).toBe(14)
    expect(r.modulesSkipped).toBe(356)
    // rule_03 引用的 mod_bg_01 在种子中不存在（Rust seed 原生悬空引用），按 Rust 口径 errors+跳过
    expect(r.rulesSkipped).toBe(3)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('室内外背景互斥')
  })

  it('非法输入抛错', async () => {
    await expect(dbImportLibraryText('not json', 'skip')).rejects.toThrow('JSON 解析失败')
    await expect(dbImportLibraryText('{}', 'skip')).rejects.toThrow('不支持的库文件格式')
    const json = await dbExportLibrary()
    await expect(dbImportLibraryText(json, 'bad' as never)).rejects.toThrow('未知导入模式')
  })
})

describe('系统', () => {
  it('temp_carry 经 kv 读写', async () => {
    expect(await dbGetTempCarry()).toBeNull()
    await dbSetTempCarry({ selectedItemIds: ['a'], weightDraft: { a: 1.5 } })
    expect(await dbGetTempCarry()).toEqual({ selectedItemIds: ['a'], weightDraft: { a: 1.5 } })
  })

  it('不支持项抛错 / 读侧空值', async () => {
    await expect(dbExportCsv('x', '[]')).rejects.toThrow('NotSupportedInWeb')
    await expect(dbExportLibraryToDir('x')).rejects.toThrow('NotSupportedInWeb')
    expect(await dbGetDefaultExportDir()).toBe('')
    expect(await dbValidateBusiness('x')).toMatchObject({ valid: false })
    expect(await dbGetActiveInfo()).toMatchObject({ maxActive: 1 })
  })
})
