import { notify } from './notify'

/**
 * need03 S5: 错误收敛 — 统一 logger，console 透出 + 可选 notify。
 * 禁止新增空 catch，一律 logger.warn/error。
 */
export const logger = {
  warn(module: string, ...args: unknown[]): void {
    console.warn(`[${module}]`, ...args)
  },
  error(module: string, ...args: unknown[]): void {
    console.error(`[${module}]`, ...args)
  },
  /** 用户无感知的后台动作失败 */
  warnSilent(module: string, action: string, err: unknown): void {
    console.warn(`[${module}] ${action}失败：`, err)
  },
  /** 用户动作失败：打日志 + 弹错误 */
  fail(module: string, userMsg: string, err: unknown): void {
    console.error(`[${module}] ${userMsg}：`, err)
    notify(`${userMsg}`, 'error')
  },
}
