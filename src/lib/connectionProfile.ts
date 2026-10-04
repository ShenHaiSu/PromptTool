// need01-02B 生图连接配置独立模块（前端连接域）。
// 连接类字段：protocol/model/apiBase/apiKey(+State/Masked)/proxyOn/proxyUrl(+State)/rememberKey/connectTimeoutSecs/totalTimeoutSecs
// 队列规则类保留在 ImageQueueConfig（size/ratio/outputDir/concurrency/loop星/embedMeta），见 src/lib/imageQueue.ts。
import { IQ_DEFAULT_CONFIG, IQ_KEY_SET_PLACEHOLDER, type ImageQueueConfig } from '@/lib/imageQueue'

export const DEFAULT_MODEL = 'agnes-image-2.5-flash'
export const SUPPORTED_MODELS = ['agnes-image-2.5-flash'] as const
export type SupportedModel = (typeof SUPPORTED_MODELS)[number]

export interface ConnectionProfile {
  protocol: 'agnes'
  /** need02 模型 SSOT：白名单一期唯一，缺字段即默认回填。 */
  model: string
  apiBase: string
  apiKey: string
  apiKeyState: 'unset' | 'set'
  apiKeyMasked: string
  proxyOn: boolean
  proxyUrl: string
  proxyUrlState: 'unset' | 'set'
  rememberKey: boolean
  connectTimeoutSecs: number
  totalTimeoutSecs: number
}

/** need02 渐进改名别名：ModelProfile = ConnectionProfile。 */
export type ModelProfile = ConnectionProfile

export const DEFAULT_CONNECTION_PROFILE: ConnectionProfile = {
  protocol: 'agnes',
  model: DEFAULT_MODEL,
  apiBase: IQ_DEFAULT_CONFIG.apiBase,
  apiKey: '',
  apiKeyState: 'unset',
  apiKeyMasked: '',
  proxyOn: false,
  proxyUrl: '',
  proxyUrlState: 'unset',
  rememberKey: true,
  connectTimeoutSecs: IQ_DEFAULT_CONFIG.connectTimeoutSecs,
  totalTimeoutSecs: IQ_DEFAULT_CONFIG.totalTimeoutSecs,
}

export const CONNECTION_LOCAL_CACHE_KEY = 'pmf.connection.profile'

function isHttpUrl(s: string): boolean {
  return /^https?:\/\/.+/i.test(s.trim())
}

/** 模型白名单校验（空即默认回填由调用方处理，此处空按非法计，前端下拉防手输）。 */
export function validateModelName(model: string): string | null {
  const m = (model ?? '').trim()
  if ((SUPPORTED_MODELS as readonly string[]).includes(m)) return null
  return `不支持的模型：${m || '(空)'}（一期仅支持 ${DEFAULT_MODEL}）`
}

/** 连接子集校验（队列规则不在此验）。 */
export function validateConnectionProfile(c: ConnectionProfile): string[] {
  const errs: string[] = []
  if (c.protocol !== 'agnes') errs.push('未知协议，仅支持 agnes')
  const modelErr = validateModelName((c as Partial<ConnectionProfile>).model ?? DEFAULT_MODEL)
  if (modelErr) errs.push(modelErr)
  if (!isHttpUrl(c.apiBase)) errs.push('API 路径须以 http(s):// 开头')
  if (!Number.isFinite(c.connectTimeoutSecs) || c.connectTimeoutSecs < 5 || c.connectTimeoutSecs > 60) {
    errs.push('连接超时须为 5..60 秒')
  }
  if (!Number.isFinite(c.totalTimeoutSecs) || c.totalTimeoutSecs < 60 || c.totalTimeoutSecs > 600) {
    errs.push('总超时须为 60..600 秒')
  }
  const proxyKeepAlive = c.proxyUrlState === 'set' && c.proxyUrl === ''
  if (c.proxyOn) {
    if (!proxyKeepAlive) {
      if (!isHttpUrl(c.proxyUrl)) errs.push('代理地址须以 http(s):// 开头，本期仅支持 http/https')
      else if (/^socks5:\/\//i.test(c.proxyUrl.trim())) errs.push('代理地址本期仅支持 http/https，socks5 为二期')
    }
  } else if (c.proxyUrl.trim() && /^socks5:\/\//i.test(c.proxyUrl.trim())) {
    errs.push('代理地址本期仅支持 http/https，socks5 为二期')
  }
  return errs
}

/** 是否可发起单发/队列（密钥已设置或内存有值）。 */
export function isConnectionReady(c: Pick<ConnectionProfile, 'apiKey' | 'apiKeyState'>): boolean {
  return c.apiKeyState === 'set' || Boolean(c.apiKey && c.apiKey !== IQ_KEY_SET_PLACEHOLDER)
}

/** 非敏感子集进 localStorage（apiKey/proxyUrl 明文永不进；model 非敏感可缓存）。 */
export function toConnectionLocalCache(c: ConnectionProfile): Record<string, unknown> {
  const { apiKey: _k, proxyUrl: _p, ...rest } = c
  void _k
  void _p
  return { ...rest }
}

/** 从完整 ImageQueueConfig 提取连接域（队列页/单发共用；过渡期双写透传 model，缺字段回默认）。 */
export function connectionFromIqConfig(c: ImageQueueConfig): ConnectionProfile {
  const raw = (c as Partial<ConnectionProfile>).model
  return {
    protocol: c.protocol,
    model: raw && raw.trim() ? raw : DEFAULT_MODEL,
    apiBase: c.apiBase,
    apiKey: c.apiKey,
    apiKeyState: c.apiKeyState,
    apiKeyMasked: c.apiKeyMasked,
    proxyOn: c.proxyOn,
    proxyUrl: c.proxyUrl,
    proxyUrlState: c.proxyUrlState,
    rememberKey: c.rememberKey,
    connectTimeoutSecs: c.connectTimeoutSecs,
    totalTimeoutSecs: c.totalTimeoutSecs,
  }
}

/** 连接域回填到完整 ImageQueueConfig（保持队列规则字段不动；过渡期双写透传 model）。 */
export function applyConnectionToIqConfig(base: ImageQueueConfig, conn: Partial<ConnectionProfile>): ImageQueueConfig {
  return { ...base, ...conn }
}

/** 队列规则子集类型（瘦身方向：ImageQueueConfig 去掉连接字段即此）。 */
export interface QueueRuleConfig {
  size: string
  ratio: string
  outputDir: string
  concurrency: number
  loopEnabled: boolean
  autoRandomOnStart: boolean
  loopUsePartial: boolean
  loopAllowNsfw: boolean
  embedMeta: boolean
}

export function queueRulesFromIqConfig(c: ImageQueueConfig): QueueRuleConfig {
  return {
    size: c.size,
    ratio: c.ratio,
    outputDir: c.outputDir,
    concurrency: c.concurrency,
    loopEnabled: c.loopEnabled,
    autoRandomOnStart: c.autoRandomOnStart,
    loopUsePartial: c.loopUsePartial,
    loopAllowNsfw: c.loopAllowNsfw,
    embedMeta: c.embedMeta,
  }
}
