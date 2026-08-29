import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useAssemblyStore } from '@/stores/assembly'
import { applyRules } from '@/engine/rules'
import { sortByOrder } from '@/engine/assembly'

vi.mock('@/lib/db', () => ({
  dbSaveAssemblyFromIr: vi.fn(async () => 'aid_new'),
  dbLoadSelectedItems: vi.fn(async () => [
    { module: { id: 'mod_top_1', dimensionId: 'dim_top', contentEn: 'oversized white shirt', displayName: '宽松白衬衫', weight: 1.2, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' }, weightOverride: 1.2, locked: false },
    { module: { id: 'mod_shoes_1', dimensionId: 'dim_shoes', contentEn: 'barefoot', displayName: '赤脚', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'shoes' }, weightOverride: null, locked: false },
  ]),
  dbListRecent: vi.fn(async () => []),
  dbListFavorites: vi.fn(async () => []),
  dbListTemplates: vi.fn(async () => []),
  dbSearchAssemblies: vi.fn(async () => []),
  dbGetDimensions: vi.fn(async () => []),
  dbSearchModules: vi.fn(async () => []),
  dbSaveAssembly: vi.fn(async () => 'x'),
  dbSaveTemplate: vi.fn(async () => 't'),
  dbApplyTemplate: vi.fn(async () => [{ separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }, [], []]),
  dbToggleFavorite: vi.fn(async () => true),
  dbSoftDeleteAssembly: vi.fn(async () => {}),
  dbSoftDeleteTemplate: vi.fn(async () => {}),
  dbRenameAssembly: vi.fn(async () => {}),
}))

import BatchCard from '@/components/BatchCard.vue'
import * as db from '@/lib/db'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })
  vi.mocked(db.dbLoadSelectedItems).mockResolvedValue([
    { module: { id: 'mod_top_1', dimensionId: 'dim_top', contentEn: 'oversized white shirt', displayName: '宽松白衬衫', weight: 1.2, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' }, weightOverride: 1.2, locked: false },
    { module: { id: 'mod_shoes_1', dimensionId: 'dim_shoes', contentEn: 'barefoot', displayName: '赤脚', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'shoes' }, weightOverride: null, locked: false },
  ] as never)
})

describe('BatchFactory 收藏回填分类保留 (Need04-01)', () => {
  it('批量收藏回填后 dimensionKey 保留，规则与排序一致', async () => {
    const assembly = useAssemblyStore()
    const segs = [
      { dimensionKey: 'top', text: 'oversized white shirt', weight: 1.2, sourceModuleId: 'mod_top_1' },
      { dimensionKey: 'shoes', text: 'barefoot', weight: 1.0, sourceModuleId: 'mod_shoes_1' },
    ]
    const irLike = {
      segments: segs,
      warnings: [] as string[],
      hash: () => 'h1',
      toJSON() { return { segments: segs, warnings: [] as string[] } },
    }
    const model = {
      index: 1,
      ir: irLike as unknown as import('@/engine/models').PromptIR,
      finalPrompt: 'oversized white shirt, barefoot',
      warnings: [] as string[],
      dimKeys: ['top', 'shoes'],
      hash: 'h1',
    }

    const wrapper = mount(BatchCard, { props: { model: model as never, index: 1 } })
    await wrapper.find('[data-testid="batch-card-fav"]').trigger('click')
    await new Promise((r) => setTimeout(r, 30))

    expect(db.dbSaveAssemblyFromIr).toHaveBeenCalled()
    const calls = (db.dbSaveAssemblyFromIr as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const irJson = calls[0]![0] as string
    const parsed = JSON.parse(irJson) as { segments: { dimensionKey: string; sourceModuleId: string }[] }
    expect(parsed.segments.every((s) => s.dimensionKey?.trim() !== '')).toBe(true)
    expect(parsed.segments[0]!.dimensionKey).toBe('top')
    expect(parsed.segments[0]!.sourceModuleId).toBe('mod_top_1')

    const items = await (db.dbLoadSelectedItems as unknown as (id: string) => Promise<import('@/engine/models').SelectedItem[]>)('aid_new')
    assembly.setItems(items)
    expect(assembly.selectedItems.every((it) => (it.module.dimensionKey ?? '').trim() !== '')).toBe(true)
    expect(new Set(assembly.selectedItems.map((it) => it.module.dimensionKey)).size).toBe(2)

    const ordered = sortByOrder(assembly.selectedItems, 'dimensionOrder')
    expect(ordered[0]!.module.dimensionKey).toBeTruthy()

    const [kept] = applyRules(assembly.selectedItems)
    expect(kept.length).toBeGreaterThanOrEqual(1)

    wrapper.unmount()
  })

  it('已删词条占位仍保留 dimensionKey', async () => {
    vi.mocked(db.dbLoadSelectedItems).mockResolvedValueOnce([
      { module: { id: 'mod_bg_1', dimensionId: '', contentEn: 'studio backdrop', displayName: '[已失效] studio backdrop', weight: 1, isEnabled: false, isNsfw: false, usageCount: 0, dimensionKey: 'background' }, weightOverride: null, locked: false },
    ] as never)
    const assembly = useAssemblyStore()
    const items = await (db.dbLoadSelectedItems as unknown as (id: string) => Promise<import('@/engine/models').SelectedItem[]>)('aid_old')
    assembly.setItems(items)
    expect(assembly.selectedItems[0]!.module.dimensionKey).toBe('background')
    expect(assembly.selectedItems[0]!.module.displayName.startsWith('[已失效]')).toBe(true)
  })
})
