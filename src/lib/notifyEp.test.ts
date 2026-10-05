import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const messageMock = vi.fn()

vi.mock('element-plus', () => ({
  ElMessage: (opts: unknown) => messageMock(opts),
}))

describe('notifyEp（EP 通知适配器）', () => {
  beforeEach(() => {
    messageMock.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('把总线通知映射为 ElMessage（含 error 关闭按钮与默认时长）', async () => {
    const { notify } = await import('./notify')
    await import('./notifyEp')
    notify('hello')
    expect(messageMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'hello', type: 'info', duration: 3000 }),
    )
    notify('bad', 'error', 2500)
    expect(messageMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'bad', type: 'error', duration: 2500, showClose: true }),
    )
  })
})
