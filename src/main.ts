import { createApp } from "vue"
import { createPinia } from "pinia"
import App from "./App.vue"
import "./app.css"

const app = createApp(App)

// 全局错误处理（阶段六）
app.config.errorHandler = (err, _instance, info) => {
  console.error('[PMF errorHandler]', info, err)
  try {
    const el = document.querySelector('[data-testid="toasts"]')
    if (el) {
      const toast = document.createElement('div')
      toast.className = 'pointer-events-auto rounded-md border border-red-500/30 bg-red-50 px-3 py-2 text-sm shadow-lg dark:bg-red-950'
      toast.textContent = `发生错误: ${String((err as Error)?.message ?? err)}`
      el.appendChild(toast)
      window.setTimeout(() => toast.remove(), 3500)
    }
  } catch { /* ignore */ }
}

window.addEventListener('error', (e) => {
  console.error('[PMF window.error]', e.error ?? e.message)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[PMF unhandledrejection]', e.reason)
})

app.use(createPinia())
app.mount("#app")
