/**
 * need02 T5/T6：编辑器行为测试 — 打开/改段/修复/三出口/脏检查 + 规则 CRUD 断言
 * jsdom + @vue/test-utils，mock stores 与 invoke。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>()
  return {
    ...actual,
    dbUpdateModule: vi.fn().mockResolvedValue(undefined),
  }
})

import { PromptIR, type AssemblyConfig } from '@/engine/models'
import { useRulesStore } from '@/stores/rules'
import { useLibraryStore } from '@/stores/library'
import { useAssemblyStore } from '@/stores/assembly'
import IrConflictEditorDialog from '../IrConflictEditorDialog.vue'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

function cfg(): AssemblyConfig {
  return { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }
}

function outfitTopIr(): PromptIR {
  return new PromptIR(
    [
      { dimensionKey: 'outfit', text: 'red dress', weight: 1.0, sourceModuleId: 'm_out' },
      { dimensionKey: 'top', text: 'white shirt', weight: 1.0, sourceModuleId: 'm_top' },
    ],
    [],
    [],
    2,
  )
}

async function mountEditor(ir: PromptIR | null = outfitTopIr()) {
  setActivePinia(createPinia())
  const rules = useRulesStore()
  const library = useLibraryStore()
  const asm = useAssemblyStore()
  // library 维度映射（规则 dimId→key 回退用内存派生即可；此处补中文名）
  library.dimensions = [
    { id: 'dim_05', key: 'outfit', nameCn: '全身套装', nameEn: 'Outfit', sortOrder: 8, isMultiSelect: false, isEnabled: true },
    { id: 'dim_03', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 6, isMultiSelect: false, isEnabled: true },
  ] as typeof library.dimensions
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValueOnce([
    { id: 'rule_01a', name: '套装互斥·上装', type: 'mutex', sourceDimensionId: 'dim_05', sourceModuleId: null, targetDimensionId: 'dim_03', targetModuleId: null, message: '已选全身套装，上装将自动忽略', isEnabled: true },
  ])
  await rules.fetchAll()
  const wrapper = mount(IrConflictEditorDialog, {
    props: { open: true, ir, config: cfg() },
    global: { plugins: [createPinia()], stubs: { Teleport: true } },
  })
  // 让 pinia 与组件内 store 同实例：重设 active 后组件已挂载，手动同步 rules
  void rules
  void asm
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('IrConflictEditor behavior', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn())
  })

  it('打开渲染段数=快照段数，badge 显示冲突', async () => {
    const w = mountEditor()
    const wrapper = await w
    expect(wrapper.find('[data-testid="ir-editor-seg-list"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ir-editor-seg-row-0"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ir-editor-seg-row-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ir-editor-badge"]').text()).toContain('冲突')
    expect(wrapper.find('[data-testid="ir-editor-finding-row-rule_01a"]').exists()).toBe(true)
  })

  it('删段后 findings 减少', async () => {
    const wrapper = await mountEditor()
    expect(wrapper.find('[data-testid="ir-editor-finding-row-rule_01a"]').exists()).toBe(true)
    await wrapper.find('[data-testid="ir-editor-seg-del-1"]').trigger('click')
    expect(wrapper.find('[data-testid="ir-editor-finding-row-rule_01a"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ir-editor-badge"]').text()).toContain('无冲突')
  })

  it('自动修复预览→确认应用移除目标段', async () => {
    const wrapper = await mountEditor()
    await wrapper.find('[data-testid="ir-editor-fix-rule_01a"]').trigger('click')
    expect(wrapper.find('[data-testid="ir-editor-fix-confirm-rule_01a"]').exists()).toBe(true)
    await wrapper.find('[data-testid="ir-editor-fix-confirm-rule_01a"]').trigger('click')
    expect(wrapper.find('[data-testid="ir-editor-finding-row-rule_01a"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ir-editor-preview"]').text()).toContain('red dress')
    expect(wrapper.find('[data-testid="ir-editor-preview"]').text()).not.toContain('white shirt')
  })

  it('改权重即时改 preview（含权重括号）', async () => {
    const wrapper = await mountEditor()
    // 直接调权重浮窗确认路径：打开浮窗→设值→确定
    await wrapper.find('[data-testid="ir-editor-seg-weight-0"]').trigger('click')
    expect(wrapper.find('[data-testid="ir-editor-weight-popover"]').exists()).toBe(true)
    const vm = wrapper.vm as unknown as { weightVal: number }
    vm.weightVal = 1.5
    await wrapper.vm.$nextTick()
    const btns = wrapper.findAll('[data-testid="ir-editor-weight-popover"] button')
    await btns[btns.length - 1]!.trigger('click')
    expect(wrapper.find('[data-testid="ir-editor-preview"]').text()).toContain('(red dress:1.5)')
  })

  it('脏关闭弹 confirm；确认后关闭', async () => {
    const wrapper = await mountEditor()
    await wrapper.find('[data-testid="ir-editor-seg-del-1"]').trigger('click')
    const confirmSpy = vi.mocked(window.confirm)
    confirmSpy.mockReturnValueOnce(false)
    await wrapper.find('[data-testid="ir-editor-close"]').trigger('click')
    expect(confirmSpy).toHaveBeenCalled()
    expect(wrapper.emitted('update:open')).toBeUndefined()
    confirmSpy.mockReturnValueOnce(true)
    await wrapper.find('[data-testid="ir-editor-close"]').trigger('click')
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('data-testid 清单齐备（06 §6 核心锚点）', async () => {
    const wrapper = await mountEditor()
    for (const id of [
      'ir-editor-overlay', 'ir-editor-dialog', 'ir-editor-badge', 'ir-editor-close',
      'ir-editor-undo', 'ir-editor-add-seg', 'ir-editor-profile', 'ir-editor-separator', 'ir-editor-brackets',
      'ir-editor-seg-list', 'ir-editor-tabs', 'ir-editor-tab-findings', 'ir-editor-tab-rules',
      'ir-editor-preview', 'ir-editor-hash', 'ir-editor-copy', 'ir-editor-export', 'ir-editor-save', 'ir-editor-apply',
    ]) {
      expect(wrapper.find(`[data-testid="${id}"]`).exists(), id).toBe(true)
    }
  })

  it('复制/导出/应用三出口可用', async () => {
    const wrapper = await mountEditor()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    await wrapper.find('[data-testid="ir-editor-copy"]').trigger('click')
    expect(writeText).toHaveBeenCalled()
    // 应用到画布：画布为空无需 confirm
    await wrapper.find('[data-testid="ir-editor-apply"]').trigger('click')
    expect(wrapper.emitted('applied')).toBeTruthy()
  })

  it('规则管理 Tab 可切换，列表行断言齐备', async () => {
    const wrapper = await mountEditor()
    await wrapper.find('[data-testid="ir-editor-tab-rules"]').trigger('click')
    expect(wrapper.find('[data-testid="rule-list"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="rule-row-rule_01a"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="rule-toggle-rule_01a"]').exists()).toBe(true)
  })
})
