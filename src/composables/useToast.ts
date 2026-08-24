import { ref } from "vue"

export interface ToastItem {
  id: number
  message: string
  type: "info" | "success" | "warning" | "error"
}

let nextId = 1
const toasts = ref<ToastItem[]>([])

const MAX_TOASTS = 5

export function useToast() {
  function push(message: string, type: ToastItem["type"] = "info", ms = 3000): void {
    const id = nextId++
    // 队列溢出保护：超过 MAX_TOASTS 丢弃最旧
    if (toasts.value.length >= MAX_TOASTS) {
      toasts.value = [...toasts.value.slice(1), { id, message, type }]
    } else {
      toasts.value = [...toasts.value, { id, message, type }]
    }
    window.setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, ms)
  }

  function clear(): void {
    toasts.value = []
  }

  return { toasts, push, clear }
}

// Singleton for app-wide use
export const appToasts = toasts
