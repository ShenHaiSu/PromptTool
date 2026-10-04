import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./notify', () => ({ notify: vi.fn(), push: vi.fn() }))

import { logger } from './logger'
import { notify } from './notify'

describe('logger（S5 错误收敛出口）', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(notify).mockClear()
  })

  it('warn 透出 console 且带模块名', () => {
    logger.warn('demo', '出错了', { a: 1 })
    expect(console.warn).toHaveBeenCalledWith('[demo]', '出错了', { a: 1 })
  })

  it('error 透出 console.error', () => {
    logger.error('demo', '崩了')
    expect(console.error).toHaveBeenCalledWith('[demo]', '崩了')
  })

  it('warnSilent 用于用户无感知的后台失败（只 console.warn，不弹通知）', () => {
    logger.warnSilent('demo', '保存草稿', new Error('x'))
    expect(console.warn).toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('fail 用于用户动作失败：console.error + notify(error)', () => {
    logger.fail('demo', '保存失败', new Error('disk full'))
    expect(console.error).toHaveBeenCalledWith('[demo] 保存失败：', expect.any(Error))
    expect(notify).toHaveBeenCalledWith('保存失败', 'error')
  })
})