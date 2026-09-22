/**
 * F2 §6：ImageTaskCard 测试（五态 Badge / 失败重试 / running 删除禁用 / 复制 toast）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  convertFileSrc: (p: string) => `file://${p}`,
}))

vi.mock('@/lib/db', () => ({
  dbRevealInExplorer: vi.fn().mockResolvedValue(undefined),
}))

import ImageTaskCard from '../ImageTaskCard.vue'
import type { ImageTaskView } from '@/lib/imageQueueApi'

function task(patch: Partial<ImageTaskView> = {}): ImageTaskView {
  return {
    id: 't1',
    prompt: 'a small glass cube on a white studio background, product photo',
    irHash: null,
    size: '1K',
    ratio: '1:1',
    status: 'queued',
    retryCount: 0,
    createdAt: Date.now(),
    ...patch,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockInvoke.mockReset()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
})

describe('五态 Badge', () => {
  it.each([
    ['queued', '排队'],
    ['running', '生成中'],
    ['succeeded', '成功'],
    ['failed', '失败'],
    ['cancelled', '已取消'],
  ])('%s → %s', (status, label) => {
    const w = mount(ImageTaskCard, {
      props: { model: task({ status: status as ImageTaskView['status'] }) },
      global: { plugins: [createPinia()] },
    })
    expect(w.text()).toContain(label)
  })
})

describe('失败重试按钮', () => {
  it('failed 态有重试按钮，queued 态无', () => {
    const failed = mount(ImageTaskCard, {
      props: { model: task({ id: 'f1', status: 'failed', error: 'boom' }) },
      global: { plugins: [createPinia()] },
    })
    expect(failed.find('[data-testid="image-task-retry-f1"]').exists()).toBe(true)
    expect(failed.text()).toContain('boom')

    const queued = mount(ImageTaskCard, {
      props: { model: task({ id: 'q1', status: 'queued' }) },
      global: { plugins: [createPinia()] },
    })
    expect(queued.find('[data-testid="image-task-retry-q1"]').exists()).toBe(false)
  })
})

describe('running 删除禁用', () => {
  it('running 态删除按钮 disabled 且 title 提示先停止', () => {
    const w = mount(ImageTaskCard, {
      props: { model: task({ id: 'r1', status: 'running' }) },
      global: { plugins: [createPinia()] },
    })
    const btn = w.find('[data-testid="image-task-remove-r1"]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    expect(btn.attributes('title')).toContain('请先停止')
  })
})

describe('复制成功 toast', () => {
  it('点击复制调用 clipboard 且不抛错', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const w = mount(ImageTaskCard, {
      props: { model: task({ id: 'c1', status: 'succeeded' }) },
      global: { plugins: [createPinia()] },
    })
    await w.find('[data-testid="image-task-copy-c1"]').trigger('click')
    expect(writeText).toHaveBeenCalled()
  })
})

describe('整卡点击拉起顶层 Dialog（方案 B）', () => {
  it('点击卡片本体打开 dialog，读到内嵌 meta', async () => {
    mockInvoke.mockImplementation((cmd: unknown) => {
      if (cmd === 'iq_read_image_meta') {
        return Promise.resolve({
          prompt: 'a cat',
          irHash: null,
          size: '1K',
          ratio: '1:1',
          model: 'agnes-image-2.5-flash',
          imageUrl: 'https://x/y.png',
          elapsedMs: 1,
          createdAt: 1,
          taskId: 'd1',
        })
      }
      return Promise.reject(new Error(`unexpected invoke ${String(cmd)}`))
    })
    const { useImageTaskDialog } = await import('@/composables/useImageTaskDialog')
    const dialog = useImageTaskDialog()
    const w = mount(ImageTaskCard, {
      props: { model: task({ id: 'd1', status: 'succeeded', filePath: 'C:/pics/a.png' }) },
      global: { plugins: [createPinia()] },
    })
    await w.find('[data-testid="image-task-d1"]').trigger('click')
    await Promise.resolve()
    await Promise.resolve()
    expect(dialog.opened.value).toBe(true)
    expect(dialog.embedded.value?.prompt).toBe('a cat')
    dialog.close()
  })

  it('卡内按钮点击不冒泡拉起 dialog', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { useImageTaskDialog } = await import('@/composables/useImageTaskDialog')
    const dialog = useImageTaskDialog()
    const w = mount(ImageTaskCard, {
      props: { model: task({ id: 's1', status: 'succeeded', filePath: 'C:/pics/a.png' }) },
      global: { plugins: [createPinia()] },
    })
    await w.find('[data-testid="image-task-copy-s1"]').trigger('click')
    expect(writeText).toHaveBeenCalled()
    expect(dialog.opened.value).toBe(false)
    expect(mockInvoke).not.toHaveBeenCalledWith('iq_read_image_meta', expect.anything())
  })
})
