import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAssemblyStore } from '@/stores/assembly'
import type { Module } from '@/engine/models'

const dbMocks = vi.hoisted(() => ({
  dbGetDimensions: vi.fn().mockResolvedValue([
    { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true, icon: null },
    { id: 'd_bottom', key: 'bottom', nameCn: '下装', nameEn: 'Bottom', sortOrder: 6, isMultiSelect: true, isEnabled: true, icon: null },
  ]),
  dbGetAllModulesGrouped: vi.fn().mockResolvedValue({
    top: [
      { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: '白衬衫', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
    ],
    bottom: [
      { id: 'm_bot_1', dimensionId: 'd_bottom', contentEn: 'pleated skirt', displayName: '百褶裙', weight: 1.2, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'bottom' },
    ],
  }),
  dbCreateDimension: vi.fn().mockResolvedValue({ id: 'd_new', key: 'new_dim', nameCn: '新维度', nameEn: 'New', sortOrder: 0, isMultiSelect: false, isEnabled: true }),
  dbUpdateDimension: vi.fn().mockResolvedValue(undefined),
  dbCreateModule: vi.fn().mockResolvedValue({ id: 'm_new', dimensionId: 'd_top', contentEn: 'new prompt', displayName: '新词条', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0 }),
  dbUpdateModule: vi.fn().mockResolvedValue(undefined),
  dbSoftDeleteModule: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/db', () => dbMocks)
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))

import DimensionPanel from '../DimensionPanel.vue'

function mod(id: string, key: string, text: string, weight = 1): Module {
  return { id, dimensionId: 'd_' + key, contentEn: text, displayName: text, weight, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: key } as Module
}

function createWrapper(pinia?: ReturnType<typeof createPinia>) {
  const p = pinia ?? createPinia()
  setActivePinia(p)
  return mount(DimensionPanel, { global: { plugins: [p] } })
}

async function flush(wrapper: ReturnType<typeof mount>) {
  await new Promise((r) => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 30))
  await wrapper.vm.$nextTick()
}

describe('DimensionPanel — need04 双模 + 已选卡片 + 预览', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
    if (!URL.createObjectURL) Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), configurable: true })
    if (!URL.revokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
    dbMocks.dbGetDimensions.mockResolvedValue([
      { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true, icon: null },
    ])
    dbMocks.dbGetAllModulesGrouped.mockResolvedValue({
      top: [
        { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: '白衬衫', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
      ],
    })
  })

  it('标题栏预览触发器与双模切换存在', async () => {
    const w = createWrapper()
    await flush(w)
    expect(w.find('[data-testid="preview-trigger"]').exists()).toBe(true)
    expect(w.find('[data-testid="dim-mode-browse"]').exists()).toBe(true)
    expect(w.find('[data-testid="dim-mode-selected"]').exists()).toBe(true)
    expect(w.find('[data-testid="preview-trigger"]').text()).toContain('预览')
  })

  it('dim-mode 切换与 localStorage pmf:dimPanelMode 持久化', async () => {
    const w = createWrapper()
    await flush(w)
    expect(localStorage.getItem('pmf:dimPanelMode')).toBeFalsy()
    await w.find('[data-testid="dim-mode-selected"]').trigger('click')
    await w.vm.$nextTick()
    expect(localStorage.getItem('pmf:dimPanelMode')).toBe('selected')
    await w.find('[data-testid="dim-mode-browse"]').trigger('click')
    await w.vm.$nextTick()
    expect(localStorage.getItem('pmf:dimPanelMode')).toBe('browse')
  })

  it('已选空态 selected-empty 与已选卡片渲染', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAssemblyStore()
    const w = mount(DimensionPanel, { global: { plugins: [pinia] } })
    await flush(w)
    await w.find('[data-testid="dim-mode-selected"]').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="selected-empty"]').exists()).toBe(true)
    store.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    await w.vm.$nextTick()
    // 需等待 computed 刷新
    await flush(w)
    // 重新切回 selected 后仍可见
    // 再次查询卡片
    expect(w.find('[data-testid="selected-card"]').exists()).toBe(true)
    expect(w.find('[data-testid="selected-empty"]').exists()).toBe(false)
  })

  it('权重 selected-weight-btn → popover → confirm 后 assembly 生效', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAssemblyStore()
    store.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    const w = mount(DimensionPanel, { global: { plugins: [pinia] } })
    await flush(w)
    await w.find('[data-testid="dim-mode-selected"]').trigger('click')
    await w.vm.$nextTick()
    const btn = w.find('[data-testid="selected-weight-btn"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('w1.0')
    await btn.trigger('click')
    expect(document.body.querySelector('[data-testid="selected-weight-popover"]')).not.toBeNull()
    const slider = document.body.querySelector('[data-testid="weight-slider"]') as HTMLInputElement
    expect(slider).not.toBeNull()
    slider.value = '1.4'
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    await w.vm.$nextTick()
    ;(document.body.querySelector('[data-testid="weight-confirm"]') as HTMLElement).click()
    await w.vm.$nextTick()
    expect(store.selectedItems[0]!.weightOverride).toBe(1.4)
    expect(document.body.querySelector('[data-testid="selected-weight-popover"]')).toBeNull()
  })

  it('锁定/移除 同步 assembly', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAssemblyStore()
    store.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    const w = mount(DimensionPanel, { global: { plugins: [pinia] } })
    await flush(w)
    await w.find('[data-testid="dim-mode-selected"]').trigger('click')
    await w.vm.$nextTick()
    await w.find('[data-testid="selected-lock-btn"]').trigger('click')
    expect(store.selectedItems[0]!.locked).toBe(true)
    await w.find('[data-testid="selected-remove-btn"]').trigger('click')
    expect(store.selectedItems).toHaveLength(0)
  })

  it('拖拽容器 selected-draggable 存在', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAssemblyStore()
    store.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    const w = mount(DimensionPanel, { global: { plugins: [pinia] } })
    await flush(w)
    await w.find('[data-testid="dim-mode-selected"]').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="selected-draggable"]').exists()).toBe(true)
    expect(w.find('[data-testid="selected-card"]').exists()).toBe(true)
  })

  it('selected-clear-btn 二次确认后 assembly.clear', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAssemblyStore()
    store.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    const w = mount(DimensionPanel, { global: { plugins: [pinia] } })
    await flush(w)
    await w.find('[data-testid="dim-mode-selected"]').trigger('click')
    await w.vm.$nextTick()
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await w.find('[data-testid="selected-clear-btn"]').trigger('click')
    expect(store.selectedItems).toHaveLength(0)
    spy.mockRestore()
  })

  it('preview-trigger 点击打开 preview-dialog', async () => {
    const w = createWrapper()
    await flush(w)
    expect(w.find('[data-testid="preview-dialog"]').exists()).toBe(false)
    await w.find('[data-testid="preview-trigger"]').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="preview-dialog"]').exists()).toBe(true)
    expect(w.find('[data-testid="preview-dialog-overlay"]').exists()).toBe(true)
  })

  it('关键词过滤 filteredSelected', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAssemblyStore()
    store.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    store.addModule({ module: mod('m2', 'bottom', 'pleated skirt'), locked: false })
    const w = mount(DimensionPanel, { global: { plugins: [pinia] } })
    await flush(w)
    await w.find('[data-testid="dim-mode-selected"]').trigger('click')
    await w.vm.$nextTick()
    expect(w.findAll('[data-testid="selected-card"]')).toHaveLength(2)
    const input = w.find('[data-testid="dimension-search"]')
    await input.setValue('white')
    await w.vm.$nextTick()
    expect(w.findAll('[data-testid="selected-card"]')).toHaveLength(1)
    await input.setValue('')
    await w.vm.$nextTick()
    expect(w.findAll('[data-testid="selected-card"]')).toHaveLength(2)
  })
})
