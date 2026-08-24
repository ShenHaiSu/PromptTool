import { ref } from "vue"

export interface ToastItem {
  id: number
  message: string
  type: "info" | "success" | "warning" | "error"
}

let nextId = 1
const toasts = ref<ToastItem[]>([])

export function useToast() {
  function push(message: string, type: ToastItem["type"] = "info", ms = 3000): void {
    const id = nextId++
    toasts.value.push({ id, message, type })
    window.setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, ms)
  }

  return { toasts, push }
}

// Singleton for app-wide use
export const appToasts = toasts
