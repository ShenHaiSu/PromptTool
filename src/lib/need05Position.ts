/**
 * need05 定位helpers — 浮窗与右键菜单的视口自适应
 * 纯函数，便于单测
 */
export const POPOVER_W = 224
export const POPOVER_H_EST = 180
export const GAP = 8
export const MENU_W = 180
export const MENU_H_EST = 80

export function calcPopoverPos(
  anchor: { top: number; bottom: number; left: number },
  popoverW: number,
  popoverH: number,
  viewportW: number,
  viewportH: number,
  gap = GAP,
): { top: number; left: number } {
  let top = anchor.bottom + gap
  let left = anchor.left
  if (top + popoverH > viewportH - gap) {
    top = anchor.top - popoverH - gap
  }
  if (left + popoverW > viewportW - gap) {
    left = viewportW - popoverW - gap
  }
  if (left < gap) left = gap
  if (top < gap) top = gap
  return { top, left }
}

export function calcMenuPos(
  clientX: number,
  clientY: number,
  menuW: number,
  menuH: number,
  viewportW: number,
  viewportH: number,
  gap = GAP,
): { top: number; left: number } {
  let left = clientX
  let top = clientY
  if (left + menuW > viewportW - gap) left = viewportW - menuW - gap
  if (top + menuH > viewportH - gap) top = viewportH - menuH - gap
  if (left < gap) left = gap
  if (top < gap) top = gap
  return { top, left }
}
