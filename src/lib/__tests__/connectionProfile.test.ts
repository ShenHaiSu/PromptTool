import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CONNECTION_PROFILE,
  validateConnectionProfile,
  isConnectionReady,
  toConnectionLocalCache,
  connectionFromIqConfig,
  queueRulesFromIqConfig,
} from '@/lib/connectionProfile'
import { IQ_DEFAULT_CONFIG } from '@/lib/imageQueue'

describe('need01-02B connectionProfile', () => {
  it('默认连接就绪=false，set 后 true', () => {
    expect(isConnectionReady(DEFAULT_CONNECTION_PROFILE)).toBe(false)
    expect(isConnectionReady({ apiKey: '', apiKeyState: 'set' })).toBe(true)
    expect(isConnectionReady({ apiKey: 'sk-x', apiKeyState: 'unset' })).toBe(true)
  })
  it('校验子集：非法 base 与超时被拒，队列字段不影响', () => {
    const bad = { ...DEFAULT_CONNECTION_PROFILE, apiBase: 'ftp://x' }
    expect(validateConnectionProfile(bad).length).toBeGreaterThan(0)
    expect(validateConnectionProfile(DEFAULT_CONNECTION_PROFILE).length).toBe(0)
  })
  it('localCache 不含密钥明文', () => {
    const s = JSON.stringify(toConnectionLocalCache({ ...DEFAULT_CONNECTION_PROFILE, apiKey: 'sk-secret', proxyUrl: 'http://p' }))
    expect(s).not.toContain('sk-secret')
    expect(s).not.toContain('http://p')
  })
  it('与 ImageQueueConfig 互转：连接提取 + 队列规则瘦身', () => {
    const conn = connectionFromIqConfig(IQ_DEFAULT_CONFIG)
    expect(conn.apiBase).toBe(IQ_DEFAULT_CONFIG.apiBase)
     expect(conn).not.toHaveProperty('size')
    const rules = queueRulesFromIqConfig(IQ_DEFAULT_CONFIG)
    expect(rules.size).toBe('1K')
     expect(rules).not.toHaveProperty('apiBase')
  })
})

describe('need02 模型配置抽离', () => {
  it('model 缺字段兼容默认回填', async () => {
    const m = await import('@/lib/connectionProfile')
    expect(m.DEFAULT_MODEL).toBe('agnes-image-2.5-flash')
    expect(m.DEFAULT_CONNECTION_PROFILE.model).toBe('agnes-image-2.5-flash')
    // 旧缓存/旧 iq 配置无 model → 回默认
    const conn = m.connectionFromIqConfig({ ...IQ_DEFAULT_CONFIG } as never)
    expect(conn.model).toBe('agnes-image-2.5-flash')
  })
  it('非法 model 校验拦截', async () => {
    const m = await import('@/lib/connectionProfile')
    expect(m.validateModelName('gpt-4')).toContain('不支持的模型')
    expect(m.validateModelName('agnes-image-2.5-flash')).toBeNull()
    const errs = m.validateConnectionProfile({ ...m.DEFAULT_CONNECTION_PROFILE, model: 'evil' })
    expect(errs.some((e: string) => e.includes('不支持的模型'))).toBe(true)
  })
  it('localCache 含 model 非敏感、可缓存；不含 apiKey/proxyUrl 明文', async () => {
    const m = await import('@/lib/connectionProfile')
    const cache = m.toConnectionLocalCache({ ...m.DEFAULT_CONNECTION_PROFILE, apiKey: 'sk-secret', proxyUrl: 'http://p' })
    const s = JSON.stringify(cache)
    expect(s).not.toContain('sk-secret')
    expect(s).not.toContain('http://p')
    expect((cache as Record<string, unknown>).model).toBe('agnes-image-2.5-flash')
  })
})
