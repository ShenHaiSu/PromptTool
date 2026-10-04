import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
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

let mounted: VueWrapper[] = []

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  // el-drawer 经 Teleport 挂到 body，前序用例残留会污染 querySelector，先清空（R4）
  document.body.innerHTML = ''
  document.documentElement.classList.remove('dark')
  // jsdom matchMedia stub
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
})

afterEach(() => {
  for (const w of mounted) {
    try { w.unmount() } catch { /* 已卸载则忽略 */ }
  }
  mounted = []
  document.body.innerHTML = ''
})

function mountApp(attach = false) {
  const w = mount(App, attach ? { global: { plugins: [createPinia()] }, attachTo: document.body } : { global: { plugins: [createPinia()] } })
  mounted.push(w)
  return w
}

describe('Main layout — need04 双栏 + 无 TopBar 常驻 + Sash + StatusBar', () => {
  it('双栏与单 sash/StatusBar 占据新布局（无 TopBar 常驻）', async () => {
    const w = mountApp()
    await new Promise((r) => setTimeout(r, 0))
    await w.vm.$nextTick()
    expect(w.find('[data-testid="topbar"]').exists()).toBe(false)
    expect(w.find('[data-testid="main-layout"]').exists()).toBe(true)
    expect(w.find('[data-testid="panel-left"]').exists()).toBe(true)
    expect(w.find('[data-testid="panel-center"]').exists()).toBe(true)
    expect(w.find('[data-testid="sash-left"]').exists()).toBe(true)
    // 右栏已收纳：右栏/右 sash DOM 不再存在
    expect(w.find('[data-testid="panel-right"]').exists()).toBe(false)
    expect(w.find('[data-testid="sash-right"]').exists()).toBe(false)
    // 浮动按钮常驻
    expect(w.find('[data-testid="history-fab"]').exists()).toBe(true)
    expect(w.find('[data-testid="status-bar"]').exists()).toBe(true)
    expect(w.find('[data-testid="dimension-panel"]').exists()).toBe(true)
    expect(w.find('[data-testid="batch-factory"]').exists()).toBe(true)
    // 预览仅悬浮 Dialog，非 TopBar 常驻
    expect(w.find('[data-testid="preview-trigger"]').exists()).toBe(true)
    // 黄金位：中区为批量
    expect(w.find('[data-testid="panel-center"]').text()).toContain('批量工厂')
  })

  it('初始双栏比例为左 33%（中区 flex-1，无内联宽度）', async () => {
    localStorage.removeItem('pmf:sash')
    const w = mountApp()
    await w.vm.$nextTick()
    const left = w.find('[data-testid="panel-left"]')
    const center = w.find('[data-testid="panel-center"]')
    expect((left.element as HTMLElement).style.width).toMatch(/33/)
    expect((center.element as HTMLElement).style.width).toBe('')
  })

  it('主题切换按钮可切换 light↔dark 并持久化', async () => {
    const w = mountApp()
    await w.vm.$nextTick()
    const btn = w.find('[data-testid="theme-toggle"]')
    expect(btn.exists()).toBe(true)
    const before = document.documentElement.classList.contains('dark')
    await btn.trigger('click')
    const after = document.documentElement.classList.contains('dark')
    expect(after).not.toBe(before)
    expect(localStorage.getItem('pmf:theme')).toBeTruthy()
  })

  it('最小宽度 1280x720 无溢出（容器 overflow-hidden）', async () => {
    const w = mountApp()
    await w.vm.$nextTick()
    const layout = w.find('[data-testid="main-layout"]')
    expect(layout.classes().join(' ')).toContain('overflow-hidden')
    // 新增：中区占满剩余宽度
    expect(w.find('[data-testid="panel-center"]').classes().join(' ')).toContain('flex-1')
  })

  it('点击 FAB 打开历史抽屉，抽屉内含 history-panel', async () => {
    const w = mountApp(true)
    await new Promise((r) => setTimeout(r, 0))
    await w.vm.$nextTick()

    // 懒挂载：未打开时抽屉内无 history-panel
    expect(document.body.querySelector('[data-testid="history-panel"]')).toBeNull()

    await w.find('[data-testid="history-fab"]').trigger('click')
    // el-drawer 经 Teleport + 过渡异步挂载，轮询等待抽屉内容就绪（R4）
    let panel: Element | null = null
    for (let i = 0; i < 50 && !panel; i++) {
      await w.vm.$nextTick()
      await new Promise((r) => setTimeout(r, 20))
      panel = document.body.querySelector('[data-testid="history-panel"]')
    }
    const drawer = document.body.querySelector('[data-testid="history-drawer"]')
    expect(drawer).not.toBeNull()
    expect(panel).not.toBeNull()
  })
})
