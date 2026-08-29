import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import BatchFactory from '../BatchFactory.vue'
import { useLibraryStore } from '@/stores/library'
import * as db from '@/lib/db'

vi.mock('@/lib/db', () => ({
  dbGetDimensions: vi.fn().mockResolvedValue([
    { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true },
  ]),
  dbGetAllModulesGrouped: vi.fn().mockResolvedValue({
    top: [
      { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: 'white shirt', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
    ],
  }),
  dbSaveAssemblyFromIr: vi.fn().mockResolvedValue('asm_1'),
  dbListRecent: vi.fn().mockResolvedValue([]),
  dbListFavorites: vi.fn().mockResolvedValue([]),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  // 清理 Once 队列，避免用例间串扰
  vi.mocked(db.dbGetDimensions).mockReset()
  vi.mocked(db.dbGetAllModulesGrouped).mockReset()
  vi.mocked(db.dbGetDimensions).mockResolvedValue([
    { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true },
  ] as unknown as Awaited<ReturnType<typeof db.dbGetDimensions>>)
  vi.mocked(db.dbGetAllModulesGrouped).mockResolvedValue({
    top: [
      { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: 'white shirt', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
    ],
  } as unknown as Awaited<ReturnType<typeof db.dbGetAllModulesGrouped>>)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllTimers()
})

describe('BatchFactory 快照锁定回归', () => {
  it('新增词条后随机可抽到（读时强制实时，不受快照过期影响）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const library = useLibraryStore()

    const grouped10 = {
      top: [
        { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: 'white shirt', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
        { id: 'm_top_2', dimensionId: 'd_top', contentEn: 'black jacket', displayName: 'black jacket', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
      ],
    }
    const grouped11 = {
      top: [
        { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: 'white shirt', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
        { id: 'm_top_2', dimensionId: 'd_top', contentEn: 'black jacket', displayName: 'black jacket', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
        { id: 'm_top_new', dimensionId: 'd_top', contentEn: 'test_new_xxx unique', displayName: 'test_new_xxx', weight: 100, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
      ],
    }

    vi.mocked(db.dbGetAllModulesGrouped).mockResolvedValueOnce(grouped10 as unknown as Awaited<ReturnType<typeof db.dbGetAllModulesGrouped>>)
    const w = mount(BatchFactory, { global: { plugins: [pinia] } })
    await vi.advanceTimersByTimeAsync(0)
    await w.vm.$nextTick()

    await w.find('[data-testid="batch-random-btn"]').trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    await w.vm.$nextTick()
    expect(library.total).toBe(2)

    vi.mocked(db.dbGetAllModulesGrouped).mockResolvedValueOnce(grouped11 as unknown as Awaited<ReturnType<typeof db.dbGetAllModulesGrouped>>)
    vi.mocked(db.dbGetDimensions).mockResolvedValueOnce([
      { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true },
    ] as unknown as Awaited<ReturnType<typeof db.dbGetDimensions>>)
    library.scheduleFetch()
    await vi.advanceTimersByTimeAsync(0)
    await w.vm.$nextTick()

    vi.mocked(db.dbGetAllModulesGrouped).mockResolvedValueOnce(grouped11 as unknown as Awaited<ReturnType<typeof db.dbGetAllModulesGrouped>>)
    vi.mocked(db.dbGetDimensions).mockResolvedValueOnce([
      { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true },
    ] as unknown as Awaited<ReturnType<typeof db.dbGetDimensions>>)

    let hit = false
    for (let i = 0; i < 5; i++) {
      await w.find('[data-testid="batch-random-btn"]').trigger('click')
      await vi.advanceTimersByTimeAsync(0)
      await w.vm.$nextTick()
      const { useBatchStore } = await import('@/stores/batch')
      const batch = useBatchStore()
      if (batch.results.some((r) => r.finalPrompt.includes('test_new_xxx'))) {
        hit = true
        break
      }
      vi.mocked(db.dbGetAllModulesGrouped).mockResolvedValueOnce(grouped11 as unknown as Awaited<ReturnType<typeof db.dbGetAllModulesGrouped>>)
      vi.mocked(db.dbGetDimensions).mockResolvedValueOnce([
        { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true },
      ] as unknown as Awaited<ReturnType<typeof db.dbGetDimensions>>)
    }
    expect(hit).toBe(true)
  })

  it('大库 >200 时写后防抖 10s 内仅一次全量拉取（store 单元）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const library = useLibraryStore()

    const bigGrouped: Record<string, unknown[]> = { top: [] }
    for (let i = 0; i < 250; i++) bigGrouped.top.push({ id: `m_${i}`, dimensionId: 'd_top', contentEn: `item ${i}`, displayName: `item ${i}`, weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' })

    // 大库首帧：确保 mock 干净后再设值，避免 Once 队列串扰
    vi.mocked(db.dbGetDimensions).mockReset()
    vi.mocked(db.dbGetAllModulesGrouped).mockReset()
    vi.mocked(db.dbGetDimensions).mockResolvedValue([{ id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true }] as unknown as Awaited<ReturnType<typeof db.dbGetDimensions>>)
    vi.mocked(db.dbGetAllModulesGrouped).mockResolvedValue(bigGrouped as unknown as Awaited<ReturnType<typeof db.dbGetAllModulesGrouped>>)

    await library.fetchAll()
    // fetchAll 为 Promise.all，需让微任务跑完；fake timers 下推进 0ms
    await vi.advanceTimersByTimeAsync(0)
    expect(library.total).toBe(250)
    expect(library.isLarge).toBe(true)

    const groupedMock = vi.mocked(db.dbGetAllModulesGrouped)
    const dimMock = vi.mocked(db.dbGetDimensions)
    groupedMock.mockClear()
    dimMock.mockClear()
    dimMock.mockResolvedValue([{ id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true }] as unknown as Awaited<ReturnType<typeof db.dbGetDimensions>>)
    groupedMock.mockResolvedValue(bigGrouped as unknown as Awaited<ReturnType<typeof db.dbGetAllModulesGrouped>>)

    for (let i = 0; i < 5; i++) library.scheduleFetch()
    expect(groupedMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(9999)
    expect(groupedMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(groupedMock).toHaveBeenCalledTimes(1)

    library.dirty = true
    groupedMock.mockClear()
    dimMock.mockClear()
    dimMock.mockResolvedValue([{ id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true }] as unknown as Awaited<ReturnType<typeof db.dbGetDimensions>>)
    groupedMock.mockResolvedValue(bigGrouped as unknown as Awaited<ReturnType<typeof db.dbGetAllModulesGrouped>>)
    await library.ensureFreshForRandom()
    expect(groupedMock).toHaveBeenCalledTimes(1)
    library.dispose()
  })
})
