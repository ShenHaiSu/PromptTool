import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'

/**
 * 监听容器宽度，替代 tkinter `bind<Configure>` + wraplength 计算
 * 返回响应式的 contentRect 宽度，用于自适应截断/换行
 */
export function useResizeObserver(targetRef: Ref<HTMLElement | null>) {
  const width = ref(0)
  const height = ref(0)
  let observer: ResizeObserver | null = null

  function observe(el: HTMLElement): void {
    observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      width.value = entry.contentRect.width
      height.value = entry.contentRect.height
    })
    observer.observe(el)
  }

  onMounted(() => {
    if (targetRef.value) observe(targetRef.value)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })

  // 支持外部在 target 变化后手动 attach
  function attach(el: HTMLElement | null): void {
    observer?.disconnect()
    if (el) observe(el)
  }

  return { width, height, attach }
}
