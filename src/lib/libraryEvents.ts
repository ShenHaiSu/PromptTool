/**
 * 轻量词库变更事件总线 — 无外部依赖
 * 事件：library:changed
 */
import { logger } from './logger'
type Handler = (payload?: unknown) => void

const listeners = new Map<string, Set<Handler>>()

export function on(event: string, handler: Handler): void {
  let set = listeners.get(event)
  if (!set) {
    set = new Set()
    listeners.set(event, set)
  }
  set.add(handler)
}

export function off(event: string, handler: Handler): void {
  listeners.get(event)?.delete(handler)
}

export function emit(event: string, payload?: unknown): void {
  const set = listeners.get(event)
  if (!set) return
  for (const h of [...set]) {
    try {
      h(payload)
    } catch (e) {
      logger.warn('libraryEvents', `事件处理器异常（${event}）：`, e)
    }
  }
}

export const LIBRARY_CHANGED = 'library:changed'
