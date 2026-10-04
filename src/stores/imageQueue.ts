/**
 * 生图队列总 store — 组合出口（need03 S5：配置域+任务域拆分，调用方零改）。
 * Map + order 双结构保留，同步点见 tasks 域注释。
 */
import { defineStore } from 'pinia'
import { isTauri } from '@tauri-apps/api/core'
import { useImageQueueConfigDomain, type IqTestState } from './imageQueue.config'
import { useImageQueueTasksDomain, dedupeKeyOf } from './imageQueue.tasks'
import type { ImageTaskView, IqStats } from '@/lib/imageQueueApi'

export type { ImageTaskView, IqStats }
export type { IqTestState }
export { dedupeKeyOf }

export function isTauriRuntime(): boolean {
  try {
    if (typeof isTauri === 'function') return isTauri()
  } catch {
    // fall through
  }
  try {
    const g = window as unknown as Record<string, unknown>
    return Boolean(g.__TAURI_INTERNALS__ ?? g.__TAURI__)
  } catch {
    return false
  }
}

export const useImageQueueStore = defineStore('imageQueue', () => {
  const cfg = useImageQueueConfigDomain()
  const tasksDom = useImageQueueTasksDomain(cfg.config)
  return { ...cfg, ...tasksDom }
})
