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
      { id: 'm_top_2', dimensionId: 'd_top', contentEn: 'black jacket', displayName: '黑夹克', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
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

async function flush(wrapper: ReturnType<typeof mount>) {
  await new Promise((r) => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 30))
  await wrapper.vm.$nextTick()
}

describe('DimensionPanel — need05 禁用能力 (Ctrl+Click)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    localStorage.clear()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
    dbMocks.dbGetDimensions.mockResolvedValue([
      { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true, icon: null },
      { id: 'd_bottom', key: 'bottom', nameCn: '下装', nameEn: 'Bottom', sortOrder: 6, isMultiSelect: true, isEnabled: true, icon: null },
    ])
    dbMocks.dbGetAllModulesGrouped.mockResolvedValue({
      top: [
        { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: '白衬衫', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
        { id: 'm_top_2', dimensionId: 'd_top', contentEn: 'black jacket', displayName: '黑夹克', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
      ],
      bottom: [
        { id: 'm_bot_1', dimensionId: 'd_bottom', contentEn: 'pleated skirt', displayName: '百褶裙', weight: 1.2, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'bottom' },
      ],
    })
  })

  it('维度头 Ctrl+点击直接禁用，title 提示 Ctrl+点击可启用/禁用', async () => {
    const w = mount(DimensionPanel, { global: { plugins: [createPinia()] }, attachTo: document.body })
    await flush(w)
    const header = w.find('[data-testid="dimension-header-top"]')
    expect(header.exists()).toBe(true)
    expect(header.attributes('title')).toContain('Ctrl+点击')
    await header.trigger('click', { ctrlKey: true })
    await flush(w)
    expect(dbMocks.dbUpdateDimension).toHaveBeenCalledWith(expect.objectContaining({ isEnabled: false }))
    w.unmount()
  })

  it('Ctrl+点击禁用维度后 dbUpdateDimension(isEnabled:false) 且 header 置灰', async () => {
    const w = mount(DimensionPanel, { global: { plugins: [createPinia()] }, attachTo: document.body })
    await flush(w)
    await w.find('[data-testid="dimension-header-top"]').trigger('click', { ctrlKey: true })
    await flush(w)
    expect(dbMocks.dbUpdateDimension).toHaveBeenCalledWith(expect.objectContaining({ isEnabled: false }))
    const header = w.find('[data-testid="dimension-header-top"]')
    expect(header.classes().join(' ')).toContain('opacity-60')
    expect(header.attributes('title')).toContain('Ctrl+点击可启用')
    w.unmount()
  })

  it('词条行 Ctrl+点击直接禁用，未选中词条禁用后置灰', async () => {
    const w = mount(DimensionPanel, { global: { plugins: [createPinia()] }, attachTo: document.body })
    await flush(w)
    await w.find('[data-testid="dimension-header-top"]').trigger('click')
    await w.vm.$nextTick()
    const row = w.find('[data-testid="module-row-m_top_1"]')
    expect(row.exists()).toBe(true)
    expect(row.attributes('title')).toContain('Ctrl+点击')
    await row.trigger('click', { ctrlKey: true })
    await flush(w)
    expect(dbMocks.dbUpdateModule).toHaveBeenCalledWith(expect.objectContaining({ isEnabled: false }))
    w.unmount()
  })

  it('已选中词条 Ctrl+禁用：先 removeModule 再 dbUpdateModule，且不可再添加', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAssemblyStore()
    store.addModule({ module: mod('m_top_1', 'top', 'white shirt'), locked: false })
    const w = mount(DimensionPanel, { global: { plugins: [pinia] }, attachTo: document.body })
    await flush(w)
    await w.find('[data-testid="dimension-header-top"]').trigger('click')
    await w.vm.$nextTick()
    expect(store.selectedItems).toHaveLength(1)
    const row = w.find('[data-testid="module-row-m_top_1"]')
    const removeSpy = vi.spyOn(store, 'removeModule')
    await row.trigger('click', { ctrlKey: true })
    await flush(w)
    expect(removeSpy).toHaveBeenCalledWith('m_top_1')
    expect(dbMocks.dbUpdateModule).toHaveBeenCalled()
    expect(store.selectedItems).toHaveLength(0)
    const row2 = w.find('[data-testid="module-row-m_top_1"]')
    await row2.trigger('click')
    await w.vm.$nextTick()
    expect(store.selectedItems).toHaveLength(0)
    w.unmount()
  })

  it('已选卡片 Ctrl+点击禁用并移出已选', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAssemblyStore()
    store.addModule({ module: mod('m_top_1', 'top', 'white shirt'), locked: false })
    const w = mount(DimensionPanel, { global: { plugins: [pinia] }, attachTo: document.body })
    await flush(w)
    await w.find('[data-testid="dim-mode-selected"]').trigger('click')
    await w.vm.$nextTick()
    const card = w.find('[data-testid="selected-card"]')
    expect(card.exists()).toBe(true)
    expect(card.attributes('title')).toContain('Ctrl+点击')
    await card.trigger('click', { ctrlKey: true })
    await flush(w)
    expect(store.selectedItems).toHaveLength(0)
    expect(dbMocks.dbUpdateModule).toHaveBeenCalledWith(expect.objectContaining({ isEnabled: false }))
    w.unmount()
  })

  it('已选卡片普通点击不触发禁用（仅 Ctrl+点击生效）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAssemblyStore()
    store.addModule({ module: mod('m_top_1', 'top', 'white shirt'), locked: false })
    const w = mount(DimensionPanel, { global: { plugins: [pinia] }, attachTo: document.body })
    await flush(w)
    await w.find('[data-testid="dim-mode-selected"]').trigger('click')
    await w.vm.$nextTick()
    await w.find('[data-testid="selected-card"]').trigger('click')
    await flush(w)
    expect(store.selectedItems).toHaveLength(1)
    expect(dbMocks.dbUpdateModule).not.toHaveBeenCalled()
    w.unmount()
  })

  it('禁用词条不可再添加，已禁用行 opacity-60', async () => {
    const w = mount(DimensionPanel, { global: { plugins: [createPinia()] }, attachTo: document.body })
    dbMocks.dbGetAllModulesGrouped.mockResolvedValue({
      top: [
        { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: '白衬衫', weight: 1, isEnabled: false, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
      ],
    })
    dbMocks.dbGetDimensions.mockResolvedValue([
      { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true, icon: null },
    ])
    await flush(w)
    w.unmount()
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAssemblyStore()
    const w2 = mount(DimensionPanel, { global: { plugins: [pinia] }, attachTo: document.body })
    await flush(w2)
    await w2.find('[data-testid="dimension-header-top"]').trigger('click')
    await w2.vm.$nextTick()
    const row = w2.find('[data-testid="module-row-m_top_1"]')
    expect(row.exists()).toBe(true)
    expect(row.classes().join(' ')).toContain('opacity-60')
    await row.trigger('click')
    await w2.vm.$nextTick()
    expect(store.selectedItems).toHaveLength(0)
    w2.unmount()
  })

  it('普通点击维度头展开/折叠，Ctrl+点击不触发展开仅切换禁用', async () => {
    const w = mount(DimensionPanel, { global: { plugins: [createPinia()] }, attachTo: document.body })
    await flush(w)
    const header = w.find('[data-testid="dimension-header-top"]')
    expect(w.find('[data-testid="module-row-m_top_1"]').exists()).toBe(false)
    await header.trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="module-row-m_top_1"]').exists()).toBe(true)
    await header.trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="module-row-m_top_1"]').exists()).toBe(false)
    await header.trigger('click', { ctrlKey: true })
    await flush(w)
    expect(dbMocks.dbUpdateDimension).toHaveBeenCalled()
    w.unmount()
  })

  it('禁用后再次 Ctrl+点击文案变为启用，点击后恢复', async () => {
    const w = mount(DimensionPanel, { global: { plugins: [createPinia()] }, attachTo: document.body })
    await flush(w)
    await w.find('[data-testid="dimension-header-top"]').trigger('click', { ctrlKey: true })
    await flush(w)
    expect(w.find('[data-testid="dimension-header-top"]').attributes('title')).toContain('Ctrl+点击可启用')
    await w.find('[data-testid="dimension-header-top"]').trigger('click', { ctrlKey: true })
    await flush(w)
    expect(dbMocks.dbUpdateDimension).toHaveBeenLastCalledWith(expect.objectContaining({ isEnabled: true }))
    w.unmount()
  })

  it('Cmd+点击（metaKey）在 Mac 上同样生效', async () => {
    const w = mount(DimensionPanel, { global: { plugins: [createPinia()] }, attachTo: document.body })
    await flush(w)
    await w.find('[data-testid="dimension-header-top"]').trigger('click', { metaKey: true })
    await flush(w)
    expect(dbMocks.dbUpdateDimension).toHaveBeenCalledWith(expect.objectContaining({ isEnabled: false }))
    w.unmount()
  })
})
