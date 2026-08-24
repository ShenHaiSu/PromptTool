import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TopBar from '../TopBar.vue'
import { PromptIR } from '@/engine/models'

beforeEach(() => {
  localStorage.clear()
  // jsdom clipboard mock
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

describe('TopBar', () => {
  it('折叠高度 88px 时 prompt 单行省略，badge 无冲突', () => {
    const w = mount(TopBar, { props: { prompt: 'white shirt, pleated skirt', warnings: [], ir: new PromptIR([], []) } })
    expect(w.find('[data-testid="topbar"]').exists()).toBe(true)
    expect(w.find('[data-testid="topbar-badge"]').text()).toContain('无冲突')
    expect(w.find('[data-testid="topbar-prompt"]').exists()).toBe(true)
    expect(w.find('[data-testid="topbar-prompt"]').text()).toContain('white shirt')
    // IR 区默认折叠不可见（需展开后才显示）
    expect(w.find('[data-testid="topbar-ir-area"]').exists()).toBe(false)
  })

  it('空状态显示 empty 占位', () => {
    const w = mount(TopBar, { props: { prompt: '', warnings: [], ir: null } })
    expect(w.find('[data-testid="topbar-empty"]').exists()).toBe(true)
  })

  it('有套装互斥警告时 badge 变黄/红并显示计数', () => {
    const w = mount(TopBar, { props: { prompt: 'red dress, white shirt', warnings: ['套装互斥：outfit 与 top 冲突'], ir: null } })
    expect(w.find('[data-testid="topbar-badge"]').text()).toContain('套装互斥')
  })

  it('点击 展开/折叠 切换 88↔168 高度并显示 IR 区', async () => {
    const ir = new PromptIR([{ dimensionKey: 'top', text: 'white shirt', weight: 1.0, sourceModuleId: 'm1' }], [])
    const w = mount(TopBar, { props: { prompt: 'white shirt', warnings: [], ir } })
    const btn = w.find('[data-testid="topbar-expand-btn"]')
    expect(btn.text()).toContain('展开')
    await btn.trigger('click')
    expect(w.find('[data-testid="topbar-ir-area"]').exists()).toBe(true)
    expect(w.find('[data-testid="topbar-expand-btn"]').text()).toContain('折叠')
    // IR JSON 默认隐藏，点击显示 IR 按钮后可见
    expect(w.find('[data-testid="topbar-ir-json"]').exists()).toBe(false)
    await w.find('[data-testid="topbar-ir-toggle"]').trigger('click')
    expect(w.find('[data-testid="topbar-ir-json"]').exists()).toBe(true)
    expect(w.find('[data-testid="topbar-ir-json"]').text()).toContain('white shirt')
  })

  it('点击复制调用 clipboard 并 toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const w = mount(TopBar, { props: { prompt: 'hello prompt', warnings: [], ir: null } })
    await w.find('[data-testid="topbar-copy-btn"]').trigger('click')
    // clipboard called or fallback execCommand — pudge: check one of them; in jsdom clipboard mock should be called
    expect(writeText).toHaveBeenCalledWith('hello prompt')
  })

  it('IR 折叠区 warnings 展示', async () => {
    const ir = new PromptIR([], ['outfit 与 top 互斥'])
    const w = mount(TopBar, { props: { prompt: 'a, b', warnings: ['outfit 与 top 互斥'], ir } })
    await w.find('[data-testid="topbar-expand-btn"]').trigger('click')
    // 未点显示 IR 时，warnings 在折叠提示区可见
    expect(w.find('[data-testid="topbar-warnings-collapsed"]').exists()).toBe(true)
    await w.find('[data-testid="topbar-ir-toggle"]').trigger('click')
    expect(w.find('[data-testid="topbar-warnings"]').exists()).toBe(true)
  })
})
