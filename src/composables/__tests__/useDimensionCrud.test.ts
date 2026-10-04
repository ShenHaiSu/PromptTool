/**
 * need03 S6：useDimensionCrud CRUD 编排（create/edit 分支 + 失败收敛 + 事件广播）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const { db, notifyMock, libraryMock } = vi.hoisted(() => ({
  db: {
    dbCreateDimension: vi.fn(),
    dbUpdateDimension: vi.fn(),
    dbCreateModule: vi.fn(),
    dbUpdateModule: vi.fn(),
    dbSoftDeleteModule: vi.fn(),
    dbClearDimension: vi.fn(),
    dbMigrateDimension: vi.fn(),
  },
  notifyMock: vi.fn(),
  libraryMock: { fetchAll: vi.fn() },
}))
vi.mock('@/lib/db', () => db)
vi.mock('@/lib/notify', () => ({ notify: notifyMock }))
vi.mock('@/stores/library', () => ({ useLibraryStore: () => libraryMock }))

import { useDimensionCrud } from '../useDimensionCrud'
import { on, off, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import type { Dimension, Module } from '@/engine/models'

const dim: Dimension = {
  id: 'd01',
  key: 'top',
  nameCn: '上衣',
  nameEn: 'Top',
  sortOrder: 1,
  isMultiSelect: false,
  isEnabled: true,
  icon: null,
}

const mod: Module = {
  id: 'm01',
  dimensionId: 'd01',
  contentEn: 'a shirt',
  displayName: '衬衫',
  weight: 1,
  isEnabled: true,
  isNsfw: false,
  usageCount: 0,
  dimensionKey: 'top',
} as Module

const dimPayload = { key: 'top', nameCn: '上衣', nameEn: 'Top', sortOrder: 1, isMultiSelect: false }
const modPayload = { dimensionId: 'd01', contentEn: 'a shirt', displayName: '衬衫', weight: 1, isNsfw: false, notes: '' }

beforeEach(() => {
  setActivePinia(createPinia())
  for (const fn of Object.values(db)) fn.mockReset()
  notifyMock.mockReset()
  libraryMock.fetchAll.mockReset()
  libraryMock.fetchAll.mockResolvedValue(undefined)
  db.dbCreateDimension.mockResolvedValue(dim)
  db.dbUpdateDimension.mockResolvedValue(undefined)
  db.dbCreateModule.mockResolvedValue(mod)
  db.dbUpdateModule.mockResolvedValue(undefined)
  db.dbSoftDeleteModule.mockResolvedValue(undefined)
  db.dbClearDimension.mockResolvedValue({ cleared: 4 })
  db.dbMigrateDimension.mockResolvedValue({ archive: dim, fresh: dim, moved: 6 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('useDimensionCrud 维度', () => {
  it('openCreateDimension 置 create 模式并清编辑对象', () => {
    const c = useDimensionCrud()
    c.openEditDimension(dim)
    c.openCreateDimension()
    expect(c.dimDialogMode.value).toBe('create')
    expect(c.editingDim.value).toBeNull()
    expect(c.dimDialogOpen.value).toBe(true)
  })

  it('openEditDimension 置 edit 模式并带对象', () => {
    const c = useDimensionCrud()
    c.openEditDimension(dim)
    expect(c.dimDialogMode.value).toBe('edit')
    expect(c.editingDim.value).toEqual(dim)
    expect(c.dimDialogOpen.value).toBe(true)
  })

  it('confirmDimension 新建：调 dbCreateDimension + 刷新 + 广播', async () => {
    const c = useDimensionCrud()
    c.openCreateDimension()
    const seen: unknown[] = []
    const h = (p: unknown) => seen.push(p)
    on(LIBRARY_CHANGED, h)
    await c.confirmDimension(dimPayload)
    off(LIBRARY_CHANGED, h)
    expect(db.dbCreateDimension).toHaveBeenCalledWith('top', '上衣', 'Top', 1, false)
    expect(notifyMock).toHaveBeenCalledWith('维度已创建', 'success', 1500)
    expect(c.dimDialogOpen.value).toBe(false)
    expect(libraryMock.fetchAll).toHaveBeenCalled()
    expect(seen).toEqual([{ source: 'dimension-crud', op: 'dimension-changed' }])
  })

  it('confirmDimension 编辑：调 dbUpdateDimension 并合并 payload', async () => {
    const c = useDimensionCrud()
    c.openEditDimension(dim)
    await c.confirmDimension({ ...dimPayload, nameCn: '上衣2' })
    expect(db.dbUpdateModule).not.toHaveBeenCalled()
    expect(db.dbUpdateDimension).toHaveBeenCalledWith({ ...dim, nameCn: '上衣2' })
    expect(notifyMock).toHaveBeenCalledWith('维度已更新', 'success', 1500)
  })

  it('confirmDimension 失败：报错弹窗且不关对话框', async () => {
    const c = useDimensionCrud()
    c.openCreateDimension()
    db.dbCreateDimension.mockRejectedValueOnce(new Error('dim boom'))
    await expect(c.confirmDimension(dimPayload)).resolves.toBeUndefined()
    expect(c.dimDialogOpen.value).toBe(true)
    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('保存失败'), 'error')
    expect(libraryMock.fetchAll).not.toHaveBeenCalled()
  })

  it('edit 模式但 editingDim 为空时回落到新建分支', async () => {
    const c = useDimensionCrud()
    c.dimDialogMode.value = 'edit'
    c.editingDim.value = null
    await c.confirmDimension(dimPayload)
    expect(db.dbCreateDimension).toHaveBeenCalled()
    expect(db.dbUpdateDimension).not.toHaveBeenCalled()
  })
})

describe('useDimensionCrud 词条', () => {
  it('openCreateModule 置 create 模式并记 modDimId', () => {
    const c = useDimensionCrud()
    c.openEditModule(mod)
    c.openCreateModule('d09')
    expect(c.modDialogMode.value).toBe('create')
    expect(c.editingMod.value).toBeNull()
    expect(c.modDimId.value).toBe('d09')
    expect(c.modDialogOpen.value).toBe(true)
  })

  it('openEditModule 置 edit 模式并带对象', () => {
    const c = useDimensionCrud()
    c.openEditModule(mod)
    expect(c.modDialogMode.value).toBe('edit')
    expect(c.editingMod.value).toEqual(mod)
    expect(c.modDimId.value).toBe('d01')
  })

  it('confirmModule 新建：调 dbCreateModule + 刷新 + 广播', async () => {
    const c = useDimensionCrud()
    c.openCreateModule('d01')
    const seen: unknown[] = []
    const h = (p: unknown) => seen.push(p)
    on(LIBRARY_CHANGED, h)
    await c.confirmModule(modPayload)
    off(LIBRARY_CHANGED, h)
    expect(db.dbCreateModule).toHaveBeenCalledWith('d01', 'a shirt', '衬衫', 1)
    expect(notifyMock).toHaveBeenCalledWith('词条已创建', 'success', 1500)
    expect(c.modDialogOpen.value).toBe(false)
    expect(seen).toEqual([{ source: 'dimension-crud', op: 'module-changed' }])
  })

  it('confirmModule 编辑：调 dbUpdateModule 并合并 payload', async () => {
    const c = useDimensionCrud()
    c.openEditModule(mod)
    await c.confirmModule({ ...modPayload, contentEn: 'a new shirt' })
    expect(db.dbUpdateModule).toHaveBeenCalledWith(expect.objectContaining({ id: 'm01', contentEn: 'a new shirt' }))
    expect(notifyMock).toHaveBeenCalledWith('词条已更新', 'success', 1500)
  })

  it('confirmModule 失败：报错弹窗且不关对话框', async () => {
    const c = useDimensionCrud()
    c.openCreateModule('d01')
    db.dbCreateModule.mockRejectedValueOnce(new Error('mod boom'))
    await expect(c.confirmModule(modPayload)).resolves.toBeUndefined()
    expect(c.modDialogOpen.value).toBe(true)
    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('保存失败'), 'error')
  })

  it('removeModule 成功：软删 + 刷新 + 广播', async () => {
    const c = useDimensionCrud()
    const seen: unknown[] = []
    const h = (p: unknown) => seen.push(p)
    on(LIBRARY_CHANGED, h)
    await c.removeModule('m01')
    off(LIBRARY_CHANGED, h)
    expect(db.dbSoftDeleteModule).toHaveBeenCalledWith('m01')
    expect(notifyMock).toHaveBeenCalledWith('已删除词条', 'success', 1500)
    expect(seen).toEqual([{ source: 'dimension-crud', op: 'module-deleted' }])
  })

  it('removeModule 失败：报错弹窗', async () => {
    const c = useDimensionCrud()
    db.dbSoftDeleteModule.mockRejectedValueOnce(new Error('del boom'))
    await expect(c.removeModule('m01')).resolves.toBeUndefined()
    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('删除失败'), 'error')
  })
})

describe('useDimensionCrud 清空与迁移', () => {
  it('clearDimension 成功：回显条数 + 刷新 + 广播', async () => {
    const c = useDimensionCrud()
    const seen: unknown[] = []
    const h = (p: unknown) => seen.push(p)
    on(LIBRARY_CHANGED, h)
    await c.clearDimension('d01')
    off(LIBRARY_CHANGED, h)
    expect(db.dbClearDimension).toHaveBeenCalledWith({ dimensionId: 'd01' })
    expect(notifyMock).toHaveBeenCalledWith('已清空 4 条', 'success', 1500)
    expect(seen).toEqual([{ source: 'dimension-crud', op: 'dimension-cleared' }])
  })

  it('clearDimension 失败：报错弹窗', async () => {
    const c = useDimensionCrud()
    db.dbClearDimension.mockRejectedValueOnce(new Error('clear boom'))
    await expect(c.clearDimension('d01')).resolves.toBeUndefined()
    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('清空失败'), 'error')
  })

  it('migrateDimension 成功：回显条数 + 刷新 + 广播', async () => {
    const c = useDimensionCrud()
    const seen: unknown[] = []
    const h = (p: unknown) => seen.push(p)
    on(LIBRARY_CHANGED, h)
    await c.migrateDimension('d01')
    off(LIBRARY_CHANGED, h)
    expect(db.dbMigrateDimension).toHaveBeenCalledWith({ dimensionId: 'd01' })
    expect(notifyMock).toHaveBeenCalledWith('已迁移 6 条', 'success', 1500)
    expect(seen).toEqual([{ source: 'dimension-crud', op: 'dimension-migrated' }])
  })

  it('migrateDimension 失败：报错弹窗', async () => {
    const c = useDimensionCrud()
    db.dbMigrateDimension.mockRejectedValueOnce(new Error('migrate boom'))
    await expect(c.migrateDimension('d01')).resolves.toBeUndefined()
    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('迁移失败'), 'error')
  })
})