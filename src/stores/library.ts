import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { dbGetDimensions, dbGetAllModulesGrouped } from '@/lib/db'
import type { Dimension, Module } from '@/engine/models'
import { logger } from '@/lib/logger'

const THRESHOLD = 200
const DEBOUNCE_MS = 10000

export const useLibraryStore = defineStore('library', () => {
  const dimensions = ref<Dimension[]>([])
  const modulesByDim = ref<Record<string, Module[]>>({})
  const loading = ref(false)
  const dirty = ref(false)
  const syncing = ref(false)

  // 供 StatusBar 弱提示：上次同步时间
  const lastSyncedAt = ref<number | null>(null)

  let timer: number | null = null

  const total = computed(() => {
    let c = 0
    for (const v of Object.values(modulesByDim.value)) c += v.length
    return c
  })

  const isLarge = computed(() => total.value > THRESHOLD)

  // need04 D2：唯一建图点，由 dimensions 派生 sortOrder 映射，reassemble 瞬间读取
  const dimOrderMap = computed<Record<string, number>>(() =>
    Object.fromEntries(dimensions.value.map((d) => [d.key, d.sortOrder])),
  )

// —— 无变化写入短路：避免点击随机时整库引用被替换导致面板全量重绘 ——

function dimSignature(list: Dimension[]): string {
  return list.map((d) => `${d.id}|${d.key}|${d.sortOrder}|${d.isEnabled ? 1 : 0}|${d.isMultiSelect ? 1 : 0}|${d.nameCn}`).join('\u0001')
}

function moduleSignature(list: Module[]): string {
  return list.map((m) => `${m.id}|${m.displayName}|${m.contentEn}|${m.weight}|${m.isEnabled ? 1 : 0}|${m.isNsfw ? 1 : 0}|${m.usageCount}`).join('\u0002')
}

function groupedSignature(grouped: Record<string, Module[]>): string {
  return Object.keys(grouped).sort().map((k) => `${k}\u0003${moduleSignature(grouped[k] ?? [])}`).join('\u0001')
}

  async function fetchAll(): Promise<void> {
    if (loading.value) return
    loading.value = true
    syncing.value = true
    try {
      const [dims, grouped] = await Promise.all([dbGetDimensions(), dbGetAllModulesGrouped()])
      // 统一按 dimension.id 归一的视图，兼容 db 返回按 key 分组的形态
      // 这里直接以 grouped 的 key 透传，消费方（BatchFactory）按 dim.key 消费；
      // DimensionPanel 另有按 id 归一的 refresh，保持兼容，不在此处二次转换
      // 内容未变化时不替换引用：避免消费方 computed/列表整体失效重绘（滚动位置随之丢失）
      const nextDims = dims
      const nextGrouped = grouped as Record<string, Module[]>
      if (dimSignature(dimensions.value) !== dimSignature(nextDims)) dimensions.value = nextDims
      if (groupedSignature(modulesByDim.value) !== groupedSignature(nextGrouped)) modulesByDim.value = nextGrouped
      dirty.value = false
      lastSyncedAt.value = Date.now()
    } catch (e) {
      // jsdom 无 Tauri 时降级：保留旧值
      logger.warn('library', 'fetchAll 失败（jsdom 无 Tauri 时降级，保留旧值）：', e)
    } finally {
      loading.value = false
      syncing.value = false
    }
  }

  function scheduleFetch(): void {
    // 小库：立即同步
    if (total.value <= THRESHOLD) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      dirty.value = true
      void fetchAll()
      return
    }
    // 大库：防抖 10s 合并
    dirty.value = true
    if (timer) clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      void fetchAll()
    }, DEBOUNCE_MS)
  }

  async function ensureFreshForRandom(): Promise<void> {
    // 随机按钮不受防抖约束：有脏标记或大库或尚未加载时强制实时拉取
    if (dirty.value || isLarge.value || dimensions.value.length === 0) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      await fetchAll()
    }
  }

  function dispose(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    dimensions,
    modulesByDim,
    loading,
    dirty,
    syncing,
    lastSyncedAt,
    total,
    isLarge,
    dimOrderMap,
    fetchAll,
    scheduleFetch,
    ensureFreshForRandom,
    dispose,
  }
})
