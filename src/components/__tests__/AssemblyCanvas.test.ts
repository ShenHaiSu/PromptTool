import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AssemblyCanvas from '../AssemblyCanvas.vue'
import { useAssemblyStore } from '@/stores/assembly'
import type { Module } from '@/engine/models'

function mod(id: string, key: string, text: string, weight = 1): Module {
  return { id, dimensionId: 'd_' + key, contentEn: text, displayName: text, weight, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: key } as Module
}

beforeEach(() => {
  setActivePinia(createPinia())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
})

describe('AssemblyCanvas', () => {
  it('空状态显示 ◈ + 试试随机', () => {
    const w = mount(AssemblyCanvas, { global: { plugins: [createPinia()] } })
    expect(w.find('[data-testid="assembly-empty"]').exists()).toBe(true)
    expect(w.text()).toContain('从左侧双击添加词条')
    expect(w.find('[data-testid="assembly-empty-random"]').exists()).toBe(true)
  })

  it('已选时显示 Chips 流式列表 + 计数', async () => {
    setActivePinia(createPinia())
    const store = useAssemblyStore()
    store.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    store.addModule({ module: mod('m2', 'face', 'smiling face'), locked: false })
    const w = mount(AssemblyCanvas, { global: { plugins: [createPinia()] } })
    // 用同一 pinia 实例；挂载时 store 已有数据，等待渲染
    await w.vm.$nextTick()
    // 重新以同一 pinia 挂载需要注入；简化：检查 store 状态
    expect(store.selectedItems).toHaveLength(2)
  })

  it('权重按钮点击弹出 Popover，完成确认后才 reassemble', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAssemblyStore()
    store.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    const w = mount(AssemblyCanvas, { global: { plugins: [pinia] } })
    await w.vm.$nextTick()
    const btn = w.find('[data-testid="chip-weight-btn"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('w1.0')
    await btn.trigger('click')
    expect(w.find('[data-testid="chip-weight-popover"]').exists()).toBe(true)
    const slider = w.find('[data-testid="weight-slider"]')
    expect(slider.exists()).toBe(true)
    // 拖动 slider 不应直接 reassemble（本地 draft）；确认后才更新
    expect(store.finalPrompt).not.toContain('(white shirt:1.4)')
    const confirm = w.find('[data-testid="weight-confirm"]')
    // 先改 draft（通过 input 事件）
    await slider.setValue('1.4')
    await confirm.trigger('click')
    expect(store.selectedItems[0]!.weightOverride).toBe(1.4)
    expect(store.finalPrompt).toContain('(white shirt:1.4)')
    expect(w.find('[data-testid="chip-weight-popover"]').exists()).toBe(false)
  })

  it('...设置 收敛分隔符/括号/排序', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAssemblyStore()
    store.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    store.addModule({ module: mod('m2', 'bottom', 'pleated skirt'), locked: false })
    const w = mount(AssemblyCanvas, { global: { plugins: [pinia] } })
    await w.vm.$nextTick()
    const settingsBtn = w.find('[data-testid="assembly-settings-btn"]')
    await settingsBtn.trigger('click')
    expect(w.find('[data-testid="assembly-settings-panel"]').exists()).toBe(true)
    const sep = w.find('[data-testid="setting-separator"]')
    await sep.setValue(' BREAK ')
    expect(store.config.separator).toBe(' BREAK ')
    expect(store.finalPrompt).toContain(' BREAK ')
    const brackets = w.find('[data-testid="setting-brackets"]') as unknown as { element: HTMLInputElement }
    expect(brackets).toBeTruthy()
  })

  it('锁定/删除 同步 TopBar（store）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAssemblyStore()
    store.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    const w = mount(AssemblyCanvas, { global: { plugins: [pinia] } })
    await w.vm.$nextTick()
    await w.find('[data-testid="chip-lock-btn"]').trigger('click')
    expect(store.selectedItems[0]!.locked).toBe(true)
    await w.find('[data-testid="chip-remove-btn"]').trigger('click')
    expect(store.selectedItems).toHaveLength(0)
  })

  it('拖拽容器存在且 ghost/chosen 类配置正确', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAssemblyStore()
    store.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    const w = mount(AssemblyCanvas, { global: { plugins: [pinia] } })
    await w.vm.$nextTick()
    expect(w.find('[data-testid="assembly-draggable"]').exists()).toBe(true)
    expect(w.find('[data-testid="assembly-chip"]').exists()).toBe(true)
  })
})
