/**
 * 生图队列前端基础库（need05 F1 §2）
 * 常量 / 类型 / 校验 / 脱敏 / `__SET__` 占位处理。
 * 像素参考只做展示，不做校验（Agnes 侧可能增减，透传即可）。
 */

export const IQ_PROTOCOLS = [{ value: 'agnes', label: 'Agnes（Image 2.5 Flash）' }] as const
export type IqProtocol = 'agnes'

export const IQ_SIZES = ['1K', '2K', '3K', '4K'] as const
export type IqSize = (typeof IQ_SIZES)[number]
export const IQ_RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'] as const
export type IqRatio = (typeof IQ_RATIOS)[number]

export const IQ_PIXELS: Record<string, Record<string, string>> = {
  '1:1': { '1K': '1024x1024', '2K': '2048x2048', '3K': '3072x3072', '4K': '4096x4096' },
  '3:4': { '1K': '768x1024', '2K': '1536x2048', '3K': '2304x3072', '4K': '3072x4096' },
  '4:3': { '1K': '1024x768', '2K': '2048x1536', '3K': '3072x2304', '4K': '4096x3072' },
  '16:9': { '1K': '1312x736', '2K': '2624x1472', '3K': '3936x2208', '4K': '5248x2944' },
  '9:16': { '1K': '736x1312', '2K': '1472x2624', '3K': '2208x3936', '4K': '2944x5248' },
  '2:3': { '1K': '768x1152', '2K': '1536x2304', '3K': '2304x3456', '4K': '3072x4608' },
  '3:2': { '1K': '1152x768', '2K': '2304x1536', '3K': '3456x2304', '4K': '4608x3072' },
  '21:9': { '1K': '1680x720', '2K': '3360x1440', '3K': '5040x2160', '4K': '6720x2880' },
}

export const IQ_CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const
export const IQ_DEFAULT_API_BASE = 'https://apihub.agnes-ai.com'
export const IQ_DEFAULT_OUTPUT_HINT = '<data_dir>/output/images（留空即默认）'

/** 服务端“已设置密钥”占位：前端收到即只显徽标，不回显原文；送回即“保持原 key 不变”。 */
export const IQ_KEY_SET_PLACEHOLDER = '__SET__'

export type IqApiKeyState = 'unset' | 'set'
/** 代理地址与密钥同等敏感：占位语义与 apiKey 完全对称。 */
export type IqProxyUrlState = 'unset' | 'set'

 export interface ImageQueueConfig {
  protocol: IqProtocol
  loopEnabled: boolean
  /** 开始生图前自动随机一批新提示词入队（数量取并发数）。 */
  autoRandomOnStart: boolean
  /** 队列独立可控随机：以画布已选项为锚点，仅随机缺口维度（默认 false=纯随机）。 */
  loopUsePartial: boolean
  /** 队列随机是否含 NSFW 条目（默认 false）。 */
  loopAllowNsfw: boolean
  apiBase: string
  /** 内存值；`__SET__` = 服务端已有，保持不变（聚焦待重输时由组件清空）。 */
  apiKey: string
  /** 由 iq_get_config 推导，驱动“已设置”徽标。 */
  apiKeyState: IqApiKeyState
  /** 后端回的脱敏串（有 key 时 `前5***后4`，无 key 时 `""`），仅展示，永不回送。 */
  apiKeyMasked: string
  outputDir: string
  size: string
  ratio: string
  concurrency: number
  proxyOn: boolean
  /** 内存值；占位语义与 apiKey 对称：`__SET__` = 服务端已有，保持不变。 */
  proxyUrl: string
  /** 由 iq_get_config 推导，驱动代理“已设置”提示。 */
  proxyUrlState: IqProxyUrlState
  rememberKey: boolean
  /** 图片内嵌生图参数总开关（need06 embed-only），默认 true；false = 纯原图（应急回滚用）。 */
  embedMeta: boolean
  /** 连接超时秒数，默认 15，范围 5..=60（后端钳制）。 */
  connectTimeoutSecs: number
  /** 总超时秒数，默认 300，范围 60..=600（后端钳制）。 */
  totalTimeoutSecs: number
}

export const IQ_DEFAULT_CONFIG: ImageQueueConfig = {
  protocol: 'agnes',
  loopEnabled: false,
  autoRandomOnStart: false,
  loopUsePartial: false,
  loopAllowNsfw: false,
  apiBase: IQ_DEFAULT_API_BASE,
  apiKey: '',
  apiKeyState: 'unset',
  apiKeyMasked: '',
  outputDir: '',
  size: '1K',
  ratio: '1:1',
  concurrency: 2,
  proxyOn: false,
  proxyUrl: '',
  proxyUrlState: 'unset',
  rememberKey: true,
  embedMeta: true,
  connectTimeoutSecs: 15,
  totalTimeoutSecs: 300,
}

export const IQ_LOCAL_CACHE_KEY = 'pmf.imageQueue.config'

function isHttpUrl(s: string): boolean {
  return /^https?:\/\/.+/i.test(s.trim())
}

/**
 * 保存前前端先验（后端再验，以后端纠正值为准回写）。
 * 返回错误文案数组，为空即过。
 */
export function validateIqConfig(c: ImageQueueConfig): string[] {
  const errs: string[] = []
  if (c.protocol !== 'agnes') errs.push('未知协议，仅支持 agnes')
  if (!isHttpUrl(c.apiBase)) errs.push('API 路径须以 http(s):// 开头')
  if (!(IQ_SIZES as readonly string[]).includes(c.size)) errs.push(`分辨率非法，仅支持 ${IQ_SIZES.join(' / ')}`)
  if (!(IQ_RATIOS as readonly string[]).includes(c.ratio)) errs.push(`比例非法，仅支持 ${IQ_RATIOS.join(' ')}`)
  if (!Number.isInteger(c.concurrency) || c.concurrency < 1 || c.concurrency > 8) {
    errs.push('并发数量须为 1..8 的整数')
  }
  if (!Number.isFinite(c.connectTimeoutSecs) || c.connectTimeoutSecs < 5 || c.connectTimeoutSecs > 60) {
    errs.push('连接超时须为 5..60 秒')
  }
  if (!Number.isFinite(c.totalTimeoutSecs) || c.totalTimeoutSecs < 60 || c.totalTimeoutSecs > 600) {
    errs.push('总超时须为 60..600 秒')
  }
  // 代理占位态（服务端已有、内存置空待保持）跳过地址格式校验：后端收到占位会保持原值。
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

/** 日志/title 脱敏：前3 + *** + 后2（短串全掩码）。Key 明文不出内存/日志/localStorage。 */
export function maskSecret(s: string): string {
  if (!s || s === IQ_KEY_SET_PLACEHOLDER) return '***'
  const t = s.trim()
  if (t.length <= 5) return '***'
  return `${t.slice(0, 3)}***${t.slice(-2)}`
}

/** 当前 size+ratio 的像素参考（仅展示）。 */
export function iqPixelHint(size: string, ratio: string): string {
  return IQ_PIXELS[ratio]?.[size] ?? ''
}

/** 去尾 `/`（失焦时调用）。 */
export function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '')
}
