/**
 * 历史均匀随机 — 模块级频率衰减 + 作用域分区滑动窗口
 * 对标 docs/need03/03_技术方案与接口契约.md §3
 */
import type { PromptIR } from './models'

export const STORAGE_KEY = 'pmf:randomHistory:v1'
export const ALPHA = 1.0
export const WINDOW_SIZE = 20
export const MAX_SCOPES = 64
export const DECAY_EVERY = 100
export const DECAY_FACTOR = 0.95
export const HITS_PRUNE_THRESHOLD = 0.01
export const MAX_ATTEMPTS_FACTOR = 15

export type RandomHistoryState = {
  version: 1
  hits: Record<string, number>
  recentByScope: Record<string, string[]>
  totalGenerations: number
  scopeAccessOrder: string[]
}

export function emptyHistory(): RandomHistoryState {
  return { version: 1, hits: {}, recentByScope: {}, totalGenerations: 0, scopeAccessOrder: [] }
}

export function buildScopeKey(opts: {
  lockedIds?: string[] | Set<string>
  anchoredIds?: string[]
  enabledDimKeys: string[]
  allowNsfw: boolean
  mode: 'random' | 'partial'
}): string {
  const locked = [...(opts.lockedIds ?? [])].sort().join(',')
  const anchored = [...(opts.anchoredIds ?? [])].sort().join(',')
  const dims = [...opts.enabledDimKeys].sort().join(',')
  return `${opts.mode}|locked:${locked}|anchored:${anchored}|dims:${dims}|nsfw:${opts.allowNsfw ? 1 : 0}`
}

export function effectiveWeight(rawWeight: number, moduleId: string, hits: Record<string, number>): number {
  const w = Number.isFinite(rawWeight) ? rawWeight : 1.0
  const clamped = Math.min(2.0, Math.max(0.1, w))
  const h = hits[moduleId] ?? 0
  return clamped / (1 + h * ALPHA)
}

export function effectiveWeightsForPool(
  pool: Array<{ id: string; weight: number }>,
  hits: Record<string, number>,
): number[] {
  return pool.map((m) => effectiveWeight(m.weight, m.id, hits))
}

export function isInWindow(hash: string, scopeKey: string, recentByScope: Record<string, string[]>): boolean {
  return (recentByScope[scopeKey] ?? []).includes(hash)
}

export function pushToWindow(hash: string, scopeKey: string, state: RandomHistoryState): void {
  const q = (state.recentByScope[scopeKey] ??= [])
  q.push(hash)
  if (q.length > WINDOW_SIZE) q.shift()
  state.scopeAccessOrder = state.scopeAccessOrder.filter((k) => k !== scopeKey)
  state.scopeAccessOrder.push(scopeKey)
  if (Object.keys(state.recentByScope).length > MAX_SCOPES) {
    const evict = state.scopeAccessOrder.shift()!
    delete state.recentByScope[evict]
  }
}

export function recordHit(state: RandomHistoryState, ir: PromptIR): void {
  for (const seg of ir.segments) {
    state.hits[seg.sourceModuleId] = (state.hits[seg.sourceModuleId] ?? 0) + 1
  }
}

export function maybeDecay(state: RandomHistoryState): void {
  state.totalGenerations++
  if (state.totalGenerations % DECAY_EVERY !== 0) return
  for (const k of Object.keys(state.hits)) {
    const v = state.hits[k]! * DECAY_FACTOR
    if (v < HITS_PRUNE_THRESHOLD) delete state.hits[k]
    else state.hits[k] = v
  }
}

function getStorage(): Storage | null {
  try {
    const g = globalThis as unknown as { localStorage?: Storage }
    if (g.localStorage) return g.localStorage
    // jsdom fallback via window
    if (typeof window !== 'undefined' && (window as unknown as { localStorage?: Storage }).localStorage) {
      return (window as unknown as { localStorage: Storage }).localStorage
    }
    return null
  } catch {
    return null
  }
}

export function loadHistory(): RandomHistoryState {
  try {
    const storage = getStorage()
    if (!storage) return emptyHistory()
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return emptyHistory()
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if ((parsed as { version?: number }).version !== 1) return emptyHistory()
    const p = parsed as unknown as RandomHistoryState
    return {
      version: 1,
      hits: (p.hits as Record<string, number>) ?? {},
      recentByScope: (p.recentByScope as Record<string, string[]>) ?? {},
      totalGenerations: (p.totalGenerations as number) ?? 0,
      scopeAccessOrder:
        (p.scopeAccessOrder as string[]) ?? Object.keys((p.recentByScope as Record<string, string[]>) ?? {}),
    }
  } catch {
    return emptyHistory()
  }
}

export function saveHistory(state: RandomHistoryState): void {
  try {
    const storage = getStorage()
    if (!storage) return
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 静默降级
  }
}

export function clearHistory(): void {
  try {
    const storage = getStorage()
    if (!storage) return
    storage.removeItem(STORAGE_KEY)
  } catch {
    // 静默降级
  }
}
