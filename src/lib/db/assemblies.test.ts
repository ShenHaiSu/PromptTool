/**
 * need03 S6：db/assemblies 域 invoke 映射 + DTO 映射（含字段缺失/空值与前置校验）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockInvokeOk, tauriApiMock } from '@/tests/tauri-mock'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => tauriApiMock(invoke))

import {
  toAssembly,
  toTemplate,
  dbSaveAssembly,
  dbSaveAssemblyFromIr,
  dbListRecent,
  dbListFavorites,
  dbSearchAssemblies,
  dbGetAssemblyItems,
  dbLoadSelectedItems,
  dbToggleFavorite,
  dbRenameAssembly,
  dbSoftDeleteAssembly,
  dbSaveTemplate,
  dbListTemplates,
  dbApplyTemplate,
  dbSoftDeleteTemplate,
  dbListRules,
  dbCreateRule,
  dbUpdateRule,
  dbDeleteRule,
  dbToggleRule,
  type RuleUpsertPayload,
} from './assemblies'
import type { AssemblyConfig, SelectedItem } from '@/engine/models'

const assemblyDto = {
  id: 'a01',
  title: '套装一',
  promptIrJson: '{"v":1}',
  finalPrompt: 'a white shirt',
  modelProfile: 'sd',
  createdAt: 100,
  isFavorite: false,
}

const templateDto = {
  id: 't01',
  name: '模板A',
  description: null,
  configJson: '{"separator":", "}',
  coverPrompt: null,
  createdAt: 200,
}

const config: AssemblyConfig = {
  separator: ', ',
  useWeightBrackets: true,
  modelProfile: 'sd',
  sortBy: 'dimensionOrder',
}

const modDto = {
  id: 'm01',
  dimensionId: 'd01',
  contentEn: 'a white shirt',
  displayName: '白衬衫',
  weight: 1.5,
  isEnabled: true,
  isNsfw: false,
  usageCount: 3,
  exampleImage: null,
  notes: null,
  dimensionKey: 'top',
}

const selectedItems: SelectedItem[] = [
  { module: { ...modDto } as never, weightOverride: 1.2, locked: false },
  { module: { ...modDto, id: 'm02', dimensionKey: '  ' } as never, weightOverride: null, locked: true },
]

const rulePayload: RuleUpsertPayload = {
  name: '互斥',
  type: 'mutex',
  sourceDimensionId: null,
  sourceModuleId: null,
  targetDimensionId: 'd02',
  targetModuleId: null,
  message: '不能同时出现',
  isEnabled: true,
}

const ruleDto = { id: 'r01', ...rulePayload }

beforeEach(() => invoke.mockReset())

describe('db/assemblies 映射函数', () => {
  it('toAssembly 原样透传', () => {
    expect(toAssembly(assemblyDto)).toEqual({
      id: 'a01',
      title: '套装一',
      promptIrJson: '{"v":1}',
      finalPrompt: 'a white shirt',
      modelProfile: 'sd',
      createdAt: 100,
      isFavorite: false,
    })
  })

  it('toAssembly 字段缺失时透传 undefined', () => {
    const a = toAssembly({ id: 'a02' } as never)
    expect(a.id).toBe('a02')
    expect(a.title).toBeUndefined()
    expect(a.isFavorite).toBeUndefined()
  })

  it('toTemplate configJson 缺失回落空串，其余透传', () => {
    const t = toTemplate({ id: 't02', configJson: null } as never)
    expect(t.configJson).toBe('')
    expect(t.description).toBeUndefined()
    expect(t.coverPrompt).toBeUndefined()
  })

  it('toTemplate 全字段原样透传', () => {
    expect(toTemplate(templateDto)).toEqual({
      id: 't01',
      name: '模板A',
      description: null,
      configJson: '{"separator":", "}',
      coverPrompt: null,
      createdAt: 200,
    })
  })
})

describe('db/assemblies 保存与列表', () => {
  it('dbSaveAssembly 默认 isFavorite=false 并映射 items', async () => {
    invoke.mockImplementationOnce(mockInvokeOk('a01'))
    const id = await dbSaveAssembly('套装一', '{"v":1}', 'a white shirt', config, selectedItems)
    expect(id).toBe('a01')
    const args = invoke.mock.calls[0]![1] as Record<string, unknown>
    expect(invoke.mock.calls[0]![0]).toBe('db_save_assembly')
    expect(args.isFavorite).toBe(false)
    expect(args.config).toEqual(config)
    expect(args.items).toEqual([
      { module: modDto, weightOverride: 1.2, locked: false },
      { module: { ...modDto, id: 'm02', dimensionKey: '  ' }, weightOverride: null, locked: true },
    ])
  })

  it('dbSaveAssembly isFavorite=true 透传', async () => {
    invoke.mockImplementationOnce(mockInvokeOk('a02'))
    await dbSaveAssembly(null, '{}', 'p', config, selectedItems, true)
    expect(invoke.mock.calls[0]![1]).toMatchObject({ title: null, isFavorite: true })
  })

  it('dbSaveAssemblyFromIr 不带 items', async () => {
    invoke.mockImplementationOnce(mockInvokeOk('a03'))
    const id = await dbSaveAssemblyFromIr('{}', 'p', config)
    expect(id).toBe('a03')
    expect(invoke).toHaveBeenCalledWith('db_save_assembly_from_ir', {
      irJson: '{}',
      finalPrompt: 'p',
      config,
      isFavorite: false,
    })
  })

  it('dbListRecent 默认 limit=20 offset=0', async () => {
    invoke.mockImplementationOnce(mockInvokeOk([assemblyDto]))
    const rows = await dbListRecent()
    expect(invoke).toHaveBeenCalledWith('db_list_recent', { limit: 20, offset: 0 })
    expect(rows[0]!.id).toBe('a01')
  })

  it('dbListRecent 自定义 limit/offset', async () => {
    invoke.mockImplementationOnce(mockInvokeOk([]))
    await dbListRecent(5, 10)
    expect(invoke.mock.calls[0]![1]).toEqual({ limit: 5, offset: 10 })
  })

  it('dbListFavorites 默认 limit=100', async () => {
    invoke.mockImplementationOnce(mockInvokeOk([assemblyDto]))
    const rows = await dbListFavorites()
    expect(invoke).toHaveBeenCalledWith('db_list_favorites', { limit: 100 })
    expect(rows).toHaveLength(1)
  })

  it('dbListFavorites 自定义 limit', async () => {
    invoke.mockImplementationOnce(mockInvokeOk([]))
    await dbListFavorites(7)
    expect(invoke.mock.calls[0]![1]).toEqual({ limit: 7 })
  })

  it('dbSearchAssemblies 带 { keyword }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk([assemblyDto]))
    const rows = await dbSearchAssemblies('shirt')
    expect(invoke).toHaveBeenCalledWith('db_search_assemblies', { keyword: 'shirt' })
    expect(rows).toHaveLength(1)
  })

  it('dbGetAssemblyItems 原样返回', async () => {
    const row = { id: 'i1', assemblyId: 'a01', moduleId: 'm01', sortOrder: 0, weightOverride: null, isLocked: false }
    invoke.mockImplementationOnce(mockInvokeOk([row]))
    const rows = await dbGetAssemblyItems('a01')
    expect(invoke).toHaveBeenCalledWith('db_get_assembly_items', { assemblyId: 'a01' })
    expect(rows).toEqual([row])
  })

  it('dbLoadSelectedItems 映射 module/weightOverride/locked', async () => {
    invoke.mockImplementationOnce(mockInvokeOk([{ module: modDto, weightOverride: 2, locked: true }]))
    const items = await dbLoadSelectedItems('a01')
    expect(invoke).toHaveBeenCalledWith('db_load_selected_items', { assemblyId: 'a01' })
    expect(items[0]).toEqual({ module: modDto, weightOverride: 2, locked: true })
  })

  it('dbToggleFavorite 返回布尔', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(true))
    expect(await dbToggleFavorite('a01')).toBe(true)
    expect(invoke).toHaveBeenCalledWith('db_toggle_favorite', { id: 'a01' })
  })

  it('dbRenameAssembly 传 { id, title }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbRenameAssembly('a01', '新标题')
    expect(invoke).toHaveBeenCalledWith('db_rename_assembly', { id: 'a01', title: '新标题' })
  })

  it('dbSoftDeleteAssembly 传 { id }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbSoftDeleteAssembly('a01')
    expect(invoke).toHaveBeenCalledWith('db_soft_delete_assembly', { id: 'a01' })
  })
})

describe('db/assemblies 模板', () => {
  it('dbSaveTemplate 空内容抛错且不调用后端', async () => {
    await expect(dbSaveTemplate('T', null, config, [], null, [])).rejects.toThrow('模板内容为空')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('dbSaveTemplate dimensionKey 为空白抛错并带 moduleId', async () => {
    await expect(dbSaveTemplate('T', null, config, ['top'], null, selectedItems)).rejects.toThrow(
      '模板项缺少 dimensionKey: moduleId=m02',
    )
    expect(invoke).not.toHaveBeenCalled()
  })

  it('dbSaveTemplate 正常提交并映射 selectedItems', async () => {
    invoke.mockImplementationOnce(mockInvokeOk('t02'))
    const id = await dbSaveTemplate('T', '备注', config, ['top'], 'cover.png', [selectedItems[0]!])
    expect(id).toBe('t02')
    expect(invoke).toHaveBeenCalledWith('db_save_template', {
      name: 'T',
      desc: '备注',
      config,
      enabledKeys: ['top'],
      cover: 'cover.png',
      selectedItems: [{ module: modDto, weightOverride: 1.2, locked: false }],
    })
  })

  it('dbSaveTemplate weightOverride 缺失转 null', async () => {
    invoke.mockImplementationOnce(mockInvokeOk('t03'))
    await dbSaveTemplate('T', null, config, ['top'], null, [
      { module: { ...modDto } as never, locked: false } as SelectedItem,
    ])
    expect((invoke.mock.calls[0]![1] as { selectedItems: { weightOverride: unknown }[] }).selectedItems[0]!.weightOverride).toBeNull()
  })

  it('dbListTemplates 逐行映射', async () => {
    invoke.mockImplementationOnce(mockInvokeOk([templateDto]))
    const rows = await dbListTemplates()
    expect(invoke).toHaveBeenCalledWith('db_list_templates')
    expect(rows[0]!.configJson).toBe('{"separator":", "}')
  })

  it('dbApplyTemplate 正常回填三元组', async () => {
    invoke.mockImplementationOnce(mockInvokeOk([
      { separator: ', ', useWeightBrackets: false, modelProfile: 'sdxl', sortBy: 'manual' },
      ['top'],
      [{ module: modDto, weightOverride: null, locked: false }],
    ]))
    const [cfg, keys, items] = await dbApplyTemplate('t01')
    expect(invoke).toHaveBeenCalledWith('db_apply_template', { id: 't01' })
    expect(cfg).toEqual({ separator: ', ', useWeightBrackets: false, modelProfile: 'sdxl', sortBy: 'manual' })
    expect(keys).toEqual(['top'])
    expect(items).toEqual([{ module: modDto, weightOverride: null, locked: false }])
  })

  it('dbApplyTemplate dimensionKey 空白抛错', async () => {
    invoke.mockImplementationOnce(mockInvokeOk([
      { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' },
      ['top'],
      [{ module: { ...modDto, dimensionKey: '   ' }, weightOverride: null, locked: false }],
    ]))
    await expect(dbApplyTemplate('t01')).rejects.toThrow('模板回填 dimensionKey 为空')
  })

  it('dbSoftDeleteTemplate 传 { id }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbSoftDeleteTemplate('t01')
    expect(invoke).toHaveBeenCalledWith('db_soft_delete_template', { id: 't01' })
  })
})

describe('db/assemblies 规则', () => {
  it('dbListRules 默认 includeDisabled=true', async () => {
    invoke.mockImplementationOnce(mockInvokeOk([ruleDto]))
    const rows = await dbListRules()
    expect(invoke).toHaveBeenCalledWith('db_list_rules', { includeDisabled: true })
    expect(rows).toEqual([ruleDto])
  })

  it('dbListRules includeDisabled=false', async () => {
    invoke.mockImplementationOnce(mockInvokeOk([]))
    await dbListRules(false)
    expect(invoke.mock.calls[0]![1]).toEqual({ includeDisabled: false })
  })

  it('dbCreateRule 传 { payload }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(ruleDto))
    const r = await dbCreateRule(rulePayload)
    expect(invoke).toHaveBeenCalledWith('db_create_rule', { payload: rulePayload })
    expect(r.id).toBe('r01')
  })

  it('dbUpdateRule 传 { id, payload }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(ruleDto))
    await dbUpdateRule('r01', rulePayload)
    expect(invoke).toHaveBeenCalledWith('db_update_rule', { id: 'r01', payload: rulePayload })
  })

  it('dbDeleteRule 传 { id }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(undefined))
    await dbDeleteRule('r01')
    expect(invoke).toHaveBeenCalledWith('db_delete_rule', { id: 'r01' })
  })

  it('dbToggleRule 传 { id, isEnabled }', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ ...ruleDto, isEnabled: false }))
    const r = await dbToggleRule('r01', false)
    expect(invoke).toHaveBeenCalledWith('db_toggle_rule', { id: 'r01', isEnabled: false })
    expect(r.isEnabled).toBe(false)
  })
})

describe('db/assemblies 失败分支', () => {
  it('后端 reject 时异常向上抛出', async () => {
    invoke.mockRejectedValueOnce(new Error('boom'))
    await expect(dbListRecent()).rejects.toThrow('boom')
  })

  it('dbApplyTemplate 后端 reject 向上抛出', async () => {
    invoke.mockRejectedValueOnce(new Error('no template'))
    await expect(dbApplyTemplate('t01')).rejects.toThrow('no template')
  })
})