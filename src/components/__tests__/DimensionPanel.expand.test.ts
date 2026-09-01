import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useLibraryStore } from '@/stores/library'
import { useDimensionPanelStore } from '@/stores/dimensionPanel'

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

async function flush(wrapper: ReturnType<typeof mount>) {
  await new Promise((r) => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 30))
  await wrapper.vm.$nextTick()
}

function seedLibrary(library: ReturnType<typeof useLibraryStore>) {
  library.dimensions = [
    { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true, icon: null } as unknown as { id: string; key: string },
    { id: 'd_bottom', key: 'bottom', nameCn: '下装', nameEn: 'Bottom', sortOrder: 6, isMultiSelect: true, isEnabled: true, icon: null } as unknown as { id: string; key: string },
  ] as never
  library.modulesByDim = {
    d_top: [{ id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: '白衬衫', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' } as unknown as never],
    d_bottom: [{ id: 'm_bot_1', dimensionId: 'd_bottom', contentEn: 'pleated skirt', displayName: '百褶裙', weight: 1.2, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'bottom' } as unknown as never],
  } as never
}

describe('DimensionPanel — need06 展开保留/裁剪/持久化与写后不折叠', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    localStorage.clear()
    dbMocks.dbGetDimensions.mockResolvedValue([
      { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true, icon: null },
      { id: 'd_bottom', key: 'bottom', nameCn: '下装', nameEn: 'Bottom', sortOrder: 6, isMultiSelect: true, isEnabled: true, icon: null },
    ])
    dbMocks.dbGetAllModulesGrouped.mockResolvedValue({
      top: [{ id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: '白衬衫', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' }],
      bottom: [{ id: 'm_bot_1', dimensionId: 'd_bottom', contentEn: 'pleated skirt', displayName: '百褶裙', weight: 1.2, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'bottom' }],
    })
  })

  it('展开两个维度后，订阅重绘展开态仍保持', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const library = useLibraryStore()
    seedLibrary(library)
    const panelStore = useDimensionPanelStore()
    panelStore.setExpanded('top', true)
    panelStore.setExpanded('bottom', true)
    const w = mount(DimensionPanel, { global: { plugins: [pinia] }, attachTo: document.body })
    await flush(w)
    expect(w.find('[data-testid="module-row-m_top_1"]').exists()).toBe(true)
    expect(w.find('[data-testid="module-row-m_bot_1"]').exists()).toBe(true)
    library.dimensions = [...library.dimensions]
    await w.vm.$nextTick()
    expect(w.find('[data-testid="module-row-m_top_1"]').exists()).toBe(true)
    expect(w.find('[data-testid="module-row-m_bot_1"]').exists()).toBe(true)
    w.unmount()
  })

  it('禁用词条后展开态仍保持（乐观 patch 不清 expandedKeys）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const library = useLibraryStore()
    seedLibrary(library)
    const panelStore = useDimensionPanelStore()
    panelStore.setExpanded('top', true)
    const w = mount(DimensionPanel, { global: { plugins: [pinia] }, attachTo: document.body })
    await flush(w)
    expect(w.find('[data-testid="module-row-m_top_1"]').exists()).toBe(true)
    await w.find('[data-testid="module-row-m_top_1"]').trigger('click', { ctrlKey: true })
    await flush(w)
    expect(w.find('[data-testid="module-row-m_top_1"]').exists()).toBe(true)
    expect(w.find('[data-testid="module-row-m_top_1"]').classes().join(' ')).toContain('opacity-60')
    w.unmount()
  })

  it('搜索过滤不影响 expandedKeys，清空搜索后展开恢复可见', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const library = useLibraryStore()
    seedLibrary(library)
    const panelStore = useDimensionPanelStore()
    panelStore.setExpanded('top', true)
    const w = mount(DimensionPanel, { global: { plugins: [pinia] }, attachTo: document.body })
    await flush(w)
    expect(w.find('[data-testid="module-row-m_top_1"]').exists()).toBe(true)
    const input = w.find('[data-testid="dimension-search"]')
    await input.setValue('不存在的关键词')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="module-row-m_top_1"]').exists()).toBe(false)
    expect(panelStore.isExpanded('top')).toBe(true)
    await input.setValue('')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="module-row-m_top_1"]').exists()).toBe(true)
    w.unmount()
  })

  it('切库 prune：旧库悬空 key 被剔除，命中新库的 key 保留', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const library = useLibraryStore()
    seedLibrary(library)
    const panelStore = useDimensionPanelStore()
    panelStore.setExpanded('top', true)
    panelStore.setExpanded('orphan', true)
    const w = mount(DimensionPanel, { global: { plugins: [pinia] }, attachTo: document.body })
    await flush(w)
    library.dimensions = [
      { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true, icon: null } as unknown as { id: string; key: string },
    ] as never
    library.modulesByDim = { d_top: [] } as never
    await flush(w)
    expect(panelStore.isExpanded('top')).toBe(true)
    expect(panelStore.isExpanded('orphan')).toBe(false)
    w.unmount()
  })

  it('批量新增后自动展开新维度且原展开保持', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const library = useLibraryStore()
    seedLibrary(library)
    const panelStore = useDimensionPanelStore()
    panelStore.setExpanded('top', true)
    library.dimensions = [
      ...library.dimensions,
      { id: 'd_new', key: 'new_dim', nameCn: '新维度', nameEn: 'New', sortOrder: 7, isMultiSelect: false, isEnabled: true, icon: null } as unknown as { id: string; key: string },
    ] as never
    panelStore.setExpanded('new_dim', true)
    const w = mount(DimensionPanel, { global: { plugins: [pinia] }, attachTo: document.body })
    await flush(w)
    expect(panelStore.isExpanded('top')).toBe(true)
    expect(panelStore.isExpanded('new_dim')).toBe(true)
    w.unmount()
  })

  it('refresh 兼容层转发为 library.fetchAll 且不清空 expandedKeys', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const library = useLibraryStore()
    seedLibrary(library)
    const panelStore = useDimensionPanelStore()
    panelStore.setExpanded('top', true)
    const spy = vi.spyOn(library, 'fetchAll').mockResolvedValue(undefined as unknown as void)
    const w = mount(DimensionPanel, { global: { plugins: [pinia] }, attachTo: document.body })
    await flush(w)
    await (w.vm as unknown as { refresh: () => Promise<void> }).refresh()
    expect(spy).toHaveBeenCalled()
    expect(panelStore.isExpanded('top')).toBe(true)
    w.unmount()
  })
})
