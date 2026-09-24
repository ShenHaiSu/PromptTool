/**
 * 随机联动与无限循环（need05 F3 §1–§3 + 队列独立随机）
 * 联动方向：批量工厂（生产 prompt）→ 生图队列（消费 prompt）；饥饿补货反向调用引擎。
 * 归属此处而不进 store，保持 store 瘦；store 只负责入队/启停/事件。
 */
import { randomAssembly, partialRandomAssembly } from '@/engine/random'
import { adaptToModel } from '@/engine/adapters'
import { useAssemblyStore } from '@/stores/assembly'
import { useBatchStore } from '@/stores/batch'
import { useImageQueueStore } from '@/stores/imageQueue'
import { useLibraryStore } from '@/stores/library'
import { useRandomHistoryStore } from '@/stores/randomHistory'
import { useToast } from '@/composables/useToast'

export type EngineFns = {
  randomAssembly: typeof randomAssembly
  partialRandomAssembly: typeof partialRandomAssembly
}

/** 补货开关：循环生成开 + 运行中 + 有缺口才补。 */
export function shouldRefill(loopEnabled: boolean, running: boolean, want: number): boolean {
  return loopEnabled && running && want > 0
}

let lastEmptyToastAt = 0
let lastPartialFallbackToastAt = 0
let refillCancelled = false

export function cancelRefill(): void {
  refillCancelled = true
}

export function resetRefillCancel(): void {
  refillCancelled = false
}

/** 供单测重置节流态。 */
export function __resetLoopTestState(): void {
  lastEmptyToastAt = 0
  lastPartialFallbackToastAt = 0
  refillCancelled = false
}

export interface LoopEnqueueOutcome {
  enqueued: number
  skipped: number
}

/**
 * 单条随机抽取（补货与开始前备料共用）。
 * 按批量工厂同规则取 1 条：可控模式用 partialRandomAssembly，否则用 randomAssembly；
 * 直接调 engine，永不写 `batch.results`。失败返回 null，由调用方跳过。
 */
export interface DrawnPrompt {
  prompt: string
  irHash: string
}

export async function drawOnePrompt(
  engine: EngineFns,
  usePartial: boolean,
  allowNsfw: boolean,
): Promise<DrawnPrompt | null> {
  const library = useLibraryStore()
  const assembly = useAssemblyStore()
  const historyStore = useRandomHistoryStore()
  let irs
  try {
    if (usePartial && assembly.selectedItems.length > 0) {
      irs = engine.partialRandomAssembly(
        library.dimensions,
        library.modulesByDim,
        assembly.selectedItems,
        1,
        assembly.config,
        allowNsfw,
        historyStore.state,
      )
    } else {
      const lockedIds = new Set(
        assembly.selectedItems.filter((it) => it.locked).map((it) => it.module.id),
      )
      irs = engine.randomAssembly(
        library.dimensions,
        library.modulesByDim,
        lockedIds,
        1,
        assembly.config,
        allowNsfw,
        historyStore.state,
      )
    }
  } catch {
    return null
  }
  const ir = irs[0]
  if (!ir) return null
  try {
    historyStore.persist()
  } catch { /* ignore */ }
  const prompt = adaptToModel(ir, assembly.config.modelProfile, assembly.config)
  return { prompt, irHash: ir.hash() }
}

/** 队列随机模式来源：只读队列独立配置，不再读批量工厂 lastRandomMode。 */
export function resolveLoopRandomMode(): { usePartial: boolean; allowNsfw: boolean } {
  const iq = useImageQueueStore()
  return { usePartial: iq.config.loopUsePartial === true, allowNsfw: iq.config.loopAllowNsfw === true }
}

/** 可控已开但画布为空时节流 toast（10s 一次），提示已按纯随机降级。 */
export function toastPartialFallbackOnce(
  push: (msg: string, type?: 'info' | 'success' | 'warning' | 'error', ms?: number) => void,
): void {
  const now = Date.now()
  if (now - lastPartialFallbackToastAt > 10_000) {
    lastPartialFallbackToastAt = now
    push('可控随机已开但画布为空，已按纯随机补货', 'warning')
  }
}

/** 可控开关开但无锚点时是否会降级（供调用方决定是否提示）。 */
export function isPartialFallback(usePartial: boolean): boolean {
  if (!usePartial) return false
  try {
    return useAssemblyStore().selectedItems.length === 0
  } catch {
    return false
  }
}

/** 词库为空时节流 toast（10s 一次），供补货与备料共用。 */
export function toastLibraryEmptyOnce(
  push: (msg: string, type?: 'info' | 'success' | 'warning' | 'error', ms?: number) => void,
): void {
  const now = Date.now()
  if (now - lastEmptyToastAt > 10_000) {
    lastEmptyToastAt = now
    push('词库为空，无法补货', 'warning')
  }
}

/** 确保词库已加载；为空返回 false（调用方负责 toast）。 */
export async function ensureLibraryReady(): Promise<boolean> {
  const library = useLibraryStore()
  if (library.dimensions.length === 0) {
    try {
      await library.fetchAll()
    } catch { /* ignore，下方判空 */ }
  }
  return library.dimensions.length > 0 && library.total > 0
}

export type StartPrepareResult =
  /** 开关关闭：调用方直接启动。 */
  | { kind: 'direct' }
  /** 中止启动：未设密钥或备料为空。 */
  | { kind: 'blocked'; reason: 'no-key' | 'empty' }
  /** 已备料入队：调用方继续启动。 */
  | { kind: 'ready'; enqueued: number; skipped: number; usedExisting: boolean }

