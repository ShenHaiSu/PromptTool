import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const mockDb = vi.hoisted(() => ({
  listRecent: vi.fn(async () => [{ id: 'a1', title: 't1', promptIrJson: '{}', finalPrompt: 'hello world', modelProfile: 'sd', createdAt: 1700000000, isFavorite: false }]),
  listFavorites: vi.fn(async () => []),
  listTemplates: vi.fn(async () => []),
  saveAssembly: vi.fn(async () => 'new-id'),
  saveTemplate: vi.fn(async () => 'tmpl-1'),
  toggleFavorite: vi.fn(async () => true),
  softDeleteAssembly: vi.fn(async () => {}),
  softDeleteTemplate: vi.fn(async () => {}),
  searchAssemblies: vi.fn(async () => [{ id: 'a1', title: 't1', promptIrJson: '{}', finalPrompt: 'hello', modelProfile: 'sd', createdAt: 1, isFavorite: false }]),
  renameAssembly: vi.fn(async () => {}),
  loadSelectedItems: vi.fn(async () => [{ module: { id: 'm1', dimensionId: 'd1', contentEn: 'white shirt', displayName: '白衬衫', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' }, weightOverride: null, locked: false }]),
  applyTemplate: vi.fn(async () => [{ separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }, ['top', 'bottom']] as const),
}))

vi.mock('@/lib/db', () => ({
  dbListRecent: mockDb.listRecent,
  dbListFavorites: mockDb.listFavorites,
  dbListTemplates: mockDb.listTemplates,
  dbSaveAssembly: mockDb.saveAssembly,
  dbSaveTemplate: mockDb.saveTemplate,
  dbToggleFavorite: mockDb.toggleFavorite,
  dbSoftDeleteAssembly: mockDb.softDeleteAssembly,
  dbSoftDeleteTemplate: mockDb.softDeleteTemplate,
  dbSearchAssemblies: mockDb.searchAssemblies,
  dbRenameAssembly: mockDb.renameAssembly,
  dbLoadSelectedItems: mockDb.loadSelectedItems,
  dbApplyTemplate: mockDb.applyTemplate,
  dbSearchModules: vi.fn(async () => []),
  dbGetDimensions: vi.fn(async () => []),
}))

import { useHistoryStore } from './history'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mockDb.listRecent.mockResolvedValue([{ id: 'a1', title: 't1', promptIrJson: '{}', finalPrompt: 'hello world', modelProfile: 'sd', createdAt: 1700000000, isFavorite: false }])
})

describe('history store P5 扩展', () => {
  it('save() 调用 dbSaveAssembly 并刷新 recent', async () => {
    const s = useHistoryStore()
    const id = await s.save(null, '{"segments":[]}', 'hello', { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }, [], false)
    expect(id).toBe('new-id')
    expect(mockDb.saveAssembly).toHaveBeenCalled()
    expect(mockDb.listRecent).toHaveBeenCalled()
  })

  it('save() isFavorite 时同时刷新 favorites', async () => {
    const s = useHistoryStore()
    await s.save(null, '{}', 'p', { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }, [], true)
    expect(mockDb.listFavorites).toHaveBeenCalled()
  })

  it('rename() 同步更新 recent/favorites', async () => {
    const s = useHistoryStore()
    await s.fetchRecent()
    await s.rename('a1', '新标题')
    expect(mockDb.renameAssembly).toHaveBeenCalledWith('a1', '新标题')
    expect(s.recent[0]!.title).toBe('新标题')
  })

  it('toggleFavorite() 同步并刷新 favorites', async () => {
    const s = useHistoryStore()
    await s.fetchRecent()
    const v = await s.toggleFavorite('a1')
    expect(v).toBe(true)
    expect(mockDb.toggleFavorite).toHaveBeenCalledWith('a1')
    expect(mockDb.listFavorites).toHaveBeenCalled()
    expect(s.recent[0]!.isFavorite).toBe(true)
  })

  it('softDeleteAssembly() 移除本地 recent', async () => {
    const s = useHistoryStore()
    await s.fetchRecent()
    expect(s.recent).toHaveLength(1)
    await s.softDeleteAssembly('a1')
    expect(mockDb.softDeleteAssembly).toHaveBeenCalledWith('a1')
    expect(s.recent).toHaveLength(0)
  })

  it('search()/clearSearch() 行为正确', async () => {
    const s = useHistoryStore()
    await s.search('hello')
    expect(mockDb.searchAssemblies).toHaveBeenCalledWith('hello')
    expect(s.searchResults).toHaveLength(1)
    s.clearSearch()
    expect(s.searchQuery).toBe('')
    expect(s.searchResults).toHaveLength(0)
  })

  it('saveTemplate() 与 applyTemplate() 闭环', async () => {
    const s = useHistoryStore()
    const tid = await s.saveTemplate('模板A', 'desc', { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }, ['top'], 'cover')
    expect(tid).toBe('tmpl-1')
    expect(mockDb.saveTemplate).toHaveBeenCalled()
    const [cfg, keys] = await s.applyTemplate('tmpl-1')
    expect(cfg.separator).toBe(', ')
    expect(keys).toContain('top')
  })

  it('loadSelectedItems() 透传并支持已失效占位（返回即有效）', async () => {
    const s = useHistoryStore()
    const items = await s.loadSelectedItems('a1')
    expect(mockDb.loadSelectedItems).toHaveBeenCalledWith('a1')
    expect(items[0]!.module.id).toBe('m1')
  })

  it('removeTemplate() 删除本地', async () => {
    mockDb.listTemplates.mockResolvedValue([{ id: 't1', name: 'T1', description: null, configJson: '{}', coverPrompt: null, createdAt: 1 } as never])
    const s = useHistoryStore()
    await s.fetchTemplates()
    expect(s.templates).toHaveLength(1)
    await s.removeTemplate('t1')
    expect(mockDb.softDeleteTemplate).toHaveBeenCalledWith('t1')
    expect(s.templates).toHaveLength(0)
  })
})
