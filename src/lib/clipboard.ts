/**
 * 纯 Web 剪贴板 helper（阶段三）。
 * 主路径 navigator.clipboard.writeText，失败回退 execCommand('copy')；
 * 非安全上下文（file:// / 非 localhost 的 http）下 clipboard 不可用时，
 * 返回 needManual，调用方提示用户“选中文本手动复制（Ctrl+C）”。
 */

export type CopyResult =
  | { ok: true; method: 'clipboard' | 'execCommand' }
  | { ok: false; method: 'none'; needManual: true }

function isSecureContextSafe(): boolean {
  try {
    if (typeof window !== 'undefined' && typeof window.isSecureContext === 'boolean') {
      return window.isSecureContext
    }
  } catch { /* ignore */ }
  return true
}

function fallbackExecCommand(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export async function copyText(text: string): Promise<CopyResult> {
  if (!text) return { ok: false, method: 'none', needManual: true }
  // 主路径：Clipboard API（需要安全上下文；file:// 下多为可用性缺失）
  try {
    if (!isSecureContextSafe()) throw new Error('insecure-context')
    await navigator.clipboard.writeText(text)
    return { ok: true, method: 'clipboard' }
  } catch {
    // 回退：execCommand
    if (fallbackExecCommand(text)) return { ok: true, method: 'execCommand' }
    return { ok: false, method: 'none', needManual: true }
  }
}

/** 复制失败时的统一提示文案。 */
export function manualCopyHint(): string {
  return '自动复制不可用，请选中文本后按 Ctrl+C 手动复制'
}
