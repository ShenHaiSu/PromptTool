import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ModuleBatchDialog from '../ModuleBatchDialog.vue'

const mockBatchCreate = vi.fn()

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db')
  return {
    ...actual,
    dbBatchCreateModules: (...args: unknown[]) => mockBatchCreate(...args),
  }
})

function makeDim(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'dim_top',
    key: 'top',
    nameCn: '上装',
    nameEn: 'Top',
    sortOrder: 5,
    isMultiSelect: false,
    isEnabled: true,
    icon: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as unknown as import('@/engine/models').Dimension
}

describe('ModuleBatchDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('挂载时显示标题包含维度名', () => {
    const w = mount(ModuleBatchDialog, { props: { open: true, dimension: makeDim() } })
    expect(w.text()).toContain('上装 / top')
  })

  it('closed 时不渲染', () => {
    const w = mount(ModuleBatchDialog, { props: { open: false, dimension: makeDim() } })
    expect(w.find('[data-testid="module-batch-dialog"]').exists()).toBe(false)
  })

  it('粘贴文本后预览统计更新，空行/重复可区分', async () => {
    const w = mount(ModuleBatchDialog, { props: { open: true, dimension: makeDim() } })
    const ta = w.find('[data-testid="module-batch-textarea"]')
    await ta.setValue('hello\nhello\n\nworld')
    const stats = w.find('[data-testid="module-batch-stats"]').text()
    expect(stats).toContain('2 行')
    expect(stats).toContain('空行 1')
    expect(stats).toContain('重复行 1')
  })

  it('超长行被截断并在预览中标记', async () => {
    const w = mount(ModuleBatchDialog, { props: { open: true, dimension: makeDim() } })
    const ta = w.find('[data-testid="module-batch-textarea"]')
    const long = 'x'.repeat(600)
    await ta.setValue(long)
    expect(w.text()).toContain('超长')
  })

  it('超 500 行提示截断', async () => {
    const w = mount(ModuleBatchDialog, { props: { open: true, dimension: makeDim() } })
    const ta = w.find('[data-testid="module-batch-textarea"]')
    const big = Array.from({ length: 600 }, (_, i) => `line ${i}`).join('\n')
    await ta.setValue(big)
    expect(w.find('[data-testid="module-batch-warnings"]').exists()).toBe(true)
    expect(w.find('[data-testid="module-batch-warnings"]').text()).toContain('500')
  })

  it('有效行为 0 时创建按钮禁用', async () => {
    const w = mount(ModuleBatchDialog, { props: { open: true, dimension: makeDim() } })
    const ta = w.find('[data-testid="module-batch-textarea"]')
    await ta.setValue('   \n \n')
    const btn = w.find('[data-testid="module-batch-create"]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('点击创建调用 dbBatchCreateModules 并触发 imported', async () => {
    mockBatchCreate.mockResolvedValue({ modulesCreated: 2, modulesUpdated: 0, modulesSkipped: 0, errors: [], warnings: [] })
    const w = mount(ModuleBatchDialog, { props: { open: true, dimension: makeDim() } })
    const ta = w.find('[data-testid="module-batch-textarea"]')
    await ta.setValue('hello\nworld')
    await w.find('[data-testid="module-batch-create"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(mockBatchCreate).toHaveBeenCalled()
    const call = mockBatchCreate.mock.calls[0]![0] as { dimId: string; mode: string; items: unknown[] }
    expect(call.dimId).toBe('dim_top')
    expect((call.items as unknown[]).length).toBe(2)
    expect(w.emitted('imported')).toBeTruthy()
  })

  it('覆盖模式切换', async () => {
    const w = mount(ModuleBatchDialog, { props: { open: true, dimension: makeDim() } })
    await w.find('[data-testid="module-batch-mode-overwrite"]').trigger('change')
    // internal mode would be overwrite; verify by triggering create and inspecting arg
    mockBatchCreate.mockResolvedValue({ modulesCreated: 0, modulesUpdated: 1, modulesSkipped: 0, errors: [], warnings: [] })
    await w.find('[data-testid="module-batch-textarea"]').setValue('hello')
    await w.find('[data-testid="module-batch-create"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(mockBatchCreate.mock.calls[0]![0].mode).toBe('overwrite')
  })
})
