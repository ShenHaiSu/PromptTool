/**
 * ImageTaskDetailDialog 测试：顶层 Dialog 展示 / 一键复用下单 / 关闭。
 * Teleport 到 body：断言挂载到 document.body 的内容。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  convertFileSrc: (p: string) => `file://${p}`,
  isTauri: () => false,
}))

import ImageTaskDetailDialog from '../ImageTaskDetailDialog.vue'
import { useImageTaskDialog } from '@/composables/useImageTaskDialog'
import type { ImageTaskView } from '@/lib/imageQueueApi'

const META = {
  prompt: 'a small glass cube',
  irHash: null,
  size: '2K',
  ratio: '16:9',
  model: 'agnes-image-2.5-flash',
  imageUrl: 'https://x/y.png',
  elapsedMs: 1000,
  createdAt: 1720000000,
  taskId: 'd1',
}

function task(): ImageTaskView {
  return {
    id: 'd1',
    prompt: 'a small glass cube',
    irHash: null,
    size: '2K',
    ratio: '16:9',
    status: 'succeeded',
    imageUrl: 'https://x/y.png',
    filePath: 'C:/pics/a.png',
    elapsedMs: 1000,
    retryCount: 0,
    createdAt: 1720000000,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((cmd: unknown) => {
    if (cmd === 'iq_read_image_meta') return Promise.resolve({ ...META })
    if (cmd === 'iq_enqueue') {
      return Promise.resolve([{ taskId: 'new-id', skipped: false }])
    }
    return Promise.reject(new Error(`unexpected invoke ${String(cmd)}`))
  })
  useImageTaskDialog().close()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
})

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('顶层 Dialog 展示', () => {
  it('open 后 Teleport 内容出现在 body，含内嵌字段', async () => {
    const dialog = useImageTaskDialog()
    const w = mount(ImageTaskDetailDialog, {
      global: { plugins: [createPinia()] },
      attachTo: document.body,
    })
    expect(document.body.querySelector('[data-testid="image-task-detail-dialog"]')).toBeNull()
    await dialog.open(task())
    await flush()
    await w.vm.$nextTick()
    const root = document.body.querySelector('[data-testid="image-task-detail-dialog"]')
    expect(root).not.toBeNull()
    expect(root!.textContent).toContain('2K')
    expect(root!.textContent).toContain('a small glass cube')
    w.unmount()
    dialog.close()
  })

  it('无内嵌（null）时 toast 并自动关闭', async () => {
    mockInvoke.mockImplementation((cmd: unknown) => {
      if (cmd === 'iq_read_image_meta') return Promise.resolve(null)
      return Promise.reject(new Error(`unexpected invoke ${String(cmd)}`))
    })
    const dialog = useImageTaskDialog()
    mount(ImageTaskDetailDialog, {
      global: { plugins: [createPinia()] },
      attachTo: document.body,
    })
    await dialog.open(task())
    await flush()
    expect(dialog.opened.value).toBe(false)
    expect(document.body.querySelector('[data-testid="image-task-detail-dialog"]')).toBeNull()
  })
})

describe('一键复用下单', () => {
  it('复用按钮把 prompt/size/ratio 回填入队并关闭', async () => {
    const dialog = useImageTaskDialog()
    const w = mount(ImageTaskDetailDialog, {
      global: { plugins: [createPinia()] },
      attachTo: document.body,
    })
    await dialog.open(task())
    await flush()
    await w.vm.$nextTick()
    const reuse = document.body.querySelector('[data-testid="image-task-reuse"]') as HTMLElement
    expect(reuse).not.toBeNull()
    reuse.click()
    await flush()
    await flush()
    // iq_enqueue 被调且带上复用的 size/ratio
    expect(mockInvoke).toHaveBeenCalledWith(
      'iq_enqueue',
      expect.objectContaining({
        items: [{ prompt: 'a small glass cube', irHash: null, size: '2K', ratio: '16:9' }],
      }),
    )
    expect(dialog.opened.value).toBe(false)
    w.unmount()
  })
})
