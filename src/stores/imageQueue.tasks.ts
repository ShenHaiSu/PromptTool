import { ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { notify } from '@/lib/notify'
import { logger } from '@/lib/logger'
import {
  iqClearFinished,
  iqEnqueue,
  iqList,
  iqRemove,
  iqRetry,
  iqStart,
  iqStop,
  type ImageTaskView,
  type IqEnqueueItem,
  type IqHaltedPayload,
  type IqHungryPayload,
  type IqStats,
} from '@/lib/imageQueueApi'
import { IQ_KEY_SET_PLACEHOLDER, maskSecret } from '@/lib/imageQueue'
import { useBatchStore } from '@/stores/batch'
import { useConnectionProfileStore } from '@/stores/connectionProfile'
import { isConnectionReady } from '@/lib/connectionProfile'
import type { Ref } from 'vue'
import type { ImageQueueConfig } from '@/lib/imageQueue'

export function dedupeKeyOf(prompt: string, irHash?: string | null): string {
  if (irHash && irHash.trim()) return `hash:${irHash.trim()}`
  return `text:${prompt.trim().replace(/\s+/g, ' ')}`
}

/** 任务域：tasks/order/stats/事件/轮询/入队/启停 */
export function useImageQueueTasksDomain(config: Ref<ImageQueueConfig>) {
  const tasks = ref(new Map<string, ImageTaskView>())
  const order = ref<string[]>([])
  const stats = ref<IqStats>({ queued: 0, running: 0, succeeded: 0, failed: 0, consecFail: 0, stopped: true })
  const runningGen = ref<number | null>(null)
  const degraded = ref(false)
  const queueReady = ref(false)

  let hungryHandler: ((want: number) => void) | null = null
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
        notify('已停止', 'info')
        break
      case 'circuit':
        notify('连续 5 次失败已熔断，请检查密钥/网络后重试', 'error')
        break
      default:
        notify(p.message ? `已停止：${p.message}` : '已停止', 'error')
        break
    }
  }
  function haltReasonOf(payload: unknown): IqHaltedPayload {
    const p = payload as Partial<IqHaltedPayload>
    const reason = p.reason === 'circuit' || p.reason === 'io' || p.reason === 'disk' ? p.reason : 'manual'
    return { reason, message: typeof p.message === 'string' ? p.message : undefined }
  }
  async function subscribeEvents(): Promise<void> {
    while (unlistens.length) unlistens.pop()?.()
    const u1 = await listen<ImageTaskView>('image-queue://task-updated', (e) => applyTaskUpdated(e.payload))
    const u2 = await listen<IqStats>('image-queue://stats', (e) => applyStats(e.payload))
    const u3 = await listen<IqHungryPayload>('image-queue://hungry', (e) => {
      const want = Math.min(8, Math.max(1, Math.floor(e.payload?.want ?? 1)))
      hungryHandler?.(want)
    })
    const u4 = await listen<unknown>('image-queue://halted', (e) => applyHalted(haltReasonOf(e.payload)))
    unlistens.push(u1, u2, u3, u4)
  }
  function deriveStatsFromTasks(): void {
    let queued = 0
    let running = 0
    let succeeded = 0
    let failed = 0
    for (const t of tasks.value.values()) {
      switch (t.status) {
        case 'queued': queued++; break
        case 'running': running++; break
        case 'succeeded': succeeded++; break
        case 'failed':
        case 'cancelled': failed++; break
      }
    }
    stats.value = { ...stats.value, queued, running, succeeded, failed }
  }
  function startDegradedPolling(): void {
    degraded.value = true
    if (pollTimer) return
    pollTimer = setInterval(() => {
      void iqList(0, 100)
        .then((page) => {
          replaceAll(page.items)
          deriveStatsFromTasks()
        })
        .catch((err) => logger.warn('imageQueue.tasks', 'poll', err))
    }, 3000)
  }
  function stopDegradedPolling(): void {
    degraded.value = false
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
  async function initQueue(): Promise<void> {
    try {
      const page = await iqList(0, 100)
      replaceAll(page.items)
    } catch (err) {
      logger.warn('imageQueue.tasks', 'initQueue', err)
      replaceAll([])
    }
    try {
      await subscribeEvents()
      stopDegradedPolling()
    } catch (err) {
      logger.warn('imageQueue.tasks', '事件订阅失败，已降级轮询', err)
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
    degraded.value = false
    queueReady.value = false
  }
  function isRunning(): boolean {
    return runningGen.value != null && !stats.value.stopped
  }
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
        notify(msg.includes('满') ? '队列已满，请先清空已完成' : `入队失败：${msg}`, 'error')
        break
      }
    }
    void ids
    if (skipped > 0 && enqueued === 0) notify(`已跳过 ${skipped} 条重复`, 'warning')
    return { enqueued, skipped }
  }
  function normalizeEnqueueIds(r: unknown): string[] {
    if (!Array.isArray(r)) return []
    const out: string[] = []
    for (const it of r) {
      if (typeof it === 'string') out.push(it)
      else if (it && typeof it === 'object') {
        const o = it as { taskId?: unknown }
        if (typeof o.taskId === 'string') out.push(o.taskId)
      }
    }
    return out
  }
  async function enqueueCurrentResults(): Promise<void> {
    const batch = useBatchStore()
    if (batch.results.length === 0) {
      notify('暂无批量结果可入队', 'warning')
      return
    }
    try {
      if (!isConnectionReady(useConnectionProfileStore().profile)) {
        notify('未设置 API 密钥，请去右上「模型配置」设置', 'warning')
        return
      }
    } catch (err) {
      logger.warn('imageQueue.tasks', 'enqueueCurrentResults', err)
      if (config.value.apiKeyState === 'unset' && !config.value.apiKey) {
        notify('未设置 API 密钥', 'warning')
        return
      }
    }
    const items = batch.results.map((r) => ({ prompt: r.finalPrompt, irHash: r.hash }))
    const { enqueued, skipped } = await enqueueBatch(items)
    notify(`已入队 ${enqueued} 条${skipped ? `（跳过重复 ${skipped}）` : ''}`, 'success', 1600)
  }
  async function start(): Promise<void> {
    try {
      if (!isConnectionReady(useConnectionProfileStore().profile)) {
        notify('未设置 API 密钥，请去右上「模型配置」设置', 'warning')
        return
      }
    } catch (err) {
      logger.warn('imageQueue.tasks', 'start', err)
      if (config.value.apiKeyState === 'unset' && !config.value.apiKey) {
        notify('未设置 API 密钥', 'warning')
        return
      }
    }
    try {
      const gen = await iqStart()
      runningGen.value = gen
      stats.value = { ...stats.value, stopped: false }
    } catch (err) {
      notify(`启动失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }
  async function stop(): Promise<void> {
    try {
      await iqStop()
    } catch (err) {
      notify(`停止失败：${err instanceof Error ? err.message : String(err)}`, 'error')
      return
    }
    stats.value = { ...stats.value, stopped: true }
    runningGen.value = null
    notify('已停止，可续跑', 'info')
  }
  async function retry(id: string): Promise<void> {
    try {
      await iqRetry(id)
    } catch (err) {
      notify(`重试失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }
  async function remove(id: string, deleteFile = false): Promise<void> {
    const t = tasks.value.get(id)
    if (t?.status === 'running') {
      notify('运行中不可删，请先停止', 'warning')
      return
    }
    try {
      await iqRemove(id, deleteFile)
      tasks.value.delete(id)
      order.value = order.value.filter((x) => x !== id)
    } catch (err) {
      notify(`删除失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }
  async function clearFinished(): Promise<void> {
    try {
      const n = await iqClearFinished()
      const gone = new Set<string>()
      for (const [id, t] of tasks.value) {
        if (t.status === 'succeeded' || t.status === 'failed' || t.status === 'cancelled') gone.add(id)
      }
      for (const id of gone) tasks.value.delete(id)
      order.value = order.value.filter((x) => !gone.has(x))
      notify(`已清空 ${n} 条`, 'success', 1500)
    } catch (err) {
      notify(`清空失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }
  function debugKeyState(): string {
    return config.value.apiKeyState === 'set' ? `key=${maskSecret(IQ_KEY_SET_PLACEHOLDER)}` : 'key=unset'
  }
  return {
    tasks, order, stats, runningGen, degraded, queueReady,
    onHungry, initQueue, disposeQueue, enqueueBatch, enqueueCurrentResults,
    start, stop, retry, remove, clearFinished, isRunning,
    __applyStatsNow, __applyTaskUpdated: applyTaskUpdated, __applyHalted: applyHalted, __applyStats: applyStats,
    debugKeyState,
  }
}
