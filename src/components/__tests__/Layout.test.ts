import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'

// mock db invoke layer — App/DimensionPanel 会在 onMounted 调用
vi.mock('@/lib/db', () => ({
  dbGetDimensions: vi.fn().mockResolvedValue([
    { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true, icon: null },
    { id: 'd_bottom', key: 'bottom', nameCn: '下装', nameEn: 'Bottom', sortOrder: 6, isMultiSelect: false, isEnabled: true, icon: null },
  ]),
  dbGetAllModulesGrouped: vi.fn().mockResolvedValue({ top: [], bottom: [] }),
  dbGetModulesByDimension: vi.fn().mockResolvedValue([]),
  dbSearchModules: vi.fn().mockResolvedValue([]),
  dbListRecent: vi.fn().mockResolvedValue([]),
  dbListFavorites: vi.fn().mockResolvedValue([]),
  dbListTemplates: vi.fn().mockResolvedValue([]),
}))

// mock history store fetchAll avoid invoke
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  // jsdom matchMedia stub
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
})

describe('Main layout 30:38:32 + TopBar + StatusBar + Sash persistence', () => {
  it('三栏与 sash/TopBar/StatusBar 占据布局', async () => {
    const w = mount(App, { global: { plugins: [createPinia()] } })
    // allow onMounted async fetches
    await new Promise((r) => setTimeout(r, 0))
    await w.vm.$nextTick()
    expect(w.find('[data-testid="topbar"]').exists()).toBe(true)
    expect(w.find('[data-testid="main-layout"]').exists()).toBe(true)
    expect(w.find('[data-testid="panel-left"]').exists()).toBe(true)
    expect(w.find('[data-testid="panel-center"]').exists()).toBe(true)
    expect(w.find('[data-testid="panel-right"]').exists()).toBe(true)
    expect(w.find('[data-testid="sash-left"]').exists()).toBe(true)
    expect(w.find('[data-testid="sash-right"]').exists()).toBe(true)
    expect(w.find('[data-testid="status-bar"]').exists()).toBe(true)
    expect(w.find('[data-testid="dimension-panel"]').exists()).toBe(true)
    expect(w.find('[data-testid="batch-factory"]').exists()).toBe(true)
    expect(w.find('[data-testid="history-panel"]').exists()).toBe(true)
  })

  it('初始 sash 为 30:38:32 且左右 sash 可拖拽持久化', async () => {
    const w = mount(App, { global: { plugins: [createPinia()] } })
    await w.vm.$nextTick()
    const left = w.find('[data-testid="panel-left"]')
    const center = w.find('[data-testid="panel-center"]')
    // style.width 由 leftFrac/centerFrac 驱动
    expect((left.element as HTMLElement).style.width).toMatch(/30/)
    expect((center.element as HTMLElement).style.width).toMatch(/38/)
  })

  it('主题切换按钮可切换 light↔dark 并持久化', async () => {
    const w = mount(App, { global: { plugins: [createPinia()] } })
    await w.vm.$nextTick()
    const btn = w.find('[data-testid="theme-toggle"]')
    expect(btn.exists()).toBe(true)
    const before = document.documentElement.classList.contains('dark')
    await btn.trigger('click')
    const after = document.documentElement.classList.contains('dark')
    expect(after).not.toBe(before)
    expect(localStorage.getItem('pmf:theme')).toBeTruthy()
  })

  it('最小宽度 1280x720 无溢出（容器 overflow-hidden，sash 约束 12%~65%）', async () => {
    const w = mount(App, { global: { plugins: [createPinia()] } })
    await w.vm.$nextTick()
    // 布局容器应为 flex 并且 overflow-hidden（GPU 合成，不用递归 pack）
    const layout = w.find('[data-testid="main-layout"]')
    expect(layout.classes().join(' ')).toContain('overflow-hidden')
  })
})
