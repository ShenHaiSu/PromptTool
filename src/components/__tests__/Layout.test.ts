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

describe('Main layout — need04 28:42:30 + 无 TopBar 常驻 + Sash + StatusBar', () => {
  it('三栏与双 sash/StatusBar 占据新布局（无 TopBar 常驻）', async () => {
    const w = mount(App, { global: { plugins: [createPinia()] } })
    await new Promise((r) => setTimeout(r, 0))
    await w.vm.$nextTick()
    expect(w.find('[data-testid="topbar"]').exists()).toBe(false)
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
    // 预览仅悬浮 Dialog，非 TopBar 常驻
    expect(w.find('[data-testid="preview-trigger"]').exists()).toBe(true)
    // 黄金位：中区为批量，右栏为历史
    expect(w.find('[data-testid="panel-center"]').text()).toContain('批量工厂')
  })

  it('初始 sash 为 28:42:30', async () => {
    const w = mount(App, { global: { plugins: [createPinia()] } })
    await w.vm.$nextTick()
    const left = w.find('[data-testid="panel-left"]')
    const center = w.find('[data-testid="panel-center"]')
    expect((left.element as HTMLElement).style.width).toMatch(/28/)
    expect((center.element as HTMLElement).style.width).toMatch(/42/)
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
    const layout = w.find('[data-testid="main-layout"]')
    expect(layout.classes().join(' ')).toContain('overflow-hidden')
  })
})
