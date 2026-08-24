/**
 * useShortcuts — 全局快捷键
 * Ctrl+F 聚焦搜索 / Ctrl+S 保存 / Ctrl+C 复制 / Delete 删除
 * 对标阶段六「全局能力：快捷键 Ctrl+F/S/C + Delete」
 */
import { onMounted, onBeforeUnmount } from 'vue'

export type ShortcutHandlers = {
  focusSearch?: () => void
  save?: () => void
  copy?: () => void
  remove?: () => void
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

export function useShortcuts(handlers: ShortcutHandlers) {
  function onKeydown(e: KeyboardEvent): void {
    const key = e.key.toLowerCase()
    const isCtrl = e.ctrlKey || e.metaKey
    const inInput = isEditableTarget(e.target)

    // Ctrl+F 聚焦搜索 — 即使在输入框也允许（聚焦搜索本身）
    if (isCtrl && key === 'f') {
      if (!handlers.focusSearch) return
      e.preventDefault()
      handlers.focusSearch()
      return
    }

    // Ctrl+S 保存 — 在输入框内不劫持，避免与浏览器保存冲突？阶段三 App.vue 已约定输入框内不劫持
    if (isCtrl && key === 's') {
      if (!handlers.save) return
      if (inInput) return
      e.preventDefault()
      handlers.save()
      return
    }

    // Ctrl+C 复制 — 仅当有 handlers.copy 且不在输入框（输入框原生复制优先）
    if (isCtrl && key === 'c') {
      if (!handlers.copy) return
      if (inInput) return
      // 避免在无选中内容时劫持
      e.preventDefault()
      handlers.copy()
      return
    }

    // Delete 删除已选末项 — 在输入框内不劫持（避免误删输入）
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isCtrl) {
      // Backspace 仅在非输入框时视为删除，避免输入框回删冲突
      if (inInput) return
      if (!handlers.remove) return
      // 若焦点在 body 或画布区，允许 Delete
      e.preventDefault()
      handlers.remove()
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

  // 手动绑定/解绑（供非组件上下文或测试）
  function attach(): void {
    window.addEventListener('keydown', onKeydown)
  }
  function detach(): void {
    window.removeEventListener('keydown', onKeydown)
  }

  return { attach, detach }
}
