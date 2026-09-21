# Need04-03 — 排序口径与 Fallback 设计

## 一、三级优先级（唯一口径）

`src/engine/assembly.ts sortByOrder` 改造后：

```ts
import type { Dimension } from './models'

const DIM_ORDER: Record<string, number> = {
  gender: 0, ethnicity: 1, height: 2, body: 3, face: 4,
  top: 5, bottom: 6, outfit: 7, shoes: 8, accessories: 9,
  pose: 10, props: 11, background: 12, camera: 13,
} // ← 保留，仅第 2 级兜底

export function buildDimOrderMap(dims: Dimension[]): Record<string, number> {
  return Object.fromEntries(dims.map((d) => [d.key, d.sortOrder]))
}

export function sortByOrder(
  items: SelectedItem[], mode: string, dimOrderMap?: Record<string, number>,
): SelectedItem[] {
  if (mode === 'customDragOrder') return [...items]
  return [...items].sort((a, b) => {
    const ka = a.module.dimensionKey ?? ''
    const kb = b.module.dimensionKey ?? ''
    const oa = dimOrderMap?.[ka] ?? DIM_ORDER[ka] ?? Number.MAX_SAFE_INTEGER
    const ob = dimOrderMap?.[kb] ?? DIM_ORDER[kb] ?? Number.MAX_SAFE_INTEGER
    return oa - ob
  })
}
```

| 级别 | 命中条件 | 示例 |
|------|----------|------|
| L1 `dimOrderMap[key]` | 正常生产链路 всегда命中 | `pose → 1`（用户调前）、新维度 `my_style → 0`（插队最前） |
| L2 `DIM_ORDER[key]` | `map` 为空/缺键（首屏未 `fetchAll`、单测未传 `map`、历史快照维度已删） | 老单测 `sortByOrder(items,'dimensionOrder')` 不传参仍过 |
| L3 `MAX_SAFE_INTEGER` | 全新未知 `key` 且不在 `DIM_ORDER` | 沉底；同值间靠稳定排序保输入序，不崩 |

## 二、为什么不用 `99`

现状 `?? 99` 把“已知内置”与“未知新建”混在同一桶，且 `99` 与未来正常 `sortOrder`（`max+1` 持续增长，`db.dimensions.ts:117-141`）可能碰撞。`MAX_SAFE_INTEGER` 语义明确：未知永远在已知之后；已知之间永远按值排。

## 三、稳定排序依赖

`Array.prototype.sort` 在现代 V8/JS 引擎保证稳定。同 `sortOrder`（如批量导入时重复值，见 `db.library.ts:159-178 nextSort++` 正常不会重复，但手工改值可能）时保持 `picked` 顺序，即 `dimensions` 输入顺序，即 DB 序。禁止再加第二关键字（如按 `key` 字母排），否则会掩盖输入序、难调试。

## 四、`customDragOrder` 不变

```ts
if (mode === 'customDragOrder') return [...items]
```

拖拽顺序是用户显式意图，优先级高于一切权重。`useDragSort.ts` 与 `assembly.reorder` 逻辑不动。

## 五、边界表

| 输入 | 输出 |
|------|------|
| `mode='customDragOrder'`，任意 `map` | 输入序原样返回 |
| `map={}`（`library` 为空） | 回退 `DIM_ORDER`，行为与现状一致 |
| `map` 缺某个 `key`（维度已删、历史回放） | 该段沉底，不抛错 |
| `dimensionKey` 为 `null/''`（脏数据） | `''` 查不到表，沉底 |
| `sortOrder` 重复 | 保输入序（DB 序），可预期 |
| 新维度 `sortOrder=0` | 排到 `gender` 之前，符合“数字越小越靠前” |
