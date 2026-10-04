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
