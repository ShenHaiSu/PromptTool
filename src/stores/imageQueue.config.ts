import { ref } from 'vue'
import {
  IQ_DEFAULT_CONFIG,
  IQ_LOCAL_CACHE_KEY,
  trimTrailingSlash,
  validateIqConfig,
  type ImageQueueConfig,
} from '@/lib/imageQueue'
import {
  configToPayload,
  iqGetConfig,
  iqSetConfig,
  iqTestConnection,
  toLocalCache,
  viewToConfig,
  type IqTestResult,
} from '@/lib/imageQueueApi'
import { notify } from '@/lib/notify'
import { logger } from '@/lib/logger'

export type IqTestState = { ok: boolean; elapsedMs?: number; message?: string } | null

/** 配置域：config/testing/dirty/load/save/test */
export function useImageQueueConfigDomain() {
  const config = ref<ImageQueueConfig>({ ...IQ_DEFAULT_CONFIG })
  const testing = ref(false)
  const testResult = ref<IqTestState>(null)
  const dirty = ref(false)
  const keyTouched = ref(false)
  const proxyTouched = ref(false)
  /** @deprecated 仅保留兼容 */
  const lastRandomMode = ref({ usePartial: false, allowNsfw: false })

  function markDirty(): void {
    dirty.value = true
  }
  function markKeyTouched(): void {
    keyTouched.value = true
    markDirty()
  }
  function markProxyTouched(): void {
    proxyTouched.value = true
    markDirty()
  }
  function persistLocalCache(): void {
    try {
      localStorage.setItem(IQ_LOCAL_CACHE_KEY, JSON.stringify(toLocalCache(config.value)))
    } catch (err) {
      logger.warn('imageQueue.config', 'persistLocalCache', err)
    }
  }
  function restoreLocalCache(): void {
    try {
      const raw = localStorage.getItem(IQ_LOCAL_CACHE_KEY)
      if (!raw) return
      const cached = JSON.parse(raw) as Partial<ImageQueueConfig>
      if (typeof cached === 'object' && cached) {
        const { apiKey: _dropKey, proxyUrl: _dropProxy, ...rest } = cached as Record<string, unknown>
        void _dropKey
        void _dropProxy
        config.value = {
          ...IQ_DEFAULT_CONFIG,
          ...(rest as Partial<ImageQueueConfig>),
          apiKey: '',
          apiKeyState: config.value.apiKeyState,
          proxyUrl: '',
          proxyUrlState: config.value.proxyUrlState,
        }
      }
    } catch (err) {
      logger.warn('imageQueue.config', 'restoreLocalCache', err)
    }
  }
  async function loadConfig(): Promise<void> {
    restoreLocalCache()
    try {
      const view = await iqGetConfig()
      config.value = { ...IQ_DEFAULT_CONFIG, ...viewToConfig(view) }
    } catch (err) {
      logger.warn('imageQueue.config', 'loadConfig降级', err)
    }
    keyTouched.value = false
    proxyTouched.value = false
    dirty.value = false
  }
  async function saveConfig(): Promise<boolean> {
    config.value.apiBase = trimTrailingSlash(config.value.apiBase.trim())
    if (proxyTouched.value && config.value.proxyUrl.trim()) {
      config.value.proxyUrl = trimTrailingSlash(config.value.proxyUrl.trim())
    }
    const errs = validateIqConfig(config.value)
    if (errs.length) {
      notify(errs[0]!, 'warning')
      return false
    }
    try {
      const view = await iqSetConfig(configToPayload(config.value, keyTouched.value, proxyTouched.value))
      const prevKeyState = config.value.apiKeyState
      const prevProxyState = config.value.proxyUrlState
      config.value = { ...config.value, ...viewToConfig(view) }
      if (!keyTouched.value && prevKeyState === 'set') config.value.apiKeyState = 'set'
      if (!proxyTouched.value && prevProxyState === 'set') config.value.proxyUrlState = 'set'
      keyTouched.value = false
      proxyTouched.value = false
      dirty.value = false
      notify('生图配置已保存', 'success', 1500)
      persistLocalCache()
      return true
    } catch (err) {
      notify(`保存失败：${err instanceof Error ? err.message : String(err)}`, 'error')
      return false
    }
  }
  function resetDefaults(): void {
    const keepKeyState = config.value.apiKeyState
    const keepProxyState = config.value.proxyUrlState
    const keepMasked = config.value.apiKeyMasked
    config.value = {
      ...IQ_DEFAULT_CONFIG,
      apiKey: '',
      apiKeyState: keepKeyState,
      apiKeyMasked: keepMasked,
      proxyUrlState: keepProxyState,
    }
    keyTouched.value = false
    proxyTouched.value = false
    markDirty()
  }

  let testCancelled = false
  async function testConnection(): Promise<void> {
    if (testing.value) return
    testCancelled = false
    testing.value = true
    testResult.value = null
    try {
      const r: IqTestResult = await iqTestConnection()
      if (testCancelled) return
      if (r.ok) {
        const secs = r.elapsedMs != null ? (r.elapsedMs / 1000).toFixed(1) : '?'
        testResult.value = { ok: true, elapsedMs: r.elapsedMs, message: `连接正常（1K/1:1，${secs}s）` }
        notify(`连接正常（1K/1:1，${secs}s）`, 'success')
      } else {
        testResult.value = { ok: false, message: translateTestStage(r) }
        notify(translateTestStage(r), 'error')
      }
    } catch (err) {
      if (testCancelled) return
      const msg = `测试失败：${err instanceof Error ? err.message : String(err)}`
      testResult.value = { ok: false, message: msg }
      notify(msg, 'error')
    } finally {
      testing.value = false
    }
  }
  function cancelTest(): void {
    testCancelled = true
    testing.value = false
  }
  function translateTestStage(r: IqTestResult): string {
    switch (r.stage) {
      case 'auth':
        return '密钥无效，请检查 API 密钥'
      case 'connect':
      case 'dns':
        return '连不上，先看代理开关/地址'
      case 'parse':
        return '网关返回异常，请稍后重试'
      case 'api':
      default:
        return r.message ? `测试失败：${r.message}` : '测试失败'
    }
  }
  return {
    config, testing, testResult, dirty, keyTouched, proxyTouched, lastRandomMode,
    markDirty, markKeyTouched, markProxyTouched, loadConfig, saveConfig, resetDefaults,
    testConnection, cancelTest,
  }
}
