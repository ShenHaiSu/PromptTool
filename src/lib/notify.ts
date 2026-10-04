export type NotifyType = 'info' | 'success' | 'warning' | 'error'

/**
 * need03 S5: 通知统一 — 与旧 useToast.push(message, type, ms) 签名完全一致，
 * 内部用 ElMessage 实现（动态导入，避免 vitest 静态加载 EP CSS）。
 * 旧 useToast/appToasts 冻结，不再新增调用。
 */
/**
 * EP 模块只加载一次并缓存 Promise：重复动态 import 在测试环境（mock 命名空间冻结）
 * 会静默失效，导致后续通知不弹窗。缓存 Promise 保证每次 notify 都能派发。
 */
let epPromise: Promise<typeof import('element-plus')> | null = null

function loadElementPlus(): Promise<typeof import('element-plus')> {
  epPromise ??= import('element-plus')
  return epPromise
}

export function notify(message: string, type: NotifyType = 'info', ms = 3000): void {
  try {
    void loadElementPlus()
      .then(({ ElMessage }) => {
        try {
          ElMessage({ message, type, duration: ms, showClose: type === 'error', grouping: true })
        } catch (e) {
          // notify.ts 是 logger 的上游依赖，不可 import logger（循环依赖），此处用 console 留痕
          console.error('[notify] ElMessage 调用失败，回退到 console：', e)
          fallbackLog(message, type)
        }
      })
      .catch((e: unknown) => { console.error('[notify] element-plus 动态导入失败：', e); fallbackLog(message, type) })
  } catch (e) {
    console.error('[notify] 通知派发失败：', e)
    fallbackLog(message, type)
  }
}

function fallbackLog(message: string, type: NotifyType): void {
  if (type === 'error') console.error('[notify]', message)
  else console.log('[notify]', type, message)
}

/** 兼容旧 push 命名 */
export const push = notify
