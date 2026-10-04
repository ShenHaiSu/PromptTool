/**
 * need01-02B 连接配置 store（单发与队列共用）。
 * 后端仍复用 iq_get_config / iq_set_config（单文件兼容+自动迁移见 config.rs），
 * 前端已拆连接域：App.vue 挂载处 loadConnection()，单发改绑此 store，不再依赖 ImageQueuePanel onMounted。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  DEFAULT_CONNECTION_PROFILE,
  CONNECTION_LOCAL_CACHE_KEY,
  connectionFromIqConfig,
  toConnectionLocalCache,
  type ConnectionProfile,
} from '@/lib/connectionProfile'
import { iqGetConfig, viewToConfig, configToPayload } from '@/lib/imageQueueApi'
import { IQ_DEFAULT_CONFIG } from '@/lib/imageQueue'
import { useToast } from '@/composables/useToast'

export const useConnectionProfileStore = defineStore('connectionProfile', () => {
  const { push } = useToast()
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
          apiKey: '',
          proxyUrl: '',
        }
      }
    } catch { /* ignore */ }
  }

  function persistLocalCache(): void {
    try {
      localStorage.setItem(CONNECTION_LOCAL_CACHE_KEY, JSON.stringify(toConnectionLocalCache(profile.value)))
    } catch { /* ignore */ }
  }

  /** App.vue 挂载处调用；单发/队列共用，失败降级缓存/默认。 */
  async function loadConnection(): Promise<void> {
    restoreLocalCache()
    try {
      const view = await iqGetConfig()
      const full = viewToConfig(view)
      // 旧 image_queue.json 自动迁移：缺字段即默认（viewToConfig 内已兼容）
      profile.value = connectionFromIqConfig({ ...IQ_DEFAULT_CONFIG, ...full })
    } catch {
      // 保留缓存/默认值，保证直进单发不被拦截在 unset 之外仍可提示
    }
    keyTouched.value = false
    proxyTouched.value = false
    loaded.value = true
    persistLocalCache()
  }

  function markKeyTouched(): void {
    keyTouched.value = true
  }

  function markProxyTouched(): void {
    proxyTouched.value = true
  }

  /** 连接页保存（设置页连接卡改绑此 store；队列规则仍走 imageQueue store）。 */
  async function saveConnection(): Promise<boolean> {
    try {
      const base = { ...IQ_DEFAULT_CONFIG, ...profile.value }
      const view = await import('@/lib/imageQueueApi').then((m) =>
        m.iqSetConfig(configToPayload(base as never, keyTouched.value, proxyTouched.value)),
      )
      const full = viewToConfig(view)
      const prevKey = profile.value.apiKeyState
      const prevProxy = profile.value.proxyUrlState
      profile.value = connectionFromIqConfig({ ...IQ_DEFAULT_CONFIG, ...full })
      if (!keyTouched.value && prevKey === 'set') profile.value.apiKeyState = 'set'
      if (!proxyTouched.value && prevProxy === 'set') profile.value.proxyUrlState = 'set'
      keyTouched.value = false
      proxyTouched.value = false
      persistLocalCache()
      push('连接配置已保存', 'success', 1500)
      return true
    } catch (err) {
      push(`保存失败：${err instanceof Error ? err.message : String(err)}`, 'error')
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

  return { profile, loaded, keyTouched, proxyTouched, loadConnection, saveConnection, markKeyTouched, markProxyTouched, syncFromIqConfig, persistLocalCache }
})
