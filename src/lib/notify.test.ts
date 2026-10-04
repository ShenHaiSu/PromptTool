import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const messageMock = vi.fn()

vi.mock('element-plus', () => ({
  ElMessage: (opts: unknown) => messageMock(opts),
}))

import { notify, push } from './notify'

describe('notify（S5 通知统一出口）', () => {
  beforeEach(() => {
    messageMock.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('签名与旧 useToast.push(message, type, ms) 完全一致', () => {
    expect(typeof notify).toBe('function')
    expect(push).toBe(notify)
  })

  it('默认 info + 3000ms 透传给 ElMessage', async () => {
    notify('hello')
    await vi.waitFor(() => expect(messageMock).toHaveBeenCalled())
    expect(messageMock).toHaveBeenCalledWith(expect.objectContaining({ message: 'hello', type: 'info', duration: 3000 }))
  })

  it('success / warning / error 直映 EP 类型', async () => {
    notify('ok', 'success')
    notify('warn', 'warning')
    notify('bad', 'error')
    await vi.waitFor(() => expect(messageMock).toHaveBeenCalledTimes(3))
    const types = messageMock.mock.calls.map((c) => (c[0] as { type: string }).type)
    expect(types).toEqual(['success', 'warning', 'error'])
  })

  it('自定义时长透传，error 带关闭按钮', async () => {
    notify('custom', 'error', 2500)
    await vi.waitFor(() => expect(messageMock).toHaveBeenCalled())
    expect(messageMock).toHaveBeenCalledWith(expect.objectContaining({ duration: 2500, showClose: true }))
  })
})