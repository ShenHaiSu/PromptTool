import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const dbMocks = vi.hoisted(() => ({
  dbGetDimensions: vi.fn().mockResolvedValue([
    { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true, icon: null },
    { id: 'd_bottom', key: 'bottom', nameCn: '下装', nameEn: 'Bottom', sortOrder: 6, isMultiSelect: true, isEnabled: true, icon: null },
  ]),
  dbGetAllModulesGrouped: vi.fn().mockResolvedValue({
    top: [
      { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: '白衬衫', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
      { id: 'm_top_2', dimensionId: 'd_top', contentEn: 'nsfw top', displayName: 'NSFW上装', weight: 1, isEnabled: true, isNsfw: true, usageCount: 0, dimensionKey: 'top' },
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

function createWrapper() {
  setActivePinia(createPinia())
  return mount(DimensionPanel, {
    global: { plugins: [createPinia()] },
  })
}

async function flush(wrapper: ReturnType<typeof mount>) {
  await new Promise((r) => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 30))
  await wrapper.vm.$nextTick()
}

describe('DimensionPanel — Need02 维度折叠 + CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    document.body.innerHTML = ''
    dbMocks.dbGetDimensions.mockResolvedValue([
      { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true, icon: null },
      { id: 'd_bottom', key: 'bottom', nameCn: '下装', nameEn: 'Bottom', sortOrder: 6, isMultiSelect: true, isEnabled: true, icon: null },
    ])
    dbMocks.dbGetAllModulesGrouped.mockResolvedValue({
      top: [
        { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: '白衬衫', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
      ],
      bottom: [
        { id: 'm_bot_1', dimensionId: 'd_bottom', contentEn: 'pleated skirt', displayName: '百褶裙', weight: 1.2, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'bottom' },
      ],
    })
  })

  it('挂载后所有维度默认折叠（无展开内容）', async () => {
    const w = createWrapper()
    await flush(w)
    // 默认折叠：没有 module-row 渲染
    expect(w.find('[data-testid="module-row-m_top_1"]').exists()).toBe(false)
    expect(w.find('[data-testid="module-row-m_bot_1"]').exists()).toBe(false)
  })

  it('新建维度按钮存在', async () => {
    const w = createWrapper()
    await flush(w)
    expect(w.find('[data-testid="create-dimension-btn"]').exists()).toBe(true)
  })

  it('维度头存在 + 按钮和 ✎ 按钮', async () => {
    const w = createWrapper()
    await flush(w)
    expect(w.find('[data-testid="dimension-header-top"]').exists()).toBe(true)
    expect(w.find('[data-testid="dim-create-module-top"]').exists()).toBe(true)
    expect(w.find('[data-testid="dim-edit-top"]').exists()).toBe(true)
    expect(w.find('[data-testid="dim-create-module-bottom"]').exists()).toBe(true)
    expect(w.find('[data-testid="dim-edit-bottom"]').exists()).toBe(true)
  })

  it('展开维度后词条行与编辑/删除按钮出现', async () => {
    const w = createWrapper()
    await flush(w)
    await w.find('[data-testid="dimension-header-top"]').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="module-row-m_top_1"]').exists()).toBe(true)
    expect(w.find('[data-testid="module-edit-m_top_1"]').exists()).toBe(true)
    expect(w.find('[data-testid="module-delete-m_top_1"]').exists()).toBe(true)
  })

  it('点击 + 新建维度打开弹窗', async () => {
    const w = createWrapper()
    await flush(w)
    await w.find('[data-testid="create-dimension-btn"]').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="dimension-edit-dialog"]').exists()).toBe(true)
    expect(w.find('[data-testid="dimension-edit-dialog-overlay"]').exists()).toBe(true)
  })

  it('维度头 + 按钮打开词条创建弹窗（预选维度）', async () => {
    const w = createWrapper()
    await flush(w)
    await w.find('[data-testid="dim-create-module-top"]').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="module-edit-dialog"]').exists()).toBe(true)
  })

  it('词条编辑按钮打开编辑弹窗', async () => {
    const w = createWrapper()
    await flush(w)
    await w.find('[data-testid="dimension-header-top"]').trigger('click')
    await w.vm.$nextTick()
    await w.find('[data-testid="module-edit-m_top_1"]').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="module-edit-dialog"]').exists()).toBe(true)
  })

  it('搜索过滤维度', async () => {
    const w = createWrapper()
    await flush(w)
    const input = w.find('[data-testid="dimension-search"]')
    await input.setValue('上装')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="dimension-header-top"]').exists()).toBe(true)
    // bottom 不匹配应被过滤
    expect(w.find('[data-testid="dimension-header-bottom"]').exists()).toBe(false)
  })
})
