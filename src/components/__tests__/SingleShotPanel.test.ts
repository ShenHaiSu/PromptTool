import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, type DOMWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SingleShotPanel from '../SingleShotPanel.vue'
import { useImageQueueStore } from '@/stores/imageQueue'

vi.mock('@/lib/db', () => ({
  dbRevealInExplorer: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/imageQueueApi', () => ({
  iqGetResolvedOutputDir: vi.fn().mockResolvedValue('D:/out'),
}))

vi.mock('@/lib/statsApi', () => ({
  iqGenerateOnePreview: vi.fn().mockResolvedValue({
    imageBase64: 'AAAA', mime: 'image/png', elapsedMs: 1200,
  }),
  iqSavePreview: vi.fn().mockResolvedValue({ filename: 'a.png', filePath: 'D:/out/a.png' }),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

function mountPanel() {
  const pinia = createPinia()
  setActivePinia(pinia)
  // 放行 API 密钥校验，否则「生成」会被守卫拦下
  const iq = useImageQueueStore()
  iq.config.apiKeyState = 'set'
  iq.config.apiKey = 'test-key'
  return mount(SingleShotPanel, { global: { plugins: [pinia] } })
}

describe('SingleShotPanel 上下两栏布局', () => {
  it('上栏配置区与下栏图片舞台并存，且旧 testid 契约不丢', async () => {
    const w = mountPanel()
    await w.vm.$nextTick()
    expect(w.find('[data-testid="single-shot-panel"]').exists()).toBe(true)
    // 上栏
    expect(w.find('[data-testid="single-shot-config"]').exists()).toBe(true)
    expect(w.find('[data-testid="single-shot-prompt"]').exists()).toBe(true)
    expect(w.find('[data-testid="single-shot-size"]').exists()).toBe(true)
    expect(w.find('[data-testid="single-shot-ratio"]').exists()).toBe(true)
    expect(w.find('[data-testid="single-shot-output"]').exists()).toBe(true)
    expect(w.find('[data-testid="single-shot-generate"]').exists()).toBe(true)
    expect(w.find('[data-testid="single-shot-save"]').exists()).toBe(true)
    expect(w.find('[data-testid="single-shot-reset"]').exists()).toBe(true)
    // 分隔条 + 下栏舞台
    expect(w.find('[data-testid="single-shot-sash"]').exists()).toBe(true)
    expect(w.find('[data-testid="single-shot-stage"]').exists()).toBe(true)
  })

  it('下栏占据剩余空间：舞台为 flex-1 且 min-h-0，配置区为固定比例', async () => {
    const w = mountPanel()
    await w.vm.$nextTick()
    const stage = w.find('[data-testid="single-shot-stage"]')
    expect(stage.classes()).toContain('flex-1')
    expect(stage.classes()).toContain('min-h-0')
    const config = w.find('[data-testid="single-shot-config"]')
    expect(config.attributes('style')).toContain('height: 40')
  })

  it('无预览时展示空态且无预览图', async () => {
    const w = mountPanel()
    await w.vm.$nextTick()
    expect(w.find('[data-testid="single-shot-empty"]').exists()).toBe(true)
    expect(w.find('[data-testid="single-shot-preview"]').exists()).toBe(false)
  })

  it('尺寸/比例选项由 IQ_SIZES / IQ_RATIOS 常量渲染', async () => {
    const w = mountPanel()
    await w.vm.$nextTick()
    const sizes = w.find('[data-testid="single-shot-size"]').findAll('option').map((o) => o.text())
    const ratios = w.find('[data-testid="single-shot-ratio"]').findAll('option').map((o) => o.text())
    expect(sizes).toEqual(['1K', '2K', '3K', '4K'])
    expect(ratios).toEqual(['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'])
  })
})

describe('SingleShotPanel 图片缩放交互', () => {
  async function mountWithPreview() {
    const w = mountPanel()
    await w.vm.$nextTick()
    await w.find('[data-testid="single-shot-prompt"]').setValue('a cat')
    await w.find('[data-testid="single-shot-generate"]').trigger('click')
    await w.vm.$nextTick()
    await w.vm.$nextTick()
    return w
  }

  /** jsdom 不解码图片，naturalWidth 恒为 0，需手动模拟已加载状态 */
  function simulateImageLoad(img: DOMWrapper<Element>, w = 1000, h = 1000): void {
    const el = img.element as HTMLImageElement
    Object.defineProperty(el, 'naturalWidth', { value: w, configurable: true })
    Object.defineProperty(el, 'naturalHeight', { value: h, configurable: true })
    el.dispatchEvent(new Event('load'))
  }

  it('生成后渲染预览图与缩放工具条', async () => {
    const w = await mountWithPreview()
    expect(w.find('[data-testid="single-shot-preview"]').exists()).toBe(true)
    expect(w.find('[data-testid="single-shot-zoom-fit"]').exists()).toBe(true)
    expect(w.find('[data-testid="single-shot-zoom-label"]').exists()).toBe(true)
  })

  it('滚轮放大提升缩放比，点击重置回到 100%', async () => {
    const w = await mountWithPreview()
    simulateImageLoad(w.find('[data-testid="single-shot-preview"]'))
    await w.vm.$nextTick()

    const stage = w.find('[data-testid="single-shot-stage"]')
    expect(w.find('[data-testid="single-shot-zoom-label"]').text()).toBe('100%')

    stage.element.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -100, clientX: 0, clientY: 0, bubbles: true, cancelable: true }),
    )
    await w.vm.$nextTick()
    expect(w.find('[data-testid="single-shot-zoom-label"]').text()).not.toBe('100%')

    await w.find('[data-testid="single-shot-zoom-reset"]').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="single-shot-zoom-label"]').text()).toBe('100%')
  })

  it('左键拖拽改变图片位移', async () => {
    const w = await mountWithPreview()
    const img = w.find('[data-testid="single-shot-preview"]')
    simulateImageLoad(img)
    await w.vm.$nextTick()

    const stage = w.find('[data-testid="single-shot-stage"]')
    const styleBefore = img.attributes('style') ?? ''
    // jsdom 无 PointerEvent 构造器，用 MouseEvent 派发同名事件
    stage.element.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 100, bubbles: true }))
    stage.element.dispatchEvent(new MouseEvent('pointermove', { clientX: 160, clientY: 130, bubbles: true }))
    await w.vm.$nextTick()
    const styleAfter = img.attributes('style') ?? ''
    expect(styleAfter).not.toBe(styleBefore)
    expect(styleAfter).toContain('translate3d(60px, 30px, 0)')
    stage.element.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
  })

  it('重来丢弃预览并清空已保存信息', async () => {
    const w = await mountWithPreview()
    expect(w.find('[data-testid="single-shot-preview"]').exists()).toBe(true)
    await w.find('[data-testid="single-shot-reset"]').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="single-shot-preview"]').exists()).toBe(false)
    expect(w.find('[data-testid="single-shot-empty"]').exists()).toBe(true)
  })
})
