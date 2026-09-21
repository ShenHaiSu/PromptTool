/**
 * 生图队列总 store（need05 F1 配置域 + F2 任务域）
 * setup 式 Pinia，沿用 stores/batch.ts 风格；invoke 参数一律 camelCase。
 * 后端施工中：load/init 失败降级（localStorage 缓存 / 空队列 + 轮询），保证页面不崩；
 * 写操作失败如实 toast，不伪造成功。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { useToast } from '@/composables/useToast'
import {
  IQ_DEFAULT_CONFIG,
  IQ_KEY_SET_PLACEHOLDER,
  IQ_LOCAL_CACHE_KEY,
  maskSecret,
  trimTrailingSlash,
  validateIqConfig,
  type ImageQueueConfig,
} from '@/lib/imageQueue'
import {
  configToPayload,
  iqClearFinished,
  iqEnqueue,
  iqGetConfig,
  iqList,
  iqRemove,
  iqRetry,
  iqSetConfig,
  iqStart,
  iqStop,
  iqTestConnection,
  toLocalCache,
  viewToConfig,
  type ImageTaskView,
  type IqEnqueueItem,
  type IqHaltedPayload,
  type IqHungryPayload,
  type IqStats,
  type IqTestResult,
} from '@/lib/imageQueueApi'
import { useBatchStore } from '@/stores/batch'

export type { ImageTaskView, IqStats }
export type IqTestState = { ok: boolean; elapsedMs?: number; message?: string } | null

/** prompt 归一化去重键（B2 §3.1 前端侧对照实现）。 */
export function dedupeKeyOf(prompt: string, irHash?: string | null): string {
  if (irHash && irHash.trim()) return `hash:${irHash.trim()}`
  return `text:${prompt.trim().replace(/\s+/g, ' ')}`
}

function isTauriRuntime(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__)
  } catch {
    return false
  }
}

