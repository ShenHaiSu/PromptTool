/**
 * need02 T7：入口接入测试 — 预览弹窗“冲突编辑”按钮 + 批量卡编辑按钮/findings 行
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/lib/export', () => ({
  exportSingleCsv: vi.fn(),
  exportBatchCsv: vi.fn(),
}))

import PromptPreviewDialog from '../PromptPreviewDialog.vue'
import BatchCard from '../BatchCard.vue'
import { PromptIR } from '@/engine/models'

beforeEach(() => {
  setActivePinia(createPinia())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
})

describe('T7 entry points', () => {
  it('预览弹窗有冲突编辑入口（ir=null 时 disabled）', () => {
    const closed = mount(PromptPreviewDialog, {
      props: { open: true, prompt: 'x', warnings: [], ir: null },
      global: { plugins: [createPinia()] },
    })
    expect(closed.find('[data-testid="ir-editor-open"]').exists()).toBe(true)
    expect(closed.find('[data-testid="ir-editor-open"]').attributes('disabled')).toBeDefined()
  })

  it('预览弹窗 badge 读 findings（error→⛔）', () => {
    const ir = new PromptIR(
      [{ dimensionKey: 'outfit', text: 'dress', weight: 1, sourceModuleId: 'm1' }],
      [],
      [{ ruleId: 'r', ruleName: '独占', type: 'isolated', severity: 'error', message: '独占', involvedIndexes: [0], involvedModuleIds: [], fix: null }],
      2,
    )
    const w = mount(PromptPreviewDialog, {
      props: { open: true, prompt: 'dress', warnings: [], ir },
      global: { plugins: [createPinia()] },
    })
    // 无规则 store 数据时回退 ir.findings
    expect(w.find('[data-testid="preview-badge"]').text()).toContain('⛔')
  })

  it('预览弹窗点击冲突编辑打开编辑器', async () => {
    const ir = new PromptIR(
      [{ dimensionKey: 'top', text: 'shirt', weight: 1, sourceModuleId: 'm1' }],
      [], [], 2,
    )
    const w = mount(PromptPreviewDialog, {
      props: { open: true, prompt: 'shirt', warnings: [], ir },
      global: { plugins: [createPinia()], stubs: { Teleport: true } },
    })
    await w.find('[data-testid="ir-editor-open"]').trigger('click')
    expect(w.find('[data-testid="ir-editor-dialog"]').exists()).toBe(true)
  })

  it('批量卡有编辑按钮，警告行优先 findings', () => {
    const model = {
      index: 1,
      ir: new PromptIR(
        [{ dimensionKey: 'outfit', text: 'dress', weight: 1, sourceModuleId: 'm1' }],
        ['老警告'],
        [{ ruleId: 'r1', ruleName: '互斥', type: 'mutex', severity: 'warning', message: '新 findings 首条', involvedIndexes: [0], involvedModuleIds: [], fix: null }],
        2,
      ),
      finalPrompt: 'dress',
      warnings: ['老警告'],
      dimKeys: ['outfit'],
      hash: 'abc',
    }
    const w = mount(BatchCard, {
      props: { model, index: 1 },
      global: { plugins: [createPinia()], stubs: { Teleport: true } },
    })
    expect(w.find('[data-testid="batch-card-edit"]').exists()).toBe(true)
    expect(w.text()).toContain('新 findings 首条')
  })

  it('批量卡无 findings 时回退 warnings', () => {
    const model = {
      index: 1,
      ir: new PromptIR([{ dimensionKey: 'top', text: 'shirt', weight: 1, sourceModuleId: 'm1' }], [], [], 2),
      finalPrompt: 'shirt',
      warnings: ['老警告回退'],
      dimKeys: ['top'],
      hash: 'abc',
    }
    const w = mount(BatchCard, {
      props: { model, index: 1 },
      global: { plugins: [createPinia()], stubs: { Teleport: true } },
    })
    expect(w.text()).toContain('老警告回退')
  })

  it('批量卡点击编辑打开编辑器', async () => {
    const model = {
      index: 1,
      ir: new PromptIR([{ dimensionKey: 'top', text: 'shirt', weight: 1, sourceModuleId: 'm1' }], [], [], 2),
      finalPrompt: 'shirt',
      warnings: [],
      dimKeys: ['top'],
      hash: 'abc',
    }
    const w = mount(BatchCard, {
      props: { model, index: 1 },
      global: { plugins: [createPinia()], stubs: { Teleport: true } },
    })
    await w.find('[data-testid="batch-card-edit"]').trigger('click')
    expect(w.find('[data-testid="ir-editor-dialog"]').exists()).toBe(true)
  })
})