/**
 * 开始前备料（`autoRandomOnStart` 开关）。
 * - 批量工厂有随机结果 → confirm 询问：确定用现有入队，取消则重新随机并发数条；
 * - 无随机结果 → 直接随机并发数条入队；
 * - 备料为空则 blocked，调用方中止启动。失败只 toast，不抛。
 */
export async function prepareStartQueue(opts?: {
  engine?: EngineFns
  push?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error', ms?: number) => void
  confirm?: (msg: string) => boolean
}): Promise<StartPrepareResult> {
  const push = opts?.push ?? useToast().push
  const confirm = opts?.confirm ?? ((msg: string) => window.confirm(msg))
  try {
    const iq = useImageQueueStore()
    if (!iq.config.autoRandomOnStart) return { kind: 'direct' }
    if (iq.config.apiKeyState === 'unset' && !iq.config.apiKey) {
      push('未设置生图密钥，无法开始', 'warning')
      return { kind: 'blocked', reason: 'no-key' }
    }
    const count = Math.min(8, Math.max(1, Math.round(iq.config.concurrency) || 1))
    const batch = useBatchStore()
    let items: DrawnPrompt[]
    let usedExisting = false
    if (batch.results.length > 0) {
      const mode = resolveLoopRandomMode()
      const modeText = `可控${mode.usePartial ? '开' : '关'}·含NSFW${mode.allowNsfw ? '开' : '关'}`
      const useIt = confirm(
        `批量工厂有 ${batch.results.length} 条随机结果，是否直接入队？
【确定】使用现有结果 【取消】按队列配置（${modeText}）重新随机 ${count} 条`,
      )
      if (useIt) {
        items = batch.results.map((r) => ({ prompt: r.finalPrompt, irHash: r.hash }))
        usedExisting = true
      } else {
        const drawn = await drawStartItems(count, opts?.engine, push)
        if (drawn === null) return { kind: 'blocked', reason: 'empty' }
        items = drawn
      }
    } else {
      const drawn = await drawStartItems(count, opts?.engine, push)
      if (drawn === null) return { kind: 'blocked', reason: 'empty' }
      items = drawn
    }
    const { enqueued, skipped } = await iq.enqueueBatch(items)
    if (enqueued === 0 && skipped === 0) {
      push('备料为空（可能全部重复），已中止启动', 'warning')
      return { kind: 'blocked', reason: 'empty' }
    }
    push(`已入队 ${enqueued} 条${skipped ? `（跳过重复 ${skipped}）` : ''}，开始生图`, 'success', 1600)
    return { kind: 'ready', enqueued, skipped, usedExisting }
  } catch (err) {
    push(`备料失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    return { kind: 'blocked', reason: 'empty' }
  }
}

/** 开始前随机 N 条；词库为空则 toast 并返回 null。 */
async function drawStartItems(
  count: number,
  engineOpt: EngineFns | undefined,
  push: (msg: string, type?: 'info' | 'success' | 'warning' | 'error', ms?: number) => void,
): Promise<DrawnPrompt[] | null> {
  const engine: EngineFns = engineOpt ?? { randomAssembly, partialRandomAssembly }
  if (!(await ensureLibraryReady())) {
    toastLibraryEmptyOnce(push)
    return null
  }
  const mode = resolveLoopRandomMode()
  if (isPartialFallback(mode.usePartial)) toastPartialFallbackOnce(push)
  const items: DrawnPrompt[] = []
  for (let i = 0; i < count; i++) {
    const d = await drawOnePrompt(engine, mode.usePartial, mode.allowNsfw)
    if (d) items.push(d)
  }
  return items
}

/**
 * 饥饿补货：F2 收到 hungry 后调此函数（F3 §3）。
 * 硬性规则：永不写 `batch.results`；`want` 钳制 1..=concurrency；
 * 补货失败静默记日志 + 节流 toast；unmount 时 cancel 标记，完成后丢弃结果。
 */
export async function refillFromEngine(
  want: number,
  opts?: {
    engine?: EngineFns
    push?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error', ms?: number) => void
    usePartial?: boolean
    allowNsfw?: boolean
  },
): Promise<LoopEnqueueOutcome> {
  const engine: EngineFns = opts?.engine ?? { randomAssembly, partialRandomAssembly }
  const push = opts?.push ?? useToast().push
  const iq = useImageQueueStore()
  const empty: LoopEnqueueOutcome = { enqueued: 0, skipped: 0 }
  if (refillCancelled) return empty
  if (!iq.config.loopEnabled) return empty
  if (!iq.isRunning()) return empty
  const concurrency = Math.min(8, Math.max(1, Math.round(iq.config.concurrency) || 1))
  const times = Math.min(Math.max(1, Math.floor(want) || 0), concurrency)
  if (times <= 0) return empty

  if (!(await ensureLibraryReady())) {
    toastLibraryEmptyOnce(push)
    return empty
  }

  const fallbackMode = resolveLoopRandomMode()
  const usePartial = opts?.usePartial ?? fallbackMode.usePartial
  const allowNsfw = opts?.allowNsfw ?? fallbackMode.allowNsfw
  if (opts?.usePartial === undefined && isPartialFallback(usePartial)) toastPartialFallbackOnce(push)
  let enqueued = 0
  let skipped = 0
  for (let i = 0; i < times; i++) {
    if (refillCancelled) break
    // 用当前锁/锚按 BatchFactory 同规则取 1 条（直接调 engine，不经过 batch.results）
    const drawn = await drawOnePrompt(engine, usePartial, allowNsfw)
    if (!drawn) continue
    if (refillCancelled) break
    const r = await iq.enqueueBatch([{ prompt: drawn.prompt, irHash: drawn.irHash }])
    enqueued += r.enqueued
    skipped += r.skipped
  }
  if (refillCancelled) return empty
  return { enqueued, skipped }
}
