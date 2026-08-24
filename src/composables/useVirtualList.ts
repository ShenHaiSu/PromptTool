import { ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'

export function useVirtualList(countRef: { value: number }, estimateSize = 110) {
  const parentRef = ref<HTMLElement | null>(null)

  const virtualizer = useVirtualizer({
    count: countRef.value,
    getScrollElement: () => parentRef.value,
    estimateSize: () => estimateSize,
    overscan: 5,
  })

  // 响应式 count 更新
  // TanStack Virtual 的 count 是响应式的，需通过 computed 动态传参；
  // 此封装保留引用，由调用方直接使用 virtualizer 实例
  return { parentRef, virtualizer }
}
