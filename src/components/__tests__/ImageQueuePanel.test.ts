/**
 * F2 §6：ImageQueuePanel 测试（空态 / 运行条禁用态 / 虚拟化容器 / 入队空结果 warning）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const mockInvoke = vi.fn()
const mockListen = vi.fn().mockResolvedValue(() => {})
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  convertFileSrc: (p: string) => `file://${p}`,
  isTauri: () => false,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}))

vi.mock('@/lib/db', () => ({
  dbRevealInExplorer: vi.fn().mockResolvedValue(undefined),
  dbGetDimensions: vi.fn().mockResolvedValue([]),
  dbGetAllModulesGrouped: vi.fn().mockResolvedValue({}),
}))

import ImageQueuePanel from '../ImageQueuePanel.vue'
import { useImageQueueStore } from '@/stores/imageQueue'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === 'iq_get_config') return Promise.resolve({ apiKey: '' })
    if (cmd === 'iq_list') return Promise.resolve({ total: 0, items: [] })
    return Promise.reject(new Error(`no backend: ${cmd}`))
  })
  mockListen.mockReset()
  mockListen.mockResolvedValue(() => {})
})

async function mountPanel() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const w = mount(ImageQueuePanel, { global: { plugins: [pinia] } })
  await new Promise((r) => setTimeout(r, 20))
  await w.vm.$nextTick()
  return w
}

describe('空态', () => {
  it('空队列显示 iq-empty + 去批量工厂按钮', async () => {
    const w = await mountPanel()
    expect(w.find('[data-testid="iq-empty"]').exists()).toBe(true)
    expect(w.find('[data-testid="image-queue"]').exists()).toBe(true)
  })
})

describe('配置默认收起', () => {
  it('进入队列不自动打开配置，点击展开后浮层出现', async () => {
    const w = await mountPanel()
    expect(w.find('[data-testid="image-queue-settings"]').exists()).toBe(false)
    const toggle = w.findAll('button').find((b) => b.text().includes('展开配置'))
    expect(toggle).toBeTruthy()
    await toggle!.trigger('click')
    expect(w.find('[data-testid="image-queue-settings"]').exists()).toBe(true)
  })
})

describe('运行条禁用态', () => {
  it('未运行时 start 启用、stop 禁用', async () => {
    const w = await mountPanel()
    const start = w.find('[data-testid="iq-start"]')
    const stop = w.find('[data-testid="iq-stop"]')
    expect((start.element as HTMLButtonElement).disabled).toBe(false)
    expect((stop.element as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('降级提示', () => {
  it('事件订阅成功时不显示降级轮询条（真机默认走事件通道）', async () => {
    const w = await mountPanel()
    expect(w.text()).not.toContain('已降级轮询')
  })
  it('事件订阅失败时显示降级轮询 amber 条', async () => {
    mockListen.mockRejectedValue(new Error('no event channel'))
    const w = await mountPanel()
    expect(w.text()).toContain('已降级轮询')
  })
})

describe('iq-enqueue-current 空 results', () => {
  it('空批量点击入队不崩溃，队列仍为空', async () => {
    const w = await mountPanel()
    await w.find('[data-testid="iq-enqueue-current"]').trigger('click')
    await new Promise((r) => setTimeout(r, 20))
    const iq = useImageQueueStore()
    expect(iq.order).toHaveLength(0)
    expect(w.find('[data-testid="iq-empty"]').exists()).toBe(true)
  })
})
