/**
 * F1 §6：生图配置面板测试（默认值 / 校验 / 占位语义 / localStorage 脱敏）
 */
import { describe, it, expect } from 'vitest'
import {
  IQ_DEFAULT_CONFIG,
  IQ_KEY_SET_PLACEHOLDER,
  maskSecret,
  validateIqConfig,
  type ImageQueueConfig,
} from '@/lib/imageQueue'
import { configToPayload, toLocalCache, viewToConfig } from '@/lib/imageQueueApi'

function cfg(patch: Partial<ImageQueueConfig> = {}): ImageQueueConfig {
  return { ...IQ_DEFAULT_CONFIG, ...patch }
}

describe('IQ_DEFAULT_CONFIG', () => {
  it('size=1K ratio=1:1 concurrency=2 loop/备料开关全关', () => {
    expect(IQ_DEFAULT_CONFIG.size).toBe('1K')
    expect(IQ_DEFAULT_CONFIG.ratio).toBe('1:1')
    expect(IQ_DEFAULT_CONFIG.concurrency).toBe(2)
    expect(IQ_DEFAULT_CONFIG.loopEnabled).toBe(false)
    expect(IQ_DEFAULT_CONFIG.autoRandomOnStart).toBe(false)
  })
})

describe('validateIqConfig', () => {
  it('size 非法返回含 size 的错误', () => {
    const errs = validateIqConfig(cfg({ size: '9K' }))
    expect(errs.some((e) => e.includes('分辨率') || e.includes('size'))).toBe(true)
  })
  it('代理 socks5 拒绝（错误含 http/https）', () => {
    const errs = validateIqConfig(cfg({ proxyOn: true, proxyUrl: 'socks5://127.0.0.1:1080' }))
    expect(errs.some((e) => e.includes('http/https'))).toBe(true)
  })
  it('备料开关独立：autoRandomOnStart=true 不联动 loopEnabled', () => {
    const c = cfg({ autoRandomOnStart: true, loopEnabled: false })
    const errs = validateIqConfig(c)
    expect(errs).toHaveLength(0)
    expect(c.loopEnabled).toBe(false)
  })
  it('并发越界被拒绝', () => {
    expect(validateIqConfig(cfg({ concurrency: 9 }))).not.toHaveLength(0)
    expect(validateIqConfig(cfg({ concurrency: 0 }))).not.toHaveLength(0)
  })
  it('合法配置无错误', () => {
    expect(validateIqConfig(cfg())).toHaveLength(0)
  })
})

describe('__SET__ 占位语义', () => {
  it('configToPayload 未改动 key 时送 __SET__', () => {
    const p = configToPayload(cfg({ apiKey: '' }), false)
    expect(p.apiKey).toBe(IQ_KEY_SET_PLACEHOLDER)
  })
  it('configToPayload 改动 key 时送真值', () => {
    const p = configToPayload(cfg({ apiKey: 'sk-real' }), true)
    expect(p.apiKey).toBe('sk-real')
  })
  it('viewToConfig 把 __SET__ 转 apiKeyState=set 且 apiKey 置空', () => {
    const c = viewToConfig({ apiKey: IQ_KEY_SET_PLACEHOLDER })
    expect(c.apiKeyState).toBe('set')
    expect(c.apiKey).toBe('')
  })
})

describe('localStorage 脱敏', () => {
  it('缓存串不含 key 明文', () => {
    const c = cfg({ apiKey: 'sk-super-secret-123', apiKeyState: 'set' })
    const s = JSON.stringify(toLocalCache(c))
    expect(s).not.toContain('sk-super-secret-123')
  })
})

describe('maskSecret', () => {
  it('前3 + *** + 后2', () => {
    expect(maskSecret('sk-abcdef12')).toBe('sk-***12')
  })
  it('占位与空串全掩码', () => {
    expect(maskSecret(IQ_KEY_SET_PLACEHOLDER)).toBe('***')
    expect(maskSecret('')).toBe('***')
  })
})