export const useImageQueueStore = defineStore('imageQueue', () => {
  const { push } = useToast()

  // ---------------- 配置域（F1 §3） ----------------
  const config = ref<ImageQueueConfig>({ ...IQ_DEFAULT_CONFIG })
  const testing = ref(false)
  const testResult = ref<IqTestState>(null)
  const dirty = ref(false)
  const keyTouched = ref(false)
  /** 上次随机的模式（BatchFactory onRandom 写入），饥饿补货沿用。 */
  const lastRandomMode = ref({ usePartial: false, allowNsfw: false })

  function markDirty(): void {
    dirty.value = true
  }

  function markKeyTouched(): void {
    keyTouched.value = true
    // 已设置占位聚焦即清空待重输由组件处理；此处仅记脏
    markDirty()
  }

  function persistLocalCache(): void {
    try {
      localStorage.setItem(IQ_LOCAL_CACHE_KEY, JSON.stringify(toLocalCache(config.value)))
    } catch { /* ignore */ }
  }

  function restoreLocalCache(): void {
    try {
      const raw = localStorage.getItem(IQ_LOCAL_CACHE_KEY)
      if (!raw) return
      const cached = JSON.parse(raw) as Partial<ImageQueueConfig>
      if (typeof cached === 'object' && cached) {
        const { apiKey: _drop, ...rest } = cached as Record<string, unknown>
        void _drop
        config.value = { ...IQ_DEFAULT_CONFIG, ...(rest as Partial<ImageQueueConfig>), apiKey: '', apiKeyState: config.value.apiKeyState }
      }
    } catch { /* ignore */ }
  }

  async function loadConfig(): Promise<void> {
    restoreLocalCache()
    try {
      const view = await iqGetConfig()
      config.value = { ...IQ_DEFAULT_CONFIG, ...viewToConfig(view) }
    } catch {
      // 后端施工中：保留缓存/默认值，保证首屏可用
    }
    keyTouched.value = false
    dirty.value = false
  }

  async function saveConfig(): Promise<boolean> {
    config.value.apiBase = trimTrailingSlash(config.value.apiBase.trim())
    if (config.value.proxyUrl.trim()) config.value.proxyUrl = trimTrailingSlash(config.value.proxyUrl.trim())
    const errs = validateIqConfig(config.value)
    if (errs.length) {
      push(errs[0]!, 'warning')
      return false
    }
    try {
      const view = await iqSetConfig(configToPayload(config.value, keyTouched.value))
      const prevKeyState = config.value.apiKeyState
      config.value = { ...config.value, ...viewToConfig(view) }
      // 送占位且服务端仍有 key → 保持 set 态
      if (!keyTouched.value && prevKeyState === 'set') config.value.apiKeyState = 'set'
      keyTouched.value = false
      dirty.value = false
      push('生图配置已保存', 'success', 1500)
      persistLocalCache()
      return true
    } catch (err) {
      push(`保存失败：${err instanceof Error ? err.message : String(err)}`, 'error')
      return false
    }
  }

  function resetDefaults(): void {
    const keepKeyState = config.value.apiKeyState
    config.value = { ...IQ_DEFAULT_CONFIG, apiKey: '', apiKeyState: keepKeyState }
    keyTouched.value = false
    markDirty()
  }

  // ---------------- 测试连接（F1 §5） ----------------
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
        push(`连接正常（1K/1:1，${secs}s）`, 'success')
      } else {
        testResult.value = { ok: false, message: translateTestStage(r) }
        push(translateTestStage(r), 'error')
      }
    } catch (err) {
      if (testCancelled) return
      const msg = `测试失败：${err instanceof Error ? err.message : String(err)}`
      testResult.value = { ok: false, message: msg }
      push(msg, 'error')
    } finally {
      testing.value = false
    }
  }

  function cancelTest(): void {
    // 取消仅忽略结果，不中断后端（B1 §6）
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

  // ---------------- 任务域（F2 §2） ----------------
  const tasks = ref(new Map<string, ImageTaskView>())
  const order = ref<string[]>([])
  const stats = ref<IqStats>({ queued: 0, running: 0, succeeded: 0, failed: 0, consecFail: 0, stopped: true })
  const runningGen = ref<number | null>(null)
  const degraded = ref(false)
  const queueReady = ref(false)

  // hungry 回调：F3 联动模块订阅（本 store 不直接调随机引擎，保持依赖单向）
  let hungryHandler: ((want: number) => void) | null = null
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function onHungry(cb: (want: number) => void): void {
    hungryHandler = cb
  }

  const unlistens: Array<() => void> = []
  let statsTimer: ReturnType<typeof setTimeout> | null = null
  let pendingStats: IqStats | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function replaceAll(items: ImageTaskView[]): void {
    tasks.value = new Map(items.map((t) => [t.id, t]))
    order.value = items.map((t) => t.id)
  }

  function applyTaskUpdated(t: ImageTaskView): void {
    if (!tasks.value.has(t.id)) order.value.push(t.id)
    tasks.value.set(t.id, t)
  }

  function applyStats(s: IqStats): void {
    // 500ms 节流写入（trailing 触发一次）
    pendingStats = s
    if (statsTimer) return
    statsTimer = setTimeout(() => {
      statsTimer = null
      if (pendingStats) {
        stats.value = pendingStats
        pendingStats = null
      }
    }, 500)
  }

  /** 单测直写（绕过节流）。 */
  function __applyStatsNow(s: IqStats): void {
    if (statsTimer) {
      clearTimeout(statsTimer)
      statsTimer = null
    }
    pendingStats = null
    stats.value = s
  }

  function applyHalted(p: IqHaltedPayload): void {
    stats.value = { ...stats.value, stopped: true }
    runningGen.value = null
    switch (p.reason) {
      case 'manual':
        push('已停止', 'info')
        break
      case 'circuit':
        push('连续 5 次失败已熔断，请检查密钥/网络后重试', 'error')
        break
      default:
        push(p.message ? `已停止：${p.message}` : '已停止', 'error')
        break
    }
  }

  function haltReasonOf(payload: unknown): IqHaltedPayload {
    const p = payload as Partial<IqHaltedPayload>
    const reason = p.reason === 'circuit' || p.reason === 'io' || p.reason === 'disk' ? p.reason : 'manual'
    return { reason, message: typeof p.message === 'string' ? p.message : undefined }
  }

  async function subscribeEvents(): Promise<void> {
    const u1 = await listen<ImageTaskView>('image-queue://task-updated', (e) => applyTaskUpdated(e.payload))
    const u2 = await listen<IqStats>('image-queue://stats', (e) => applyStats(e.payload))
    const u3 = await listen<IqHungryPayload>('image-queue://hungry', (e) => {
      const want = Math.min(8, Math.max(1, Math.floor(e.payload?.want ?? 1)))
      hungryHandler?.(want)
    })
    const u4 = await listen<unknown>('image-queue://halted', (e) => applyHalted(haltReasonOf(e.payload)))
    unlistens.push(u1, u2, u3, u4)
  }

  function startDegradedPolling(): void {
    degraded.value = true
    if (pollTimer) return
    pollTimer = setInterval(() => {
      void iqList(0, 100).then((page) => replaceAll(page.items)).catch(() => {})
    }, 3000)
  }

  async function initQueue(): Promise<void> {
    try {
      const page = await iqList(0, 100)
      replaceAll(page.items)
    } catch {
      replaceAll([])
    }
    if (!isTauriRuntime()) {
      // 非 Tauri 环境（纯 web 预览/jsdom）：降级轮询
      startDegradedPolling()
      queueReady.value = true
      return
    }
    try {
      await subscribeEvents()
    } catch {
      startDegradedPolling()
    }
    queueReady.value = true
  }

  function disposeQueue(): void {
    while (unlistens.length) unlistens.pop()?.()
    if (statsTimer) {
      clearTimeout(statsTimer)
      statsTimer = null
    }
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    pendingStats = null
    hungryHandler = null
    queueReady.value = false
  }

  function isRunning(): boolean {
    return runningGen.value != null && !stats.value.stopped
  }

  /**
   * 分批入队（每批 100 条，B2 上限 2000）。
   * 本地先按 irHash/归一化 prompt 去重（与已存在非 Cancelled 任务撞键即跳过）。
   */
  async function enqueueBatch(items: IqEnqueueItem[]): Promise<{ enqueued: number; skipped: number }> {
    const seen = new Set<string>()
    for (const [id, t] of tasks.value) {
      void id
      if (t.status === 'cancelled') continue
      seen.add(dedupeKeyOf(t.prompt, t.irHash))
    }
    const fresh: IqEnqueueItem[] = []
    let skipped = 0
    for (const it of items) {
      const k = dedupeKeyOf(it.prompt, it.irHash ?? null)
      if (seen.has(k)) {
        skipped++
        continue
      }
      seen.add(k)
      fresh.push(it)
    }
    let enqueued = 0
    const ids: string[] = []
    for (let i = 0; i < fresh.length; i += 100) {
      const chunk = fresh.slice(i, i + 100)
      try {
        const r = await iqEnqueue(chunk)
        const chunkIds = normalizeEnqueueIds(r)
        enqueued += chunkIds.length
        ids.push(...chunkIds)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        push(msg.includes('满') ? '队列已满，请先清空已完成' : `入队失败：${msg}`, 'error')
        break
      }
    }
    if (skipped > 0 && enqueued === 0) push(`已跳过 ${skipped} 条重复`, 'warning')
    return { enqueued, skipped }
  }

  /** 兼容后端两种返回形态：string[] 或 EnqueueResult[]。 */
  function normalizeEnqueueIds(r: unknown): string[] {
    if (!Array.isArray(r)) return []
    const out: string[] = []
    for (const it of r) {
      if (typeof it === 'string') out.push(it)
      else if (it && typeof it === 'object') {
        const o = it as { taskId?: unknown; skipped?: unknown }
        if (typeof o.taskId === 'string') out.push(o.taskId)
      }
    }
    return out
  }

  /** “入队当前结果”按钮：把 batch.results 全部转入队（F2 §3 / F3 §2 同一函数的手动入口）。 */
  async function enqueueCurrentResults(): Promise<void> {
    const batch = useBatchStore()
    if (batch.results.length === 0) {
      push('暂无批量结果可入队', 'warning')
      return
    }
    if (config.value.apiKeyState === 'unset' && !config.value.apiKey) {
      push('未设置 API 密钥', 'warning')
      return
    }
    const items = batch.results.map((r) => ({ prompt: r.finalPrompt, irHash: r.hash }))
    const { enqueued, skipped } = await enqueueBatch(items)
    push(`已入队 ${enqueued} 条${skipped ? `（跳过重复 ${skipped}）` : ''}`, 'success', 1600)
  }

  async function start(): Promise<void> {
    if (config.value.apiKeyState === 'unset' && !config.value.apiKey) {
      push('未设置 API 密钥', 'warning')
      return
    }
    try {
      const gen = await iqStart()
      runningGen.value = gen
      stats.value = { ...stats.value, stopped: false }
    } catch (err) {
      push(`启动失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  async function stop(): Promise<void> {
    try {
      await iqStop()
    } catch (err) {
      push(`停止失败：${err instanceof Error ? err.message : String(err)}`, 'error')
      return
    }
    stats.value = { ...stats.value, stopped: true }
    runningGen.value = null
    push('已停止，可续跑', 'info')
  }

  async function retry(id: string): Promise<void> {
    try {
      await iqRetry(id)
    } catch (err) {
      push(`重试失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  async function remove(id: string, deleteFile = false): Promise<void> {
    const t = tasks.value.get(id)
    if (t?.status === 'running') {
      push('运行中不可删，请先停止', 'warning')
      return
    }
    try {
      await iqRemove(id, deleteFile)
      tasks.value.delete(id)
      order.value = order.value.filter((x) => x !== id)
    } catch (err) {
      push(`删除失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  async function clearFinished(): Promise<void> {
    try {
      const n = await iqClearFinished()
      // 本地同步清理 finished（后端真源为准，失败已抛错）
      const gone = new Set<string>()
      for (const [id, t] of tasks.value) {
        if (t.status === 'succeeded' || t.status === 'failed' || t.status === 'cancelled') gone.add(id)
      }
      for (const id of gone) tasks.value.delete(id)
      order.value = order.value.filter((x) => !gone.has(x))
      push(`已清空 ${n} 条`, 'success', 1500)
    } catch (err) {
      push(`清空失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  /** 测试连接文案（含密钥掩码调试，不输出明文）。 */
  function debugKeyState(): string {
    return config.value.apiKeyState === 'set' ? `key=${maskSecret(IQ_KEY_SET_PLACEHOLDER)}` : 'key=unset'
  }

  return {
    // 配置域
    config,
    testing,
    testResult,
    dirty,
    keyTouched,
    lastRandomMode,
    markDirty,
    markKeyTouched,
    loadConfig,
    saveConfig,
    resetDefaults,
    testConnection,
    cancelTest,
    // 任务域
    tasks,
    order,
    stats,
    runningGen,
    degraded,
    queueReady,
    onHungry,
    initQueue,
    disposeQueue,
    enqueueBatch,
    enqueueCurrentResults,
    start,
    stop,
    retry,
    remove,
    clearFinished,
    isRunning,
    // 单测钩子
    __applyStatsNow,
    __applyTaskUpdated: applyTaskUpdated,
    __applyHalted: applyHalted,
    __applyStats: applyStats,
    debugKeyState,
  }
})
