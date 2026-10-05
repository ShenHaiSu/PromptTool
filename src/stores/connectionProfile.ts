/**
 * need02 模型配置 store（单发与队列共用，唯一可写面）。
 * 后端走 model_get / model_set / model_test_connection（见 config.rs + queue.rs model_*），
 * 前端已拆连接域：App.vue 挂载处 loadModel()，单发/队列只读此 store。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { logger } from '@/lib/logger'
import {
  DEFAULT_CONNECTION_PROFILE,
  DEFAULT_MODEL,
  CONNECTION_LOCAL_CACHE_KEY,
  connectionFromIqConfig,
  toConnectionLocalCache,
  validateConnectionProfile,
  type ConnectionProfile,
  type ModelProfile,
} from '@/lib/connectionProfile'
 import { modelGet, modelSet, iqGetConfig, viewToConfig, type ModelConfigView } from '@/lib/imageQueueApi'
import { IQ_DEFAULT_CONFIG, IQ_KEY_SET_PLACEHOLDER } from '@/lib/imageQueue'
import { notify } from '@/lib/notify'

export type { ModelProfile }

export const useConnectionProfileStore = defineStore('connectionProfile', () => {
  const profile = ref<ConnectionProfile>({ ...DEFAULT_CONNECTION_PROFILE })
  const loaded = ref(false)
  const keyTouched = ref(false)
  const proxyTouched = ref(false)

  function restoreLocalCache(): void {
    try {
      const raw = localStorage.getItem(CONNECTION_LOCAL_CACHE_KEY)
      if (!raw) return
      const cached = JSON.parse(raw) as Partial<ConnectionProfile>
      if (typeof cached === 'object' && cached) {
        const { apiKey: _k, proxyUrl: _p, ...rest } = cached as Record<string, unknown>
        void _k
        void _p
        profile.value = {
          ...DEFAULT_CONNECTION_PROFILE,
          ...(rest as Partial<ConnectionProfile>),
          model: typeof (rest as Partial<ConnectionProfile>).model === 'string' && (rest as Partial<ConnectionProfile>).model!.trim()
            ? (rest as Partial<ConnectionProfile>).model!
            : DEFAULT_MODEL,
          apiKey: '',
          proxyUrl: '',
        }
      }
    } catch (e) {
      logger.warn('connectionProfile', '读取本地缓存失败（沿用默认配置）：', e)
    }
  }

  function persistLocalCache(): void {
    try {
      localStorage.setItem(CONNECTION_LOCAL_CACHE_KEY, JSON.stringify(toConnectionLocalCache(profile.value)))
    } catch (e) {
      logger.warn('connectionProfile', '写入本地缓存失败：', e)
    }
  }

  /** 后端模型视图 → 前端 profile（占位转 set 态，原文置空等待重输）。 */
  function applyModelView(view: ModelConfigView): void {
    const prevKey = profile.value.apiKeyState
    const prevProxy = profile.value.proxyUrlState
    profile.value = {
      protocol: 'agnes',
      model: view.model && view.model.trim() ? view.model : DEFAULT_MODEL,
      apiBase: view.apiBase,
      apiKey: '',
      apiKeyState: view.apiKey === IQ_KEY_SET_PLACEHOLDER || (view as { apiKeyMasked?: string }).apiKeyMasked ? 'set' : (view.apiKey ? 'set' : 'unset'),
      apiKeyMasked: (view as { apiKeyMasked?: string }).apiKeyMasked ?? '',
      proxyOn: view.proxyOn,
      proxyUrl: '',
      proxyUrlState: view.proxyUrl === IQ_KEY_SET_PLACEHOLDER || view.proxyUrl ? 'set' : 'unset',
      rememberKey: view.rememberKey,
      connectTimeoutSecs: view.connectTimeoutSecs,
      totalTimeoutSecs: view.totalTimeoutSecs,
    }
    if (!keyTouched.value && prevKey === 'set' && profile.value.apiKeyState !== 'set') profile.value.apiKeyState = 'set'
    if (!proxyTouched.value && prevProxy === 'set' && profile.value.proxyUrlState !== 'set') profile.value.proxyUrlState = 'set'
  }

  /** App.vue 挂载处调用；单发/队列共用，失败降级缓存/默认。 */
  async function loadModel(): Promise<void> {
    restoreLocalCache()
     try {
       const view = await modelGet()
       applyModelView(view)
     } catch {
       try {
         // 兼容旧后端（model_* 未注册）：回落 iq 读合并（静态导入，同主包，无分包警告）
         const view = await iqGetConfig()
         const full = viewToConfig(view)
         profile.value = connectionFromIqConfig({ ...IQ_DEFAULT_CONFIG, ...full })
       } catch (e) {
         logger.warn('connectionProfile', '回落 iq 配置读取失败（保留缓存/默认值）：', e)
       }
     }
    keyTouched.value = false
    proxyTouched.value = false
    loaded.value = true
    persistLocalCache()
  }

  /** 旧名别名（保留一周防旧调用崩，见 03 §2）。 */
  async function loadConnection(): Promise<void> {
    return loadModel()
  }

  function markKeyTouched(): void {
    keyTouched.value = true
  }

  function markProxyTouched(): void {
    proxyTouched.value = true
  }

  /** 模型页保存（唯一可写面；队列规则仍走 imageQueue store）。 */
  async function saveConnection(): Promise<boolean> {
    const errs = validateConnectionProfile(profile.value)
    if (errs.length) {
      notify(errs[0]!, 'warning')
      return false
    }
    try {
      const payload: ModelConfigView = {
        protocol: profile.value.protocol,
        model: profile.value.model && profile.value.model.trim() ? profile.value.model.trim() : DEFAULT_MODEL,
        apiBase: profile.value.apiBase.trim().replace(/\/+$/, ''),
        apiKey: keyTouched.value ? profile.value.apiKey : IQ_KEY_SET_PLACEHOLDER,
        proxyOn: profile.value.proxyOn,
        proxyUrl: proxyTouched.value ? profile.value.proxyUrl : IQ_KEY_SET_PLACEHOLDER,
        rememberKey: profile.value.rememberKey,
        connectTimeoutSecs: profile.value.connectTimeoutSecs,
        totalTimeoutSecs: profile.value.totalTimeoutSecs,
      }
      const view = await modelSet(payload)
      applyModelView(view)
      keyTouched.value = false
      proxyTouched.value = false
      persistLocalCache()
      notify('模型配置已保存', 'success', 1500)
      return true
    } catch (err) {
      notify(`保存失败：${err instanceof Error ? err.message : String(err)}`, 'error')
      return false
    }
  }

  /** 队列 store 回填同步：ImageQueuePanel loadConfig 后调用，保持双 store 一致（过渡期）。 */
  function syncFromIqConfig(full: Parameters<typeof connectionFromIqConfig>[0]): void {
    const conn = connectionFromIqConfig(full)
    // 仅在连接 store 未被用户编辑时覆盖，避免脏写
    if (!keyTouched.value && !proxyTouched.value) {
      profile.value = conn
      persistLocalCache()
    }
  }

  /** need02 单向同步：队列 store loadConfig 后用模型 SSOT 覆盖只读镜像（B4 收敛读）。 */
  function syncFromModel(): void {
    // 模型 store 即 SSOT：队列侧调用此函数即表示“以模型页为准”，此处仅持久化保活
    persistLocalCache()
  }

  return { profile, loaded, keyTouched, proxyTouched, loadModel, loadConnection, saveConnection, markKeyTouched, markProxyTouched, syncFromIqConfig, syncFromModel, persistLocalCache }
})
