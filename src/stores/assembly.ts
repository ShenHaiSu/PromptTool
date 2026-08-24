import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { assemble } from '@/engine/assembly'
import { PromptIR } from '@/engine/models'
import type { AssemblyConfig, SelectedItem } from '@/engine/models'
import { defaultAssemblyConfig } from '@/engine/models'

export const useAssemblyStore = defineStore('assembly', () => {
  const selectedItems = ref<SelectedItem[]>([])
  const config = ref<AssemblyConfig>({ ...defaultAssemblyConfig() })
  const ir = ref<PromptIR>(new PromptIR([], []))
  const finalPrompt = ref('')
  const warnings = computed(() => ir.value.warnings)

  function reassemble() {
    const { ir: nextIr, finalPrompt: nextFinal } = assemble(selectedItems.value, config.value)
    ir.value = nextIr
    finalPrompt.value = nextFinal
  }

  function setSelected(items: SelectedItem[]) {
    selectedItems.value = items
    reassemble()
  }

  // 文档契约别名：setItems / moveItem / reorder 语义收敛
  function setItems(items: SelectedItem[]) {
    setSelected(items)
  }

  function moveItem(from: number, to: number) {
    reorder(from, to)
  }

  function addModule(item: SelectedItem) {
    // prevent duplicate module.id unless multi_select dimension (handled upstream)
    if (selectedItems.value.some((it) => it.module.id === item.module.id)) return
    selectedItems.value = [...selectedItems.value, item]
    reassemble()
  }

  function removeModule(moduleId: string) {
    selectedItems.value = selectedItems.value.filter((it) => it.module.id !== moduleId)
    reassemble()
  }

  function updateWeight(moduleId: string, weight: number | null) {
    selectedItems.value = selectedItems.value.map((it) =>
      it.module.id === moduleId ? { ...it, weightOverride: weight } : it,
    )
    reassemble()
  }

  function toggleLocked(moduleId: string) {
    selectedItems.value = selectedItems.value.map((it) =>
      it.module.id === moduleId ? { ...it, locked: !it.locked } : it,
    )
    reassemble()
  }

  function reorder(from: number, to: number) {
    const arr = [...selectedItems.value]
    const [moved] = arr.splice(from, 1)
    if (moved) arr.splice(to, 0, moved)
    selectedItems.value = arr
    // customDragOrder: keep visual order
    if (config.value.sortBy === 'customDragOrder') reassemble()
    else reassemble()
  }

  function setConfig(patch: Partial<AssemblyConfig>) {
    config.value = { ...config.value, ...patch }
    reassemble()
  }

  function clear() {
    selectedItems.value = []
    ir.value = new PromptIR([], [])
    finalPrompt.value = ''
  }

  return {
    selectedItems,
    config,
    ir,
    finalPrompt,
    warnings,
    reassemble,
    setSelected,
    setItems,
    moveItem,
    addModule,
    removeModule,
    updateWeight,
    toggleLocked,
    reorder,
    setConfig,
    clear,
  }
})
