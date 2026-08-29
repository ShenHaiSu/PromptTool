import { defineStore } from 'pinia'
import { ref } from 'vue'
import { randomAssembly, partialRandomAssembly } from '@/engine/random'
import { adaptToModel } from '@/engine/adapters'
import type { AssemblyConfig, BatchCardModel, Dimension, Module, SelectedItem } from '@/engine/models'
import { useRandomHistoryStore } from '@/stores/randomHistory'

export const useBatchStore = defineStore('batch', () => {
  const results = ref<BatchCardModel[]>([])
  const isGenerating = ref(false)

  function generate(
    dimensions: Dimension[],
    modulesByDim: Record<string, Module[]>,
    lockedIds: Set<string>,
    count: number,
    config: AssemblyConfig,
    allowNsfw = false,
  ) {
    isGenerating.value = true
    try {
      const historyStore = useRandomHistoryStore()
      const irs = randomAssembly(dimensions, modulesByDim, lockedIds, count, config, allowNsfw, historyStore.state)
      if (irs.length > 0) historyStore.persist()
      results.value = irs.map((ir, idx) => ({
        index: idx + 1,
        ir,
        finalPrompt: adaptToModel(ir, config.modelProfile, config),
        warnings: [...ir.warnings],
        dimKeys: ir.segments.map((s) => s.dimensionKey),
        hash: ir.hash(),
      }))
    } finally {
      isGenerating.value = false
    }
  }

  function generatePartial(
    dimensions: Dimension[],
    modulesByDim: Record<string, Module[]>,
    anchored: SelectedItem[],
    count: number,
    config: AssemblyConfig,
    allowNsfw = false,
  ) {
    isGenerating.value = true
    try {
      const historyStore = useRandomHistoryStore()
      const irs = partialRandomAssembly(dimensions, modulesByDim, anchored, count, config, allowNsfw, historyStore.state)
      if (irs.length > 0) historyStore.persist()
      results.value = irs.map((ir, idx) => ({
        index: idx + 1,
        ir,
        finalPrompt: adaptToModel(ir, config.modelProfile, config),
        warnings: [...ir.warnings],
        dimKeys: ir.segments.map((s) => s.dimensionKey),
        hash: ir.hash(),
      }))
    } finally {
      isGenerating.value = false
    }
  }

  function clear() {
    results.value = []
  }

  function updateBatch(next: BatchCardModel[]) {
    results.value = next
  }

  function clearHistory(): void {
    const historyStore = useRandomHistoryStore()
    historyStore.clear()
  }

  return { results, isGenerating, generate, generatePartial, clear, updateBatch, clearHistory }
})
