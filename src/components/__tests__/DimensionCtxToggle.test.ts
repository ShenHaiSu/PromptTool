import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const dbMocks = vi.hoisted(() => ({
  dbGetDimensions: vi.fn().mockResolvedValue([
    { id: 'd_pose', key: 'pose', nameCn: '姿态', nameEn: 'Pose', sortOrder: 1, isMultiSelect: true, isEnabled: true, icon: null },
    { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 2, isMultiSelect: false, isEnabled: true, icon: null },
  ]),
  dbGetAllModulesGrouped: vi.fn().mockResolvedValue({
    pose: [
      { id: 'm_pose_1', dimensionId: 'd_pose', contentEn: 'standing', displayName: '站立', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'pose' },
    ],
    top: [
      { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: '白衬衫', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
    ],
  }),
  dbCreateDimension: vi.fn().mockResolvedValue({ id: 'd_new', key: 'new_dim', nameCn: '新维度', nameEn: 'New', sortOrder: 0, isMultiSelect: false, isEnabled: true }),
  dbUpdateDimension: vi.fn().mockResolvedValue(undefined),
  dbCreateModule: vi.fn().mockResolvedValue({ id: 'm_new', dimensionId: 'd_pose', contentEn: 'new', displayName: '新', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0 }),
  dbUpdateModule: vi.fn().mockResolvedValue(undefined),
  dbSoftDeleteModule: vi.fn().mockResolvedValue(undefined),
  dbMigrateDimension: vi.fn().mockResolvedValue({
    archive: { id: 'd_pose', key: 'pose_bak_abc123', nameCn: '姿态（归档）', nameEn: 'Pose', sortOrder: 9, isMultiSelect: true, isEnabled: true, icon: null },
    fresh: { id: 'd_fresh', key: 'pose', nameCn: '姿态', nameEn: 'Pose', sortOrder: 1, isMultiSelect: true, isEnabled: true, icon: null },
    moved: 1,
  }),
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
  return mount(DimensionPanel, { global: { plugins: [pinia] }, attachTo: document.body })
}

describe('Need08 — 右键菜单开关项', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    localStorage.clear()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
    dbMocks.dbGetDimensions.mockResolvedValue([
      { id: 'd_pose', key: 'pose', nameCn: '姿态', nameEn: 'Pose', sortOrder: 1, isMultiSelect: true, isEnabled: true, icon: null },
      { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 2, isMultiSelect: false, isEnabled: true, icon: null },
    ])
  })

  it('1. 菜单为 7 项两线，开关项在生成之后、清空之前', async () => {
    const w = mountPanel()
    await flush(w)
    await w.find('[data-testid="dimension-header-pose"]').trigger('contextmenu', { clientX: 100, clientY: 100 })
    await w.vm.$nextTick()
    const menu = document.body.querySelector('[data-testid="dim-context-menu"]') as HTMLElement
    expect(menu).toBeTruthy()
    const order = [...menu.querySelectorAll('button')].map((b) => b.getAttribute('data-testid'))
    expect(order).toEqual([
      'dim-ctx-translate-pose',
      'dim-ctx-generate-pose',
      'dim-ctx-toggle-pose',
      'dim-ctx-clear-pose',
      'dim-ctx-migrate-pose',
      'dim-ctx-copy-key-pose',
      'dim-ctx-copy-name-pose',
    ])
    expect(menu.querySelectorAll('div.my-1').length).toBe(2)
    // 去 Emoji：生成项精确文本
    expect(menu.querySelector('[data-testid="dim-ctx-generate-pose"]')?.textContent).toBe('片段批量生成')
    w.unmount()
  })

  it('2. 启用态文案“禁用维度”，禁用维度文案“启用维度”', async () => {
    dbMocks.dbGetDimensions.mockResolvedValueOnce([
      { id: 'd_pose', key: 'pose', nameCn: '姿态', nameEn: 'Pose', sortOrder: 1, isMultiSelect: true, isEnabled: false, icon: null },
    ])
    const w = mountPanel()
    await flush(w)
    await w.find('[data-testid="dimension-header-pose"]').trigger('contextmenu', { clientX: 10, clientY: 10 })
    await w.vm.$nextTick()
    const btn = document.body.querySelector('[data-testid="dim-ctx-toggle-pose"]') as HTMLElement
    expect(btn.textContent).toBe('启用维度')
    expect(btn.getAttribute('title')).toContain('启用后恢复参与可控随机')
    w.unmount()
  })

  it('3. 点击开关项关闭菜单并调用 dbUpdateDimension 翻转 isEnabled', async () => {
    const w = mountPanel()
    await flush(w)
    await w.find('[data-testid="dimension-header-pose"]').trigger('contextmenu', { clientX: 10, clientY: 10 })
    await w.vm.$nextTick()
    const btn = document.body.querySelector('[data-testid="dim-ctx-toggle-pose"]') as HTMLElement
    expect(btn.textContent).toBe('禁用维度')
    btn.click()
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 30))
    expect(document.body.querySelector('[data-testid="dim-context-menu"]')).toBeFalsy()
    expect(dbMocks.dbUpdateDimension).toHaveBeenCalledTimes(1)
    const arg = dbMocks.dbUpdateDimension.mock.calls[0]![0] as any
    expect(arg.id).toBe('d_pose')
    expect(arg.isEnabled).toBe(false)
    w.unmount()
  })
})
