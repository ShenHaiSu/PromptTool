/**
 * ImageMetaPanel 测试：点选 / drop / None-Err 空态 / 复制按钮。
 * mock 口径抄 ImageTaskDetailDialog.test.ts#52。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const mockInvoke = vi.fn()
const mockDialogOpen = vi.fn()

 vi.mock('@tauri-apps/api/core', () => ({
   invoke: (...args: unknown[]) => mockInvoke(...args),
 }))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => mockDialogOpen(...args),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: vi.fn().mockResolvedValue(undefined),
  open: vi.fn().mockResolvedValue(undefined),
}))

import ImageMetaPanel from '../ImageMetaPanel.vue'

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

async function flush(w: ReturnType<typeof mount>): Promise<void> {
  await new Promise((r) => setTimeout(r, 10))
  await w.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 10))
  await w.vm.$nextTick()
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockInvoke.mockReset()
  mockDialogOpen.mockReset()
  mockInvoke.mockImplementation((cmd: unknown) => {
    if (cmd === 'iq_read_image_meta') return Promise.resolve({ ...META })
    if (cmd === 'iq_enqueue') return Promise.resolve(['new-id'])
    if (cmd === 'db_reveal_in_explorer') return Promise.resolve(undefined)
    return Promise.reject(new Error(`unexpected invoke ${String(cmd)}`))
  })
  mockDialogOpen.mockResolvedValue(null)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

describe('ImageMetaPanel 空态与点选', () => {
  it('初始为空态 meta-empty，含 dropzone', async () => {
    const w = mount(ImageMetaPanel, { global: { plugins: [createPinia()] } })
    await flush(w)
    expect(w.find('[data-testid="meta-dropzone"]').exists()).toBe(true)
    expect(w.find('[data-testid="meta-empty"]').exists()).toBe(true)
    w.unmount()
  })

   it('点选 mock dialog 返回路径 → 调 readImageMeta → 成功态含 prompt 与模型', async () => {
     mockDialogOpen.mockResolvedValueOnce('C:/pics/a.png')
     const w = mount(ImageMetaPanel, { global: { plugins: [createPinia()] } })
     await flush(w)
     await w.find('[data-testid="meta-dropzone"]').trigger('click')
     await flush(w)
     expect(mockDialogOpen).toHaveBeenCalled()
     expect(mockInvoke).toHaveBeenCalledWith('iq_read_image_meta', expect.objectContaining({ filePath: 'C:/pics/a.png' }))
     expect(w.find('[data-testid="meta-prompt"]').text()).toContain('a small glass cube')
     expect(w.find('[data-testid="meta-model"]').text()).toContain('agnes-image-2.5-flash')
     w.unmount()
   })

   it('Web File 降级走 meta-none 提示', async () => {
     const w = mount(ImageMetaPanel, { global: { plugins: [createPinia()] } })
     await flush(w)
     // 经隐藏 input 模拟 Web FileList：无预览能力，仅提示用桌面端
     const file = new File(['x'], 'outer.png', { type: 'image/png' })
     const input = w.find('[data-testid="meta-file-input"]')
     Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
     await input.trigger('change')
     await flush(w)
     expect(w.find('[data-testid="meta-none"]').exists()).toBe(true)
     w.unmount()
   })

   it('None → meta-none（外部图/未嵌入提示）', async () => {
    mockInvoke.mockImplementation((cmd: unknown) => {
      if (cmd === 'iq_read_image_meta') return Promise.resolve(null)
      return Promise.reject(new Error(`unexpected ${String(cmd)}`))
    })
    mockDialogOpen.mockResolvedValueOnce('C:/pics/outer.png')
    const w = mount(ImageMetaPanel, { global: { plugins: [createPinia()] } })
    await flush(w)
    await w.find('[data-testid="meta-dropzone"]').trigger('click')
    await flush(w)
    expect(w.find('[data-testid="meta-none"]').exists()).toBe(true)
    expect(w.text()).toContain('无内嵌生图参数')
    w.unmount()
  })

  it('Err → meta-error + 重试按钮', async () => {
    mockInvoke.mockImplementation((cmd: unknown) => {
      if (cmd === 'iq_read_image_meta') return Promise.reject(new Error('截断'))
      return Promise.reject(new Error(`unexpected ${String(cmd)}`))
    })
    mockDialogOpen.mockResolvedValueOnce('C:/pics/bad.png')
    const w = mount(ImageMetaPanel, { global: { plugins: [createPinia()] } })
    await flush(w)
    await w.find('[data-testid="meta-dropzone"]').trigger('click')
    await flush(w)
    expect(w.find('[data-testid="meta-error"]').exists()).toBe(true)
    expect(w.find('[data-testid="meta-retry"]').exists()).toBe(true)
    w.unmount()
  })

  it('复制prompt 按钮调 clipboard', async () => {
    mockDialogOpen.mockResolvedValueOnce('C:/pics/a.png')
    const w = mount(ImageMetaPanel, { global: { plugins: [createPinia()] } })
    await flush(w)
    await w.find('[data-testid="meta-dropzone"]').trigger('click')
    await flush(w)
    await w.find('[data-testid="meta-copy-prompt"]').trigger('click')
    await flush(w)
    expect(navigator.clipboard.writeText).toHaveBeenCalled()
    w.unmount()
  })
})
