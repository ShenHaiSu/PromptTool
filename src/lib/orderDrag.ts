export type RowRect = { top: number; height: number }

/**
 * 指针拖拽落点计算（need03 D1 方案B）。
 *
 * 把被拖行排除在外，对其余各行的「垂直中点」计数：
 * 落在多少个中点下方，目标位序就是多少。经移除-插入换算后，
 * 该计数值恰好等于目标行在最终数组中的下标（0-based）。
 *
 * @param clientY 指针当前 Y（client 坐标）
 * @param rows 各行几何（与 localOrder 同序，含被拖行）
 * @param fromIndex 被拖行在 rows 中的下标
 */
export function calcInsertIndex(clientY: number, rows: RowRect[], fromIndex: number): number {
  if (rows.length === 0) return 0
  let k = 0
  for (let j = 0; j < rows.length; j++) {
    if (j === fromIndex) continue
    const mid = rows[j]!.top + rows[j]!.height / 2
    if (clientY > mid) k++
  }
  return Math.max(0, Math.min(rows.length - 1, k))
}
