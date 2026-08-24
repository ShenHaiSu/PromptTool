import { computed } from 'vue'
import type { SelectedItem } from '@/engine/models'
import { useAssemblyStore } from '@/stores/assembly'

/**
 * 封装 vue-draggable-plus 的拖拽逻辑
 * 仅在 drop 时触发 reorder + reassemble，避免每帧 reassemble
 */
export function useDragSort() {
  const assembly = useAssemblyStore()

  const items = computed<SelectedItem[]>({
    get: () => assembly.selectedItems,
    set: (val: SelectedItem[]) => {
      // vue-draggable-plus 通过 v-model 直接赋值数组；同步回 store（保持引用一致）
      assembly.setSelected(val)
    },
  })

  function onDragEnd(evt: { oldIndex: number; newIndex: number }): void {
    const { oldIndex, newIndex } = evt
    if (oldIndex == null || newIndex == null || oldIndex === newIndex) return
    // setSelected 已通过 v-model 同步，此处仅确保 reassemble（setSelected 已调）
    // 若走自定义 reorder 路径则调用 store.reorder
    if (assembly.config.sortBy === 'customDragOrder') {
      // v-model 已更新顺序，无需二次 reorder，直接 reassemble 已在 setSelected 中完成
    }
  }

  return { items, onDragEnd }
}
