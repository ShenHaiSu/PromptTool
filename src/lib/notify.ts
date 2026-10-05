export type NotifyType = 'info' | 'success' | 'warning' | 'error'

/**
 * need03 S5: 通知统一出口 —— 与旧 useToast.push(message, type, ms) 签名完全一致。
 *
 * 解耦设计（通知总线）：
 * - 本模块是零依赖叶子：不 import element-plus / logger / 任何 store，
 *   因此任何层（lib / stores / composables / components / main）静态引用都不会
 *   形成循环，也不会触发 "dynamic import will not move module into another chunk"。
 * - 真正的 EP 渲染由 `src/lib/notifyEp.ts` 在应用启动时注册一次；
 *   未注册（单测 / EP 不可用）时降级为 console 留痕，保证永不抛错。
 * - 旧 useToast/appToasts 冻结，不再新增调用。
 */
export type NotifyHandler = (message: string, type: NotifyType, ms?: number) => void

let handler: NotifyHandler | null = null

/** 应用启动时注册一次（见 src/lib/notifyEp.ts）；单测可注册 mock。 */
export function registerNotifyHandler(h: NotifyHandler): void {
  handler = h
}

/** 仅供单测隔离：清除已注册的 handler。 */
export function __clearNotifyHandler(): void {
  handler = null
}

export function notify(message: string, type: NotifyType = 'info', ms = 3000): void {
  try {
    if (handler) {
      handler(message, type, ms)
      return
    }
  } catch (e) {
    // notify 是 logger 的上游依赖，不可 import logger（循环依赖），此处用 console 留痕
    console.error('[notify] handler 调用失败，回退到 console：', e)
  }
  fallbackLog(message, type)
}

function fallbackLog(message: string, type: NotifyType): void {
  if (type === 'error') console.error('[notify]', message)
  else console.log('[notify]', type, message)
}

/** 兼容旧 push 命名 */
export const push = notify
