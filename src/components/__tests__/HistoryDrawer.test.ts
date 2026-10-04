import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ElDrawer } from 'element-plus'
import HistoryDrawer from '@/components/HistoryDrawer.vue'

// HistoryPanel 依赖 history store 与 db invoke；此处只验证抽屉壳层行为，故 stub 掉面板
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))

beforeEach(() => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})

function mountDrawer(open = false) {
  return mount(HistoryDrawer, {
    props: { open },
    global: { plugins: [createPinia()] },
    attachTo: document.body,
  })
}

describe('HistoryDrawer（need04 右侧收纳抽屉）', () => {
  it('open=false 时不渲染历史面板内容（懒挂载）', async () => {
    const w = mountDrawer(false)
    await w.vm.$nextTick()
    expect(document.body.querySelector('[data-testid="history-panel"]')).toBeNull()
    w.unmount()
  })

  it('open=true 时抽屉存在并挂载历史面板', async () => {
    const w = mountDrawer(true)
    await w.vm.$nextTick()
    expect(document.body.querySelector('[data-testid="history-drawer"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="history-panel"]')).not.toBeNull()
    w.unmount()
  })

  it('关闭按钮派发 update:open=false', async () => {
    const w = mountDrawer(true)
    await w.vm.$nextTick()
    // el-drawer 内容 Teleport 到 body，须从 body 查（R4）
    // need05 v2：只用原生关闭按钮——标题栏有且仅有 1 个原生 ×，手写 × 已删除
    expect(document.body.querySelectorAll('.el-drawer__close-btn').length).toBe(1)
    expect(document.body.querySelector('[data-testid="history-drawer-close"]')).toBeNull()
    // EP 把 update:modelValue 推迟到 afterLeave 才派发，jsdom 下无 CSS transition 不会触发；
    // 此处直接模拟 EP 关抽屉后的上报，验证 openProxy → update:open 透传（真机点击链路走人工验收）。
    const drawer = w.findComponent(ElDrawer)
    expect(drawer.exists()).toBe(true)
    await drawer.vm.$emit('update:modelValue', false)
    await w.vm.$nextTick()
    expect(w.emitted('update:open')).toEqual([[false]])
    w.unmount()
  })

  it('由 open=false 切到 true 后才挂载历史面板', async () => {
    const w = mountDrawer(false)
    await w.vm.$nextTick()
    expect(document.body.querySelector('[data-testid="history-panel"]')).toBeNull()
    await w.setProps({ open: true })
    await w.vm.$nextTick()
    expect(document.body.querySelector('[data-testid="history-panel"]')).not.toBeNull()
    w.unmount()
  })

  it('关闭后再次打开仍保留面板实例（不销毁）', async () => {
    const w = mountDrawer(true)
    await w.vm.$nextTick()
    await w.setProps({ open: false })
    await w.vm.$nextTick()
    await w.setProps({ open: true })
    await w.vm.$nextTick()
    expect(document.body.querySelector('[data-testid="history-panel"]')).not.toBeNull()
    w.unmount()
  })

  it('抽屉标题声明三页签内容', async () => {
    const w = mountDrawer(true)
    await w.vm.$nextTick()
    // 抽屉 header 随 Teleport 挂到 body，w.html() 仅剩 teleport 占位
    expect(document.body.innerHTML).toContain('历史 · 收藏 · 模板')
    w.unmount()
  })
})
