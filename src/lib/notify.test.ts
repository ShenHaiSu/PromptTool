import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { notify, push, registerNotifyHandler, __clearNotifyHandler, type NotifyType } from './notify'

describe('notify（S5 通知统一出口）', () => {
  const handlerMock = vi.fn<(message: string, type: NotifyType, ms?: number) => void>()

  beforeEach(() => {
    handlerMock.mockClear()
    registerNotifyHandler(handlerMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    __clearNotifyHandler()
    vi.restoreAllMocks()
  })

  it('签名与旧 useToast.push(message, type, ms) 完全一致', () => {
    expect(typeof notify).toBe('function')
    expect(push).toBe(notify)
  })

  it('默认 info + 3000ms 透传给已注册 handler', () => {
    notify('hello')
    expect(handlerMock).toHaveBeenCalledWith('hello', 'info', 3000)
  })

  it('success / warning / error 直映类型', () => {
    notify('ok', 'success')
    notify('warn', 'warning')
    notify('bad', 'error')
    expect(handlerMock).toHaveBeenCalledTimes(3)
    const types = handlerMock.mock.calls.map((c) => c[1])
    expect(types).toEqual(['success', 'warning', 'error'])
  })

  it('自定义时长透传', () => {
    notify('custom', 'error', 2500)
    expect(handlerMock).toHaveBeenCalledWith('custom', 'error', 2500)
  })

  it('未注册 handler 时降级 console 且不抛错', () => {
    __clearNotifyHandler()
    expect(() => notify('fallback-info')).not.toThrow()
    expect(() => notify('fallback-err', 'error')).not.toThrow()
    expect(console.log).toHaveBeenCalledWith('[notify]', 'info', 'fallback-info')
    expect(console.error).toHaveBeenCalledWith('[notify]', 'fallback-err')
  })

  it('handler 抛错时降级 console 且不抛错', () => {
    registerNotifyHandler(() => { throw new Error('ep boom') })
    expect(() => notify('x', 'error')).not.toThrow()
    expect(console.error).toHaveBeenCalled()
  })
})
