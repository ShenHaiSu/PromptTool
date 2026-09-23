import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAssemblyStore } from '@/stores/assembly'

const POSE_MODS = [
  { id: 'm_pose_1', dimensionId: 'd_pose', contentEn: 'standing', displayName: '站立', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'pose' },
  { id: 'm_pose_2', dimensionId: 'd_pose', contentEn: 'sitting', displayName: '坐着', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'pose' },
]

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

async function openMenu(w: ReturnType<typeof mount>) {
  await w.find('[data-testid="dimension-header-pose"]').trigger('contextmenu', { clientX: 10, clientY: 10 })
  await w.vm.$nextTick()
}

describe('Need08 — 清空维度', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    localStorage.clear()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
    dbMocks.dbGetAllModulesGrouped.mockResolvedValue({ pose: [...POSE_MODS] })
    dbMocks.dbSoftDeleteModule.mockResolvedValue(undefined)
  })

  it('1. 空维度清空/迁移 disabled 且 title 提示', async () => {
    dbMocks.dbGetAllModulesGrouped.mockResolvedValueOnce({ pose: [] })
    const { w } = mountPanel()
    await flush(w)
    await openMenu(w)
    const clearBtn = document.body.querySelector('[data-testid="dim-ctx-clear-pose"]') as HTMLButtonElement
    const migrateBtn = document.body.querySelector('[data-testid="dim-ctx-migrate-pose"]') as HTMLButtonElement
    expect(clearBtn.disabled).toBe(true)
    expect(clearBtn.title).toContain('暂无词条')
    expect(migrateBtn.disabled).toBe(true)
    expect(migrateBtn.title).toContain('空维度无需迁移')
    // 空维度翻译项同样禁用（既有行为不受影响）
    expect((document.body.querySelector('[data-testid="dim-ctx-translate-pose"]') as HTMLButtonElement).disabled).toBe(true)
    w.unmount()
  })

  it('2. 非空点击清空打开确认框，未勾选时确认按钮 disabled', async () => {
    const { w } = mountPanel()
    await flush(w)
    await openMenu(w)
    ;(document.body.querySelector('[data-testid="dim-ctx-clear-pose"]') as HTMLElement).click()
    await w.vm.$nextTick()
    expect(document.body.querySelector('[data-testid="dim-context-menu"]')).toBeFalsy()
    const dlg = document.body.querySelector('[data-testid="clear-confirm-dialog"]') as HTMLElement
    expect(dlg).toBeTruthy()
    expect(dlg.textContent).toContain('2 条')
    const btn = document.body.querySelector('[data-testid="clear-confirm-btn"]') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    w.unmount()
  })

  it('3. 勾选后确认调 dbSoftDeleteModule N 次并关闭对话框', async () => {
    const { w } = mountPanel()
    await flush(w)
    await openMenu(w)
    ;(document.body.querySelector('[data-testid="dim-ctx-clear-pose"]') as HTMLElement).click()
    await w.vm.$nextTick()
    await w.find('[data-testid="clear-confirm-check"]').setValue(true)
    await w.vm.$nextTick()
    const btn = document.body.querySelector('[data-testid="clear-confirm-btn"]') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    btn.click()
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 50))
    await w.vm.$nextTick()
    expect(dbMocks.dbSoftDeleteModule).toHaveBeenCalledTimes(2)
    expect(dbMocks.dbSoftDeleteModule).toHaveBeenCalledWith('m_pose_1')
    expect(dbMocks.dbSoftDeleteModule).toHaveBeenCalledWith('m_pose_2')
    expect(document.body.querySelector('[data-testid="clear-confirm-dialog"]')).toBeFalsy()
    // 强刷一次（fetchAll → dbGetAllModulesGrouped 被再次调用）
    expect(dbMocks.dbGetAllModulesGrouped.mock.calls.length).toBeGreaterThan(1)
    w.unmount()
  })

  it('4. 已选项联动移除：清空后属于该维度的已选被移出', async () => {
    const { w, asm } = mountPanel()
    await flush(w)
    asm.addModule({ module: { ...POSE_MODS[0]! } as any, locked: false, weightOverride: null })
    asm.addModule({ module: { id: 'm_other', dimensionId: 'd_other', contentEn: 'other', displayName: '其他', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'other' } as any, locked: false, weightOverride: null })
    expect(asm.selectedItems.length).toBe(2)
    await openMenu(w)
    ;(document.body.querySelector('[data-testid="dim-ctx-clear-pose"]') as HTMLElement).click()
    await w.vm.$nextTick()
    await w.find('[data-testid="clear-confirm-check"]').setValue(true)
    ;(document.body.querySelector('[data-testid="clear-confirm-btn"]') as HTMLElement).click()
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 50))
    await w.vm.$nextTick()
    expect(asm.selectedItems.length).toBe(1)
    expect(asm.selectedItems[0]!.module.id).toBe('m_other')
    w.unmount()
  })

  it('5. 中途失败对话框保持打开并触发 fetchAll 对齐后端', async () => {
    dbMocks.dbSoftDeleteModule.mockRejectedValueOnce(new Error('db locked'))
    const { w } = mountPanel()
    await flush(w)
    await openMenu(w)
    ;(document.body.querySelector('[data-testid="dim-ctx-clear-pose"]') as HTMLElement).click()
    await w.vm.$nextTick()
    await w.find('[data-testid="clear-confirm-check"]').setValue(true)
    ;(document.body.querySelector('[data-testid="clear-confirm-btn"]') as HTMLElement).click()
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 50))
    await w.vm.$nextTick()
    // 失败后对话框不关闭（用户可重试），且触发 fetchAll 与后端对齐
    expect(document.body.querySelector('[data-testid="clear-confirm-dialog"]')).toBeTruthy()
    expect(dbMocks.dbGetAllModulesGrouped.mock.calls.length).toBeGreaterThan(1)
    w.unmount()
  })
})
