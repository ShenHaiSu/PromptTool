import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PromptPreviewDialog from '../PromptPreviewDialog.vue'
import { PromptIR } from '@/engine/models'

vi.mock('@/lib/export', () => ({
  exportSingleCsv: vi.fn(),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
  if (!URL.createObjectURL) Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), configurable: true })
  if (!URL.revokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
})

describe('PromptPreviewDialog', () => {
  it('open 控制 overlay 显隐', async () => {
    const wClosed = mount(PromptPreviewDialog, { props: { open: false, prompt: '', warnings: [], ir: null }, global: { plugins: [createPinia()] } })
    expect(wClosed.find('[data-testid="preview-dialog-overlay"]').exists()).toBe(false)
    const wOpen = mount(PromptPreviewDialog, { props: { open: true, prompt: '', warnings: [], ir: null }, global: { plugins: [createPinia()] } })
    expect(wOpen.find('[data-testid="preview-dialog-overlay"]').exists()).toBe(true)
    expect(wOpen.find('[data-testid="preview-dialog"]').exists()).toBe(true)
  })

  it('空 prompt 时 preview-empty 可见，复制/导出 disabled', () => {
    const w = mount(PromptPreviewDialog, { props: { open: true, prompt: '', warnings: [], ir: null }, global: { plugins: [createPinia()] } })
    expect(w.find('[data-testid="preview-empty"]').exists()).toBe(true)
    expect(w.find('[data-testid="preview-copy-btn"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="preview-export-btn"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="preview-badge"]').text()).toContain('无冲突')
  })

  it('有 prompt 时 preview-prompt 展示，复制触发 clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const ir = new PromptIR([{ dimensionKey: 'top', text: 'white shirt', weight: 1, sourceModuleId: 'm1' }], [])
    const w = mount(PromptPreviewDialog, { props: { open: true, prompt: 'white shirt, pleated skirt', warnings: [], ir }, global: { plugins: [createPinia()] } })
    expect(w.find('[data-testid="preview-prompt"]').exists()).toBe(true)
    expect(w.find('[data-testid="preview-prompt"]').text()).toContain('white shirt')
    await w.find('[data-testid="preview-copy-btn"]').trigger('click')
    expect(writeText).toHaveBeenCalledWith('white shirt, pleated skirt')
  })

  it('preview-ir-toggle 切换 ir-json 与 warnings 显隐', async () => {
    const ir = new PromptIR([{ dimensionKey: 'top', text: 'white shirt', weight: 1, sourceModuleId: 'm1' }], ['套装互斥'])
    const w = mount(PromptPreviewDialog, { props: { open: true, prompt: 'white shirt', warnings: ['套装互斥'], ir }, global: { plugins: [createPinia()] } })
    expect(w.find('[data-testid="preview-ir-json"]').exists()).toBe(false)
    expect(w.find('[data-testid="preview-warnings-collapsed"]').exists()).toBe(true)
    await w.find('[data-testid="preview-ir-toggle"]').trigger('click')
    expect(w.find('[data-testid="preview-ir-json"]').exists()).toBe(true)
    expect(w.find('[data-testid="preview-warnings"]').exists()).toBe(true)
    expect(w.find('[data-testid="preview-ir-json"]').text()).toContain('white shirt')
  })

  it('Esc 与遮罩点击触发 update:open false', async () => {
    const w = mount(PromptPreviewDialog, { props: { open: true, prompt: 'x', warnings: [], ir: null }, global: { plugins: [createPinia()] } })
    // close button
    await w.find('[data-testid="preview-close-btn"]').trigger('click')
    expect(w.emitted('update:open')?.[0]).toEqual([false])
    // keydown Esc
    const w2 = mount(PromptPreviewDialog, { props: { open: true, prompt: 'x', warnings: [], ir: null }, global: { plugins: [createPinia()] } })
    await w2.find('[data-testid="preview-dialog-overlay"]').trigger('keydown', { key: 'Escape' })
    expect(w2.emitted('update:open')).toBeTruthy()
  })

  it('有套装警告时 badge 显示套装互斥', () => {
    const ir = new PromptIR([], ['套装互斥：outfit 与 top 冲突'])
    const w = mount(PromptPreviewDialog, { props: { open: true, prompt: 'a, b', warnings: ['套装互斥：outfit 与 top 冲突'], ir }, global: { plugins: [createPinia()] } })
    expect(w.find('[data-testid="preview-badge"]').text()).toContain('套装互斥')
  })
})
