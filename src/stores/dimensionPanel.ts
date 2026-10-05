import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import { logger } from '@/lib/logger'

const STORAGE_EXPANDED = 'pmf:expandedKeys'
const STORAGE_SCROLL = 'pmf:scrollTop'

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch (e) {
    logger.warn('dimensionPanel', `读取 ${key} 失败：`, e)
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch (e) {
    /* quota / disabled */
    logger.warn('dimensionPanel', `写入 ${key} 失败（quota/disabled）：`, e)
  }
}

function loadExpandedKeys(): Set<string> {
  const raw = safeGet(STORAGE_EXPANDED)
  if (!raw) return new Set()
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) {
      return new Set(arr.filter((v): v is string => typeof v === 'string' && v.length > 0))
    }
  } catch (e) {
    /* ignore */
    logger.warn('dimensionPanel', '解析展开键持久化失败：', e)
  }
  return new Set()
}

function loadScrollTop(): Record<string, number> {
  const raw = safeGet(STORAGE_SCROLL)
  if (!raw) return {}
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v
      }
      return out
    }
  } catch (e) {
    logger.warn('dimensionPanel', '解析滚动位置持久化失败：', e)
  }
  return {}
}
export const useDimensionPanelStore = defineStore('dimensionPanel', () => {
  const expandedKeys = ref<Set<string>>(loadExpandedKeys())

  // 滚动位置：按「面板区域 + 搜索词」分桶，数据刷新/模式切换后恢复
  const scrollTop = ref<Record<string, number>>(loadScrollTop())

  function getScrollTop(key: string): number {
    const v = scrollTop.value[key]
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
  }

  function setScrollTop(key: string, value: number): void {
    if (!Number.isFinite(value) || value < 0) return
    const cur = scrollTop.value[key] ?? 0
    if (Math.abs(cur - value) < 0.5) return
    scrollTop.value = { ...scrollTop.value, [key]: value }
  }

  function clearScrollTop(key: string): void {
    if (!(key in scrollTop.value)) return
    const next = { ...scrollTop.value }
    delete next[key]
    scrollTop.value = next
  }

  function isExpanded(key: string): boolean {
    return expandedKeys.value.has(key)
  }

  function toggleExpand(key: string): void {
    const s = new Set(expandedKeys.value)
    if (s.has(key)) s.delete(key)
    else s.add(key)
    expandedKeys.value = s
  }

  function setExpanded(key: string, on: boolean): void {
    const s = new Set(expandedKeys.value)
    if (on) s.add(key)
    else s.delete(key)
    expandedKeys.value = s
  }

  function prune(validKeys: Set<string>): void {
    const next = new Set([...expandedKeys.value].filter((k) => validKeys.has(k)))
    if (next.size !== expandedKeys.value.size || [...next].some((k) => !expandedKeys.value.has(k))) {
      expandedKeys.value = next
    }
  }

  watch(
    () => [...expandedKeys.value].join('\u0001'),
    () => {
      try {
        safeSet(STORAGE_EXPANDED, JSON.stringify([...expandedKeys.value]))
      } catch (e) {
        /* ignore */
        logger.warn('dimensionPanel', '持久化展开键失败：', e)
      }
    },
  )

  watch(
    () => JSON.stringify(scrollTop.value),
    (v) => {
      safeSet(STORAGE_SCROLL, v)
    },
  )

  return {
    expandedKeys,
    isExpanded,
    toggleExpand,
    setExpanded,
    prune,
    scrollTop,
    getScrollTop,
    setScrollTop,
    clearScrollTop,
  }
})
