 import { createApp } from "vue"
 import { createPinia } from "pinia"
 import App from "./App.vue"
 import { notify } from "@/lib/notify"
 import "@/lib/notifyEp"
 import 'element-plus/dist/index.css'
 import 'element-plus/theme-chalk/dark/css-vars.css'
 import "./app.css"
 import "./styles/ep-overrides.css"
 const app = createApp(App)

 // 全局错误处理：保持 console.error，走 notify（S5收敛后统一为EP Message）
 app.config.errorHandler = (err, _instance, info) => {
   console.error('[PMF errorHandler]', info, err)
   try {
     notify(`发生错误: ${String((err as Error)?.message ?? err)}`, 'error')
   } catch {
     // 忽略二次错误，避免循环
   }
 }

window.addEventListener('error', (e) => {
  console.error('[PMF window.error]', e.error ?? e.message)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[PMF unhandledrejection]', e.reason)
})

app.use(createPinia())
app.mount("#app")
