import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { useDimensionPanelStore } from '@/stores/dimensionPanel'

const dbMocks = vi.hoisted(() => ({
  dbGetDimensions: vi.fn(),
  dbGetAllModulesGrouped: vi.fn(),
  dbCreateDimension: vi.fn(),
  dbUpdateDimension: vi.fn(),
  dbCreateModule: vi.fn(),
  dbUpdateModule: vi.fn(),
  dbSoftDeleteModule: vi.fn(),
  dbClearDimension: vi.fn(),
  dbMigrateDimension: vi.fn(),
}))

vi.mock('@/lib/db', () => dbMocks)
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))

import DimensionPanel from '../DimensionPanel.vue'

const DIMS = [
  { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true, icon: null },
  { id: 'd_bottom', key: 'bottom', nameCn: '下装', nameEn: 'Bottom', sortOrder: 6, isMultiSelect: true, isEnabled: true, icon: null },
]
const GROUPED = {
  top: [
    { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: '白衬衫', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
    { id: 'm_top_2', dimensionId: 'd_top', contentEn: 'black shirt', displayName: '黑衬衫', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
  ],
  bottom: [
    { id: 'm_bot_1', dimensionId: 'd_bottom', contentEn: 'pleated skirt', displayName: '百褶裙', weight: 1.2, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'bottom' },
  ],
}

async function flush(wrapper: ReturnType<typeof mount>) {
  await new Promise((r) => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 30))
  await wrapper.vm.$nextTick()
}

function seed(library: ReturnType<typeof useLibraryStore>) {
  library.dimensions = JSON.parse(JSON.stringify(DIMS)) as never
  library.modulesByDim = JSON.parse(JSON.stringify(GROUPED)) as never
}

describe('维度面板滚动保持 — ①③④ 验收', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    localStorage.clear()
    setActivePinia(createPinia())
    dbMocks.dbGetDimensions.mockResolvedValue(JSON.parse(JSON.stringify(DIMS)))
    dbMocks.dbGetAllModulesGrouped.mockResolvedValue(JSON.parse(JSON.stringify(GROUPED)))
    dbMocks.dbUpdateDimension.mockResolvedValue(undefined)
    dbMocks.dbUpdateModule.mockResolvedValue(undefined)
  })

  it('① loading 期间列表不被卸载（点击随机 → fetchAll → scrollTop 归零的根因）', async () => {
    const library = useLibraryStore()
    seed(library)
    const w = mount(DimensionPanel)
    await flush(w)

    expect(w.find('[data-testid="dimension-group"]').exists()).toBe(true)
    const before = w.findAll('[data-testid="dimension-group"]').length

    // 点击随机：library.loading 翻转（面板拿到 :loading）
    library.loading = true
    await w.vm.$nextTick()

    // 关键断言：列表 DOM 仍在（不再被 v-if 卸载），且出现非阻塞的同步提示
    expect(w.findAll('[data-testid="dimension-group"]').length).toBe(before)
    expect(w.find('[data-testid="dimension-syncing"]').exists()).toBe(true)
    expect(w.find('[data-testid="dimension-loading"]').exists()).toBe(false)

    library.loading = false
    await w.vm.$nextTick()
    expect(w.find('[data-testid="dimension-syncing"]').exists()).toBe(false)
    expect(w.findAll('[data-testid="dimension-group"]').length).toBe(before)
    w.unmount()
  })

  it('① 无旧数据时 loading 才接管为空态占位（首屏加载不受影响）', async () => {
    const library = useLibraryStore()
    library.dimensions = [] as never
    library.modulesByDim = {} as never
    library.loading = true
    const w = mount(DimensionPanel)
    await w.vm.$nextTick()

    expect(w.find('[data-testid="dimension-loading"]').exists()).toBe(true)
    expect(w.find('[data-testid="dimension-group"]').exists()).toBe(false)
    w.unmount()
  })

  it('② 滚动位置按「面板区域+搜索词」分桶存取并持久化', async () => {
    const store = useDimensionPanelStore()
    store.setScrollTop('browse:', 420)
    store.setScrollTop('browse:skirt', 88)
    await nextTick()
    expect(store.getScrollTop('browse:')).toBe(420)
    expect(store.getScrollTop('browse:skirt')).toBe(88)
    store.clearScrollTop('browse:skirt')
    await nextTick()
    expect(store.getScrollTop('browse:skirt')).toBe(0)
    expect(store.getScrollTop('browse:')).toBe(420)
    // 持久化到 localStorage（刷新应用后仍可恢复）
    expect(localStorage.getItem('pmf:scrollTop')).toContain('420')
  })

  it('③ 内容未变化时 fetchAll 不替换引用（不触发面板整体重绘）', async () => {
    const library = useLibraryStore()
    await library.fetchAll()
    const dimsRef = library.dimensions
    const groupedRef = library.modulesByDim

    // 再次拉取同样的数据（点击随机会走 ensureFreshForRandom → fetchAll）
    dbMocks.dbGetDimensions.mockResolvedValue(JSON.parse(JSON.stringify(DIMS)))
    dbMocks.dbGetAllModulesGrouped.mockResolvedValue(JSON.parse(JSON.stringify(GROUPED)))
    await library.fetchAll()
    expect(library.dimensions).toBe(dimsRef)
    expect(library.modulesByDim).toBe(groupedRef)

    // 内容有变化时才替换
    dbMocks.dbGetAllModulesGrouped.mockResolvedValue({
      ...JSON.parse(JSON.stringify(GROUPED)),
      top: [
        { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: '白衬衫改', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
      ],
    })
    await library.fetchAll()
    expect(library.modulesByDim).not.toBe(groupedRef)
  })

  it('④ 切换浏览/已选为 v-show：两个列表同时挂载，各自滚动位置互不干扰', async () => {
    const library = useLibraryStore()
    seed(library)
    localStorage.setItem('pmf:dimPanelMode', 'browse')
    const w = mount(DimensionPanel)
    await flush(w)

    // 展开 top 并加入一条已选，供 selected 列表渲染卡片
    await w.find('[data-testid="dimension-header-top"]').trigger('click')
    await flush(w)
    await w.find('[data-testid="module-row-m_top_1"]').trigger('click')
    await flush(w)

    // 两个列表同时挂载（selected 仅 display:none），滚动容器与内部状态均保留
    expect(w.find('[data-testid="dimension-header-top"]').exists()).toBe(true)
    expect(w.find('[data-testid="selected-card"]').exists()).toBe(true)

    await w.find('[data-testid="dim-mode-selected"]').trigger('click')
    await flush(w)
    // 切到 selected：浏览列表仍在 DOM（隐藏），展开态与列表 DOM 不丢
    expect(w.find('[data-testid="dimension-header-top"]').exists()).toBe(true)
    expect(w.find('[data-testid="selected-card"]').exists()).toBe(true)

    await w.find('[data-testid="dim-mode-browse"]').trigger('click')
    await flush(w)
    expect(w.find('[data-testid="dimension-header-top"]').exists()).toBe(true)
    expect(w.find('[data-testid="module-row-m_top_1"]').exists()).toBe(true)
    w.unmount()
  })

  it('③ 面板 modulesByDim computed 在分组等价时复用旧引用', async () => {
    const library = useLibraryStore()
    seed(library)
    const w = mount(DimensionPanel)
    await flush(w)
    const first = (w.vm as unknown as { modulesByDim: Record<string, unknown[]> }).modulesByDim

    // 等价替换：新的 Record/数组，但元素是同一批 Module 对象（不触发列表重绘）
    const top = library.modulesByDim['d_top'] ?? library.modulesByDim['top'] ?? []
    library.modulesByDim = { ...library.modulesByDim, top: [...top] } as never
    await nextTick()
    const second = (w.vm as unknown as { modulesByDim: Record<string, unknown[]> }).modulesByDim
    expect(second).toBe(first)

    // 真实变化时才产生新引用
    library.modulesByDim = { ...library.modulesByDim, top: [] } as never
    await nextTick()
    const third = (w.vm as unknown as { modulesByDim: Record<string, unknown[]> }).modulesByDim
    expect(third).not.toBe(first)
    w.unmount()
  })
})
