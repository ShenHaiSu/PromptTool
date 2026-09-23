import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAssemblyStore } from '@/stores/assembly'

const POSE_MODS = [
  { id: 'm_pose_1', dimensionId: 'd_pose', contentEn: 'standing', displayName: '站立', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'pose' },
  { id: 'm_pose_2', dimensionId: 'd_pose', contentEn: 'sitting', displayName: '坐着', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'pose' },
]

const MIGRATE_OK = {
  archive: { id: 'd_pose', key: 'pose_bak_k7x2qd', nameCn: '姿态（归档）', nameEn: 'Pose', sortOrder: 9, isMultiSelect: true, isEnabled: true, icon: null },
  fresh: { id: 'd_fresh', key: 'pose', nameCn: '姿态', nameEn: 'Pose', sortOrder: 1, isMultiSelect: true, isEnabled: true, icon: null },
  moved: 2,
}

const dbMocks = vi.hoisted(() => ({
  dbGetDimensions: vi.fn().mockResolvedValue([
    { id: 'd_pose', key: 'pose', nameCn: '姿态', nameEn: 'Pose', sortOrder: 1, isMultiSelect: true, isEnabled: true, icon: null },
  ]),
  dbGetAllModulesGrouped: vi.fn().mockResolvedValue({ pose: [] }),
  dbCreateDimension: vi.fn().mockResolvedValue({ id: 'd_new', key: 'new_dim', nameCn: '新维度', nameEn: 'New', sortOrder: 0, isMultiSelect: false, isEnabled: true }),
  dbUpdateDimension: vi.fn().mockResolvedValue(undefined),
  dbCreateModule: vi.fn().mockResolvedValue({ id: 'm_new', dimensionId: 'd_pose', contentEn: 'new', displayName: '新', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0 }),
  dbUpdateModule: vi.fn().mockResolvedValue(undefined),
  dbSoftDeleteModule: vi.fn().mockResolvedValue(undefined),
  dbMigrateDimension: vi.fn(),
}))
vi.mock('@/lib/db', () => dbMocks)
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))

import DimensionPanel from '../DimensionPanel.vue'

async function flush(wrapper: ReturnType<typeof mount>) {
  await new Promise((r) => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 30))
  await wrapper.vm.$nextTick()
}

function mountPanel() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const w = mount(DimensionPanel, { global: { plugins: [pinia] }, attachTo: document.body })
  return { w, asm: useAssemblyStore() }
}

async function openMigrate(w: ReturnType<typeof mount>) {
  await w.find('[data-testid="dimension-header-pose"]').trigger('contextmenu', { clientX: 10, clientY: 10 })
  await w.vm.$nextTick()
  ;(document.body.querySelector('[data-testid="dim-ctx-migrate-pose"]') as HTMLElement).click()
  await w.vm.$nextTick()
}

describe('Need08 — 迁移维度', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    localStorage.clear()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
    dbMocks.dbGetAllModulesGrouped.mockResolvedValue({ pose: [...POSE_MODS] })
    dbMocks.dbMigrateDimension.mockResolvedValue(MIGRATE_OK)
  })

  it('1. 对话框展示归档预览 _bak_ 与 N，未勾选时确认 disabled', async () => {
    const { w } = mountPanel()
    await flush(w)
    await openMigrate(w)
    const dlg = document.body.querySelector('[data-testid="migrate-dialog"]') as HTMLElement
    expect(dlg).toBeTruthy()
    expect(dlg.textContent).toContain('pose_bak_')
    expect(dlg.textContent).toContain('2 条')
    expect(dlg.textContent).toContain('历史方案/模板按模块 id 引用不受影响')
    expect((document.body.querySelector('[data-testid="migrate-confirm-btn"]') as HTMLButtonElement).disabled).toBe(true)
    w.unmount()
  })

  it('2. 确认后调 dbMigrateDimension 一次，成功后关闭对话框并强刷', async () => {
    const { w, asm } = mountPanel()
    await flush(w)
    asm.addModule({ module: { ...POSE_MODS[0]! } as any, locked: false, weightOverride: null })
    expect(asm.selectedItems.length).toBe(1)
    await openMigrate(w)
    await w.find('[data-testid="migrate-confirm-check"]').setValue(true)
    await w.vm.$nextTick()
    ;(document.body.querySelector('[data-testid="migrate-confirm-btn"]') as HTMLElement).click()
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 50))
    await w.vm.$nextTick()
    expect(dbMocks.dbMigrateDimension).toHaveBeenCalledTimes(1)
    expect(dbMocks.dbMigrateDimension).toHaveBeenCalledWith({ dimensionId: 'd_pose' })
    expect(document.body.querySelector('[data-testid="migrate-dialog"]')).toBeFalsy()
    // 原维度已选项联动移出
    expect(asm.selectedItems.length).toBe(0)
    // 强刷（fetchAll → dbGetDimensions 被再次调用）+ 新生维度保持展开
    expect(dbMocks.dbGetDimensions.mock.calls.length).toBeGreaterThan(1)
    expect(localStorage.getItem('pmf:expandedKeys')).toContain('pose')
    w.unmount()
  })

  it('3. 失败时对话框保持打开（toast 由面板发出）', async () => {
    dbMocks.dbMigrateDimension.mockRejectedValueOnce('归档键名冲突，请重试')
    const { w } = mountPanel()
    await flush(w)
    await openMigrate(w)
    await w.find('[data-testid="migrate-confirm-check"]').setValue(true)
    ;(document.body.querySelector('[data-testid="migrate-confirm-btn"]') as HTMLElement).click()
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 50))
    await w.vm.$nextTick()
    expect(dbMocks.dbMigrateDimension).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector('[data-testid="migrate-dialog"]')).toBeTruthy()
    w.unmount()
  })

  it('4. 取消按钮关闭对话框且不调用迁移', async () => {
    const { w } = mountPanel()
    await flush(w)
    await openMigrate(w)
    expect(document.body.querySelector('[data-testid="migrate-dialog"]')).toBeTruthy()
    ;(document.body.querySelector('[data-testid="migrate-cancel"]') as HTMLElement).click()
    await w.vm.$nextTick()
    expect(document.body.querySelector('[data-testid="migrate-dialog"]')).toBeFalsy()
    expect(dbMocks.dbMigrateDimension).not.toHaveBeenCalled()
    w.unmount()
  })
})
