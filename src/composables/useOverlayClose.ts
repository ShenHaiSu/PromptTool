 import { ref, watch, onBeforeUnmount, isRef, getCurrentInstance, type Ref } from 'vue'

export type OverlayCloseOptions = {
  /** Dialog 打开状态。提供时 Esc 仅在 open 为 true 时响应；不提供则监听器常驻（不推荐）。 */
  open?: Ref<boolean>
  /** 是否启用 Esc 关闭，默认 true。已有 document 级 Esc 监听的 Dialog 传 false 避免双重触发。 */
  enableEscape?: boolean | Ref<boolean>
  /** 忙态（保存中/导入中/迁移中等）下遮罩与 Esc 均不关闭。回调内亦可自行守卫，此处为统一兜底。 */
  isBusy?: Ref<boolean> | (() => boolean)
}

/**
 * 遮罩"外部按下＋外部松开才关闭"判定（docs/need03 D2）。
 *
 * 背景：浏览器 `click.target` 取 mousedown/mouseup 的最近公共祖先，
 * `@click.self` 会在"内部按下→外部松开"时误关。改用 mousedown 落点 + click 落点双重判定。
 *
 * 用法：
 * ```vue
 * <script setup>
 * const oc = useOverlayClose(() => onClose(), { open: computed(() => props.open) })
 * </script>
 * <div @mousedown="oc.onMouseDown" @click="oc.onClick">…</div>
 * <!-- 或 v-bind="oc.overlayBindings" -->
 * ```
 */
export function useOverlayClose(requestClose: () => void, options: OverlayCloseOptions = {}) {
  const pressedOnOverlay = ref(false)

  function escapeEnabled(): boolean {
    const v = options.enableEscape
    if (v === undefined) return true
    return isRef(v) ? (v as Ref<boolean>).value : (v as boolean)
  }

  function busy(): boolean {
    const b = options.isBusy
    if (b === undefined || b === null) return false
    if (typeof b === 'function') return !!(b as () => boolean)()
    return !!(b as Ref<boolean>).value
  }

  function onMouseDown(e: MouseEvent): void {
    // 右键（button===2）不应污染 flag
    if (e.button !== 0) return
    // 内容区事件也会冒泡到 overlay，必须用 === currentTarget 过滤
    pressedOnOverlay.value = e.target === e.currentTarget
  }

  function onClick(e: MouseEvent): void {
    const releaseOnOverlay = e.target === e.currentTarget
    const pressOnOverlay = pressedOnOverlay.value
    // 无论是否关闭都要复位（含内容区点击冒泡上来的 click）
    pressedOnOverlay.value = false
    if (releaseOnOverlay && pressOnOverlay) {
      if (busy()) return
      requestClose()
    }
  }

  function onEscapeKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return
    if (!escapeEnabled()) return
    if (busy()) return
    requestClose()
  }

  function reset(): void {
    pressedOnOverlay.value = false
  }

  function addEscape(): void {
    if (typeof document === 'undefined') return
    document.addEventListener('keydown', onEscapeKey)
  }

  function removeEscape(): void {
    if (typeof document === 'undefined') return
    document.removeEventListener('keydown', onEscapeKey)
  }

   const hasInstance = getCurrentInstance() !== null
   if (options.open && hasInstance) {
     const stop = watch(
       [() => options.open!.value, () => escapeEnabled()],
       ([isOpen, en]) => {
         removeEscape()
         if (isOpen && en) addEscape()
       },
       { immediate: true },
     )
     onBeforeUnmount(() => {
       stop()
       removeEscape()
     })
   } else if (!options.open && hasInstance && typeof document !== 'undefined') {
     // 无 open 引用时退化为常驻监听（调用方需自行保证仅 open 时挂载）
     addEscape()
     onBeforeUnmount(removeEscape)
   }
   // 无组件实例的纯函数调用（如单测直接调用）：不注册任何监听器，仅保留 mousedown/click 判定

  const overlayBindings = { onMousedown: onMouseDown, onClick }
  return {
    pressedOnOverlay,
    onMouseDown,
    onClick,
    reset,
    overlayBindings,
    /** 别名：docs/need03 §2.2 模板骨架使用的名字 */
    overlayCloseBindings: overlayBindings,
  }
}
