/**
 * need03 S6：stores/imageQueue.config 配置域（load/save/dirty/testing/testConnection 分支）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockInvokeOk, tauriApiMock } from '@/tests/tauri-mock'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => tauriApiMock(invoke))

const { notifyMock } = vi.hoisted(() => ({ notifyMock: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify: notifyMock }))

import { useImageQueueConfigDomain } from '../imageQueue.config'
import { IQ_DEFAULT_CONFIG, IQ_KEY_SET_PLACEHOLDER, IQ_LOCAL_CACHE_KEY, type ImageQueueConfig } from '@/lib/imageQueue'

function validView(patch: Record<string, unknown> = {}) {
  return {
    protocol: 'agnes',
    model: IQ_DEFAULT_CONFIG.model,
    apiBase: 'https://api.example.com/',
    apiKey: 'sk-live-123',
    proxyOn: false,
    proxyUrl: '',
    size: '1K',
    ratio: '1:1',
    concurrency: 2,
    connectTimeoutSecs: IQ_DEFAULT_CONFIG.connectTimeoutSecs,
    totalTimeoutSecs: IQ_DEFAULT_CONFIG.totalTimeoutSecs,
    ...patch,
  }
}

beforeEach(() => {
  invoke.mockReset()
  notifyMock.mockReset()
  localStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('imageQueue.config 初始状态', () => {
  it('初始 config 为默认值，dirty/testing/testResult 为初始态', () => {
    const d = useImageQueueConfigDomain()
    expect(d.config.value).toEqual(IQ_DEFAULT_CONFIG)
    expect(d.dirty.value).toBe(false)
    expect(d.testing.value).toBe(false)
    expect(d.testResult.value).toBeNull()
    expect(d.keyTouched.value).toBe(false)
    expect(d.proxyTouched.value).toBe(false)
    expect(d.lastRandomMode.value).toEqual({ usePartial: false, allowNsfw: false })
  })

  it('markDirty / markKeyTouched / markProxyTouched 都置 dirty', () => {
    const d = useImageQueueConfigDomain()
    d.markDirty()
    expect(d.dirty.value).toBe(true)
    d.dirty.value = false
    d.markKeyTouched()
    expect(d.keyTouched.value).toBe(true)
    expect(d.dirty.value).toBe(true)
    d.dirty.value = false
    d.markProxyTouched()
    expect(d.proxyTouched.value).toBe(true)
    expect(d.dirty.value).toBe(true)
  })
})

describe('imageQueue.config loadConfig', () => {
  it('后端正常回包时覆盖默认值并清 dirty/touched', async () => {
    invoke.mockImplementationOnce(mockInvokeOk(validView({ apiBase: 'https://api.example.com/v1' })))
    const d = useImageQueueConfigDomain()
    d.markKeyTouched()
    await d.loadConfig()
    expect(invoke.mock.calls[0]![0]).toBe('iq_get_config')
    expect(d.config.value.apiBase).toBe('https://api.example.com/v1')
    expect(d.config.value.apiKeyState).toBe('set')
    expect(d.keyTouched.value).toBe(false)
    expect(d.proxyTouched.value).toBe(false)
    expect(d.dirty.value).toBe(false)
  })

  it('无缓存时后端失败降级保留默认值且不抛', async () => {
    invoke.mockRejectedValueOnce(new Error('cfg boom'))
    const d = useImageQueueConfigDomain()
    await expect(d.loadConfig()).resolves.toBeUndefined()
    expect(d.config.value).toEqual(IQ_DEFAULT_CONFIG)
    expect(d.dirty.value).toBe(false)
  })

  it('先读本地缓存（脱敏 key/proxy 不回填）再拉后端', async () => {
    localStorage.setItem(
      IQ_LOCAL_CACHE_KEY,
      JSON.stringify({ concurrency: 5, apiKey: 'sk-stale', proxyUrl: 'http://127.0.0.1:1', apiKeyState: 'unset' }),
    )
    invoke.mockImplementationOnce(mockInvokeOk(validView()))
    const d = useImageQueueConfigDomain()
    // 后端失败时才能观察缓存效果
    invoke.mockReset()
    invoke.mockRejectedValueOnce(new Error('cfg boom'))
    await d.loadConfig()
    expect(d.config.value.concurrency).toBe(5)
    expect(d.config.value.apiKey).toBe('')
    expect(d.config.value.proxyUrl).toBe('')
  })

  it('缓存串非法 JSON 时只告警不抛', async () => {
    localStorage.setItem(IQ_LOCAL_CACHE_KEY, '{bad json')
    invoke.mockImplementationOnce(mockInvokeOk(validView()))
    const d = useImageQueueConfigDomain()
    await expect(d.loadConfig()).resolves.toBeUndefined()
    expect(d.config.value.apiBase).toBe('https://api.example.com/')
  })
})

describe('imageQueue.config saveConfig', () => {
  it('成功保存：去尾斜杠、清 dirty/touched、写本地缓存', async () => {
    const d = useImageQueueConfigDomain()
    d.config.value = { ...IQ_DEFAULT_CONFIG, apiBase: 'https://api.example.com///' } as ImageQueueConfig
    invoke.mockImplementationOnce(mockInvokeOk(validView({ apiKey: IQ_KEY_SET_PLACEHOLDER })))
    const ok = await d.saveConfig()
    expect(ok).toBe(true)
    // 后端回包以 apiBase='https://api.example.com/' 覆盖，验证的是送出的 payload 已去尾斜杠
    expect((invoke.mock.calls[0]![1] as { cfg: { apiBase: string } }).cfg.apiBase).toBe('https://api.example.com')
    expect(d.dirty.value).toBe(false)
    expect(d.keyTouched.value).toBe(false)
    expect(notifyMock).toHaveBeenCalledWith('生图配置已保存', 'success', 1500)
    const cached = JSON.parse(localStorage.getItem(IQ_LOCAL_CACHE_KEY)!)
    expect(cached.apiKey).toBeUndefined()
  })

  it('proxyTouched 且非空时去尾斜杠', async () => {
    const d = useImageQueueConfigDomain()
    d.config.value = {
      ...IQ_DEFAULT_CONFIG,
      proxyOn: true,
      proxyUrl: 'http://127.0.0.1:10808//',
    } as ImageQueueConfig
    d.markProxyTouched()
    invoke.mockImplementationOnce(mockInvokeOk(validView({ proxyUrl: IQ_KEY_SET_PLACEHOLDER })))
    await d.saveConfig()
    expect((invoke.mock.calls[0]![1] as { cfg: { proxyUrl: string } }).cfg.proxyUrl).toBe('http://127.0.0.1:10808')
  })

  it('proxyTouched 但空串时不去尾斜杠（保持原值）', async () => {
    const d = useImageQueueConfigDomain()
    d.config.value = { ...IQ_DEFAULT_CONFIG } as ImageQueueConfig
    d.markProxyTouched()
    invoke.mockImplementationOnce(mockInvokeOk(validView()))
    await d.saveConfig()
    expect(d.config.value.proxyUrl).toBe('')
  })

  it('校验失败只弹警告并返回 false，不调后端', async () => {
    const d = useImageQueueConfigDomain()
    d.config.value = { ...IQ_DEFAULT_CONFIG, apiBase: 'ftp://x' } as ImageQueueConfig
    const ok = await d.saveConfig()
    expect(ok).toBe(false)
    expect(invoke).not.toHaveBeenCalled()
    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('API 路径'), 'warning')
  })

  it('后端 reject 时弹错误并返回 false，dirty 保持', async () => {
    const d = useImageQueueConfigDomain()
    d.markDirty()
    invoke.mockRejectedValueOnce(new Error('write fail'))
    const ok = await d.saveConfig()
    expect(ok).toBe(false)
    expect(notifyMock).toHaveBeenCalledWith('保存失败：write fail', 'error')
    expect(d.dirty.value).toBe(true)
  })

  it('后端抛非 Error 时用 String(err) 兜底', async () => {
    const d = useImageQueueConfigDomain()
    invoke.mockRejectedValueOnce('plain string')
    const ok = await d.saveConfig()
    expect(ok).toBe(false)
    expect(notifyMock).toHaveBeenCalledWith('保存失败：plain string', 'error')
  })

  it('未触碰 key/proxy 且原状态为 set 时保存后仍为 set', async () => {
    const d = useImageQueueConfigDomain()
    d.config.value = {
      ...IQ_DEFAULT_CONFIG,
      apiKey: '',
      apiKeyState: 'set',
      proxyUrl: '',
      proxyUrlState: 'set',
    } as ImageQueueConfig
    invoke.mockImplementationOnce(mockInvokeOk(validView({ apiKey: '', proxyUrl: '' })))
    await d.saveConfig()
    expect(d.config.value.apiKeyState).toBe('set')
    expect(d.config.value.proxyUrlState).toBe('set')
  })
})

describe('imageQueue.config resetDefaults', () => {
  it('回默认并保留 key/proxy 状态与脱敏串，置 dirty', () => {
    const d = useImageQueueConfigDomain()
    d.config.value = {
      ...IQ_DEFAULT_CONFIG,
      concurrency: 7,
      apiKey: 'sk-x',
      apiKeyState: 'set',
      apiKeyMasked: 'sk-***34',
      proxyUrlState: 'set',
    } as ImageQueueConfig
    d.resetDefaults()
    expect(d.config.value.concurrency).toBe(IQ_DEFAULT_CONFIG.concurrency)
    expect(d.config.value.apiKey).toBe('')
    expect(d.config.value.apiKeyState).toBe('set')
    expect(d.config.value.apiKeyMasked).toBe('sk-***34')
    expect(d.config.value.proxyUrlState).toBe('set')
    expect(d.keyTouched.value).toBe(false)
    expect(d.proxyTouched.value).toBe(false)
    expect(d.dirty.value).toBe(true)
  })
})

describe('imageQueue.config testConnection', () => {
  it('成功：带 elapsedMs 输出秒数', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ ok: true, elapsedMs: 1500 }))
    const d = useImageQueueConfigDomain()
    await d.testConnection()
    expect(invoke.mock.calls[0]![0]).toBe('iq_test_connection')
    expect(d.testResult.value).toMatchObject({ ok: true, elapsedMs: 1500 })
    expect(d.testResult.value!.message).toBe('连接正常（1K/1:1，1.5s）')
    expect(d.testing.value).toBe(false)
  })

  it('成功但无 elapsedMs 显示 ?', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ ok: true }))
    const d = useImageQueueConfigDomain()
    await d.testConnection()
    expect(d.testResult.value!.message).toBe('连接正常（1K/1:1，?s）')
  })

  it('失败：auth 阶段文案', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ ok: false, stage: 'auth' }))
    const d = useImageQueueConfigDomain()
    await d.testConnection()
    expect(d.testResult.value).toEqual({ ok: false, message: '密钥无效，请检查 API 密钥' })
    expect(notifyMock).toHaveBeenCalledWith('密钥无效，请检查 API 密钥', 'error')
  })

  it('失败：connect 阶段文案', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ ok: false, stage: 'connect' }))
    const d = useImageQueueConfigDomain()
    await d.testConnection()
    expect(d.testResult.value!.message).toBe('连不上，先看代理开关/地址')
  })

  it('失败：dns 阶段文案', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ ok: false, stage: 'dns' }))
    const d = useImageQueueConfigDomain()
    await d.testConnection()
    expect(d.testResult.value!.message).toBe('连不上，先看代理开关/地址')
  })

  it('失败：parse 阶段文案', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ ok: false, stage: 'parse' }))
    const d = useImageQueueConfigDomain()
    await d.testConnection()
    expect(d.testResult.value!.message).toBe('网关返回异常，请稍后重试')
  })

  it('失败：api 阶段带 message 时回显后端原文', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ ok: false, stage: 'api', message: '余额不足' }))
    const d = useImageQueueConfigDomain()
    await d.testConnection()
    expect(d.testResult.value!.message).toBe('测试失败：余额不足')
  })

  it('失败：无 stage 无 message 时兜底文案', async () => {
    invoke.mockImplementationOnce(mockInvokeOk({ ok: false }))
    const d = useImageQueueConfigDomain()
    await d.testConnection()
    expect(d.testResult.value!.message).toBe('测试失败')
  })

  it('抛异常：Error 对象取 message', async () => {
    invoke.mockRejectedValueOnce(new Error('net down'))
    const d = useImageQueueConfigDomain()
    await d.testConnection()
    expect(d.testResult.value).toEqual({ ok: false, message: '测试失败：net down' })
    expect(d.testing.value).toBe(false)
  })

  it('抛异常：非 Error 用 String(err)', async () => {
    invoke.mockRejectedValueOnce({ weird: true })
    const d = useImageQueueConfigDomain()
    await d.testConnection()
    expect(d.testResult.value!.message).toBe('测试失败：[object Object]')
  })

  it('测试进行中重复调用直接 return，不重复请求', async () => {
    invoke.mockImplementation(() => new Promise((r) => setTimeout(() => r({ ok: true, elapsedMs: 10 }), 30)))
    const d = useImageQueueConfigDomain()
    const p1 = d.testConnection()
    expect(d.testing.value).toBe(true)
    const p2 = d.testConnection()
    await Promise.all([p1, p2])
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('cancelTest 后结果不再回填（成功路径）', async () => {
    invoke.mockImplementation(() => new Promise((r) => setTimeout(() => r({ ok: true, elapsedMs: 10 }), 30)))
    const d = useImageQueueConfigDomain()
    const p = d.testConnection()
    d.cancelTest()
    expect(d.testing.value).toBe(false)
    await p
    expect(d.testResult.value).toBeNull()
  })

  it('cancelTest 后异常分支也不回填', async () => {
    invoke.mockImplementation(() => new Promise((_r, rej) => setTimeout(() => rej(new Error('late')), 30)))
    const d = useImageQueueConfigDomain()
    const p = d.testConnection()
    d.cancelTest()
    await p
    expect(d.testResult.value).toBeNull()
  })
})