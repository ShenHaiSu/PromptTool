/**
 * EP 通知适配器：应用启动时被 main.ts 静态引入一次，把 ElMessage 注册到通知总线。
 * - 本模块是唯一静态引用 element-plus 根包的通知链路文件（其余 40+ 静态引用方
 *   本就同属主包，故不再触发 dynamic-import 分包警告）。
 * - vitest 下 css:false + inline element-plus，静态引入安全可用；
 *   单测如需断言通知，改为往总线注册 mock（见 notify.test.ts），无需 mock EP。
 */
import { ElMessage } from 'element-plus'
import { registerNotifyHandler } from './notify'

registerNotifyHandler((message, type, ms = 3000) => {
  ElMessage({ message, type, duration: ms, showClose: type === 'error', grouping: true })
})
