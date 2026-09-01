import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_EXPANDED = 'pmf:expandedKeys'

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* quota / disabled */
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
  } catch {
    /* ignore */
  }
  return new Set()
}

export const useDimensionPanelStore = defineStore('dimensionPanel', () => {
  const expandedKeys = ref<Set<string>>(loadExpandedKeys())

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
      } catch {
        /* ignore */
      }
    },
  )

  return { expandedKeys, isExpanded, toggleExpand, setExpanded, prune }
})
