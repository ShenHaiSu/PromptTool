import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useAssemblyStore } from '@/stores/assembly'
import { applyRules } from '@/engine/rules'
import HistoryPanel from '@/components/HistoryPanel.vue'

vi.mock('@/lib/db', () => ({
  dbListRecent: vi.fn(async () => []),
  dbListFavorites: vi.fn(async () => []),
  dbListTemplates: vi.fn(async () => [{ id: 't1', name: 'T1', description: null, configJson: '{}', coverPrompt: 'cover', createdAt: 1 }]),
  dbSaveTemplate: vi.fn(async () => 'tid_new'),
  dbApplyTemplate: vi.fn(async () => [
    { separator: ' BREAK ', useWeightBrackets: false, modelProfile: 'mj', sortBy: 'customDragOrder' },
    ['top', 'shoes'],
    [{ module: { id: 'm1', dimensionId: 'd1', contentEn: 'white shirt', displayName: '白衬衫', weight: 1.2, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' }, weightOverride: 1.2, locked: false }],
  ]),
  dbLoadSelectedItems: vi.fn(async () => []),
  dbToggleFavorite: vi.fn(async () => true),
  dbRenameAssembly: vi.fn(async () => {}),
  dbSoftDeleteAssembly: vi.fn(async () => {}),
  dbSoftDeleteTemplate: vi.fn(async () => {}),
  dbSaveAssembly: vi.fn(async () => 'aid'),
  dbSearchAssemblies: vi.fn(async () => []),
  dbSearchModules: vi.fn(async () => []),
  dbGetDimensions: vi.fn(async () => []),
}))

import * as db from '@/lib/db'

const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  confirmSpy.mockReturnValue(true)
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })
  vi.mocked(db.dbApplyTemplate).mockResolvedValue([
    { separator: ' BREAK ', useWeightBrackets: false, modelProfile: 'mj', sortBy: 'customDragOrder' },
    ['top', 'shoes'],
    [{ module: { id: 'm1', dimensionId: 'd1', contentEn: 'white shirt', displayName: '白衬衫', weight: 1.2, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' }, weightOverride: 1.2, locked: false }],
  ] as never)
  vi.mocked(db.dbLoadSelectedItems).mockResolvedValue([] as never)
})

describe('HistoryPanel 模板应用回写 (Need04-02)', () => {
  it('应用模板回写 config + selectedItems 并 reassemble，且 dimensionKey 非空', async () => {
    const assembly = useAssemblyStore()
    const wrapper = mount(HistoryPanel)
    await new Promise((r) => setTimeout(r, 80))
    await wrapper.find('[data-testid="templates-tab"]').trigger('click')
    await wrapper.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 30))
    const tItem = wrapper.find('[data-template-id="t1"]')
    expect(tItem.exists()).toBe(true)
    await tItem.trigger('dblclick')
    await new Promise((r) => setTimeout(r, 80))
    expect(assembly.config.separator).toBe(' BREAK ')
    expect(assembly.selectedItems).toHaveLength(1)
    expect(assembly.selectedItems[0]!.module.dimensionKey).toBe('top')
    expect(assembly.selectedItems.every((it) => (it.module.dimensionKey ?? '').trim() !== '')).toBe(true)
    expect(applyRules(assembly.selectedItems as unknown as import('@/engine/models').SelectedItem[])[0].length).toBeGreaterThanOrEqual(1)
    wrapper.unmount()
  })

  it('老模板无 template_items 时直接报错，不回写', async () => {
    const assembly = useAssemblyStore()
    vi.mocked(db.dbApplyTemplate).mockRejectedValueOnce(new Error('模板不含明细，请重建'))
    const wrapper = mount(HistoryPanel)
    await new Promise((r) => setTimeout(r, 80))
    await wrapper.find('[data-testid="templates-tab"]').trigger('click')
    await wrapper.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 30))
    const tItem = wrapper.find('[data-template-id="t1"]')
    await tItem.trigger('dblclick')
    await new Promise((r) => setTimeout(r, 80))
    expect(assembly.selectedItems).toHaveLength(0)
    wrapper.unmount()
  })

  it('模板回填分类集合与存前一致', async () => {
    const savedKeys = ['top', 'shoes', 'background']
    vi.mocked(db.dbApplyTemplate).mockResolvedValueOnce([
      { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' },
      savedKeys,
      savedKeys.map((k) => ({ module: { id: `m_${k}`, dimensionId: `d_${k}`, contentEn: `${k} content`, displayName: k, weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: k }, weightOverride: null, locked: false })),
    ] as never)
    const assembly = useAssemblyStore()
    const wrapper = mount(HistoryPanel)
    await new Promise((r) => setTimeout(r, 80))
    await wrapper.find('[data-testid="templates-tab"]').trigger('click')
    await wrapper.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 30))
    await wrapper.find('[data-template-id="t1"]').trigger('dblclick')
    await new Promise((r) => setTimeout(r, 80))
    expect(new Set(assembly.selectedItems.map((it) => it.module.dimensionKey))).toEqual(new Set(savedKeys))
    wrapper.unmount()
  })
})
