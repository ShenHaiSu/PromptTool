/**
 * 阶段六系统集成用例 — 快捷键 / 导出 / persist / 溢出保护 / Toast 队列 / 全局错误
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildCsvText, exportCsv } from '@/lib/export'
import { PromptIR } from '@/engine/models'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useShortcuts } from '@/composables/useShortcuts'
import { loadGeometry } from '@/composables/usePersist'
import { useToast, appToasts } from '@/composables/useToast'

describe('exportCsv (lib/export)', () => {
  it('列为 序号/提示词/维度构成/冲突警告，含 BOM', () => {
    const ir = new PromptIR([{ dimensionKey: 'face', text: 'beautiful face', weight: 1.2, sourceModuleId: 'm1' }], ['套装互斥'])
    const text = buildCsvText([{ finalPrompt: 'beautiful face', segments: ir.segments, warnings: ir.warnings }])
    expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(text).toContain('序号')
    expect(text).toContain('提示词')
    expect(text).toContain('维度构成')
    expect(text).toContain('冲突警告')
    expect(text).toContain('face')
    expect(text).toContain('套装互斥')
  })
  it('转义双引号', () => {
    const ir = new PromptIR([{ dimensionKey: 'top', text: 'say "hi"', weight: 1, sourceModuleId: 'm2' }], [])
    const text = buildCsvText([{ finalPrompt: 'say "hi"', segments: ir.segments, warnings: [] }])
    expect(text).toContain('say ""hi""')
  })
})

describe('exportCsv 下载触发', () => {
  it('通过 Blob + a.click 触发下载', () => {
    const ir = new PromptIR([{ dimensionKey: 'face', text: 'a', weight: 1, sourceModuleId: 'm1' }], [])
    const clickSpy = vi.fn()
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = origCreate(tag as unknown as string)
      if (tag === 'a') (el as HTMLAnchorElement).click = clickSpy
      return el
    }) as unknown as typeof document.createElement)
    // jsdom URL.createObjectURL mock
    global.URL.createObjectURL = vi.fn(() => 'blob:fake') as unknown as typeof URL.createObjectURL
    global.URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
    exportCsv('pmf-test.csv', [{ finalPrompt: 'a', segments: ir.segments, warnings: [] }])
    expect(clickSpy).toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})

describe('useShortcuts', () => {
  beforeEach(() => localStorage.clear())
  it('Ctrl+F/Ctrl+S/Ctrl+C/Delete 触发对应回调，输入框内不劫持', async () => {
    const focusSearch = vi.fn()
    const save = vi.fn()
    const copy = vi.fn()
    const remove = vi.fn()
    const Comp = defineComponent({
      setup() {
        useShortcuts({ focusSearch, save, copy, remove })
        return () => h('div', [h('input', { 'data-testid': 'inp' })])
      },
    })
    const wrapper = mount(Comp, { attachTo: document.body })
    // Ctrl+F
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }))
    expect(focusSearch).toHaveBeenCalledTimes(1)
    // Ctrl+S（非输入框）
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    expect(save).toHaveBeenCalledTimes(1)
    // Ctrl+S 在输入框内不劫持
    const inp = document.querySelector<HTMLInputElement>('[data-testid="inp"]')!
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    expect(save).toHaveBeenCalledTimes(1) // 未增加
    // Ctrl+C
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))
    expect(copy).toHaveBeenCalledTimes(1)
    // Delete
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    expect(remove).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})

describe('usePersist 几何溢出保护', () => {
  it('loadGeometry 对 <1280×720 视为无效', () => {
    localStorage.setItem('pmf:geometry', JSON.stringify({ width: 800, height: 600 }))
    expect(loadGeometry()).toBeNull()
    localStorage.setItem('pmf:geometry', JSON.stringify({ width: 1600, height: 900 }))
    expect(loadGeometry()).toEqual({ width: 1600, height: 900 })
  })
})

describe('Toast 队列 MAX 5', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    appToasts.value = []
  })
  it('超过 5 条丢弃最旧', () => {
    const { push } = useToast()
    for (let i = 0; i < 6; i++) push(`msg ${i}`, 'info', 999999)
    expect(appToasts.value.length).toBe(5)
    expect(appToasts.value[0]!.message).toBe('msg 1')
    expect(appToasts.value[4]!.message).toBe('msg 5')
  })
})

describe('溢出保护 768p — 最小窗口', () => {
  it('App 挂载后主布局存在且无横向溢出类', async () => {
    setActivePinia(createPinia())
    const { default: App } = await import('@/App.vue')
    const wrapper = mount(App, { attachTo: document.body })
    expect(wrapper.find('[data-testid="main-layout"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="status-bar"]').exists()).toBe(true)
    // sash 存在
    expect(wrapper.find('[data-testid="sash-left"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
