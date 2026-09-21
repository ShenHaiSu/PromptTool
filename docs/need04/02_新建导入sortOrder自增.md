# Need05-02 — 功能 B：新建与导入维度 `sortOrder` 按 `max+1` 自增

> 来源：`efb71fc fix(need04): 新建与导入维度sortOrder按max+1自增`（`web-pure`，2026-09-21）。
> 改动规模：3 文件，+59/-3（含 `db.idb.test.ts` +41 行测试）。

---

## 一、解决什么问题

此前新建/导入维度缺省 `sortOrder` 时一律写 `0`：

```ts
sortOrder: sortOrder ?? 0            // db.dimensions.ts（旧）
sortOrder: f.sortOrder ?? 0          // db.library.ts 导入两处（旧）
```

后果：每新建一个维度就往队首插一个 `0`，多个 `0` 之间顺序靠稳定排序碰运气；导入一批无 `sortOrder` 的维度则**全部挤在 `0`**，顺序不可预期。功能 A（01 文档）让 `sortOrder` 成为排序唯一真相源后，这个写入 bug 会直接污染排序，必须先修。

## 二、实现逻辑

- **新建**（`dbCreateDimension`）：`resolvedSort = sortOrder ?? max(存活维度)+1`，空库时 `max=0 → 1`；显式传值优先（允许 `0`/负数插队）。
- **导入**（`dbImportLibraryText`）：进入维度循环前先扫全库算 `nextSort = max(存活)+1`；遍历到无 `sortOrder` 的新维度时 `nextSort++` 递增分配；有显式值则原样保留且**不消耗** `nextSort`。
- 只看 `isDeleted === 0` 的存活行；已删除行的 `sortOrder` 不参与 max 计算，可被复用（符合软删除语义）。

## 三、`web-pure` 逐文件实现

### 3.1 `src/lib/db.dimensions.ts`（新建）

```ts
/** 计算下一个可用的 sortOrder：当前存活维度最大值 + 1（空库时为 1）。 */
async function nextSortOrder(db: IDBDatabase): Promise<number> {
  const rows = await tx(db, 'dimensions', 'readonly', (s) => getAll<DimRow>(s['dimensions']!))
  let max = 0
  for (const d of rows) if (d.isDeleted === 0 && d.sortOrder > max) max = d.sortOrder
  return max + 1
}

// dbCreateDimension 内（查重之后、组装 row 之前）：
const resolvedSort = sortOrder ?? (await nextSortOrder(db))
const row: DimRow = {
  // ...
  sortOrder: resolvedSort, // 旧：sortOrder ?? 0
}
```

注意 `nextSortOrder` 只在**未显式传值**时调用，显式传 `0` 不会被 max 覆盖（插队语义保留）。

### 3.2 `src/lib/db.library.ts`（导入）

```ts
// 进入维度循环前：
let nextSort = 1
for (const d of byId.values()) {
  if (d.isDeleted === 0 && d.sortOrder >= nextSort) nextSort = d.sortOrder + 1
}
// …id 冲突分支：
const sortVal = f.sortOrder ?? nextSort++
// …纯新增分支：
sortOrder: f.sortOrder ?? nextSort++,
```

### 3.3 `src/lib/db.idb.test.ts`（测试，+41 行）

- 新建自增：记 `maxSo`，连建 `auto_a/auto_b`（缺省）+ `auto_c`（显式 50），断言 `maxSo+1 / maxSo+2 / 50`，且三者落在 `dbGetDimensions()` 末尾。
- 导入递增：`overwrite` 导入 `[无, 显式5, 无]` 三维度，断言 `maxSo+1 / 5 / maxSo+2`，且 DB 序中 `显式5 < 无1 < 无2`。

## 四、Tauri 分支落地（重点：Rust 侧）

Tauri 前端 `src/lib/db.ts` 只是 `invoke` 封装，**无自增逻辑，不用动**；要改的是 Rust 后端。已核实 `tauri` 分支 `src-tauri/src/commands/db.rs` 存在同 bug：

| 位置 | 现状 | 改法 |
|------|------|------|
| `db_create_dimension` | `let so = sort_order.unwrap_or(0);` | 无显式值时查 `SELECT COALESCE(MAX(sort_order),0)+1 FROM dimensions WHERE is_deleted=0`；有显式值直接用 |
| `db_import_library` / `db_import_library_text` 内维度写入（另 2 处 `.unwrap_or(0)`，`fdim.sort_order` 附近） | 缺省 `0` | 先算 `next_sort = MAX(sort_order)+1`，遍历中 `fdim.sort_order.unwrap_or(take_next())` 递增；显式值优先且不消耗计数器 |

Rust 草图（按现有 `rusqlite` 风格）：

```rust
fn next_sort_order(conn: &Connection) -> Result<i64> {
    let max: Option<i64> =
        conn.query_row("SELECT MAX(sort_order) FROM dimensions WHERE is_deleted=0", [], |r| r.get(0))?;
    Ok(max.unwrap_or(0) + 1)
}
// 新建：let so = match sort_order { Some(v) => v, None => next_sort_order(&conn)? };
// 导入：let mut next_sort = next_sort_order(&conn)?;
//       … for fdim … { let so = fdim.sort_order.unwrap_or_else(|| { let v = next_sort; next_sort += 1; v }); … }
```

边界与 `web-pure` 对齐：只看 `is_deleted=0`；空表 → 1；显式 `0`/负数允许（插队）；导入时显式值不推进 `next_sort`。

另注意 Tauri `seed`（`db.rs` 末尾 `VALUES … sort_order: 6` 附近的初始 14 维）保持 `1..14` 不动（`need04-06` 契约：seed 幂等、非空不重写），本需求不做迁移。

## 五、Tauri 落地检查清单

- [ ] `db.rs → db_create_dimension`：`unwrap_or(0)` → `MAX+1`
- [ ] `db.rs → import` 两处维度写入：加 `next_sort` 递增分配
- [ ] 前端 `src/lib/db.ts`：不动（invoke 透传即可）
- [ ] 把 `db.idb.test.ts` 新增 2 条用例翻译为 Rust 侧集成测试或手动验证：连建 2 个无值维度 + 1 个显式值维度，查 `ORDER BY sort_order` 尾部顺序
- [ ] 先落本功能 B，再落 01 文档的功能 A（写对 → 读对）
