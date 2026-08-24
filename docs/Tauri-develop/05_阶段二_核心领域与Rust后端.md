# 05 阶段二：核心领域与 Rust 后端

> **阶段编号：** P1-02 · **预计工期：** 3 人天 · **前置阶段：** 阶段一（基座通过） · **分支：** `feat/tauri-vue-rust`

---

## 一、前置检查方案

| # | 检查项 | 命令（`tauri-app/`） | 目的 |
|---|--------|----------------------|------|
| C1 | 阶段一验收通过 | `bun run build` + `cargo check` 均 EXIT:0 | 基座就绪 |
| C2 | 依赖就绪 | `bun list pinia tailwindcss` / `cargo tree \| grep rusqlite` | 依赖已装 |
| C3 | 原引擎可读 | `ls ../../src/engine/*.py && wc -l ../../src/engine/*.py` | 翻译源存在 |
| C4 | 原 Schema 可读 | `cat ../../src/db/schema.sql \| head -20` | 迁移源存在 |
| C5 | Vitest 就绪 | `bunx vitest --version` | 测试框架可用 |

---

## 二、前置检查结果期望值

| # | 期望 | 判定 |
|---|------|------|
| C1 | `build` 582ms级通过，`cargo check` 无 error | 阻塞项 |
| C2 | `pinia`, `rusqlite` 均列出 | 缺失则 `bun add`/`cargo add` |
| C3 | 5 文件共 ~525 行 | 与 01 章一致 |
| C4 | `CREATE TABLE dimensions` 首行正常 | 存在 |
| C5 | `vitest 2.x` | 正常 |

---

## 三、既定目标

### 3.1 交付物

- [ ] `src/engine/*.ts` 完整 TS 重写：`models/assembly/rules/adapters/random`，与 Python 行为 1:1
- [ ] `src-tauri/src/commands/{mod,db,migration}.rs`：rusqlite WAL + 7表 CRUD + 种子导入 + 旧库迁移 Command
- [ ] `src/lib/db.ts`：TS invoke 封装
- [ ] Vitest 单测 60+ 通过（对标原 pytest 54）

### 3.2 量化目标

- TS engine 单测覆盖 >80%，`bunx vitest run` 全绿
- Rust `cargo test`（若有）通过，`cargo check` 0 错误
- `invoke('db_get_dimensions')` 前后端打通，返回 14 维

---

## 四、实现方案

### 4.1 TS Engine 翻译要点（`src/engine/`）

| 原文件 | 翻译注意 |
|--------|----------|
| `models.py` | `dataclass → interface`，`weight: float → number`，`PromptIR.hash()` 用 `crypto.subtle` 或简易 `md5`（`js-md5`） |
| `assembly.py` | `assemble(selected, config) → {ir, finalPrompt}`，`sortByOrder` 双模式保留，`dimensionOrder` map 14维顺序 |
| `rules.py` | R01(套装互斥) R02(裸足) R03(室内外) 逐行平移；`id(it)` 身份比较改为 `Set<object>` 或 `WeakSet` |
| `adapters.py` | `adaptToModel(ir, profile, config)` SD/MJ/Flux 同步；SD 权重 `>1 → (text:1.2)`、`<1 → [text]` |
| `random_engine.py` | `random.choices` → `weightedSample(pool, weights, k)` 自实现；`partialRandomAssembly` 缺口维度+禁忌过滤平移 |

**关键契约（与 Python 一致）：**

```ts
// src/engine/models.ts 核心类型
export type ModelProfile = 'sd' | 'mj' | 'flux'
export type SortBy = 'dimensionOrder' | 'customDragOrder'
// PromptIR.hash() 必须与 Python hashlib.md5("|".join(f"{d}:{t}:{w}")) 一致，否则去重不一致
```

### 4.2 Rust 后端（`src-tauri/src/commands/`）

**`migration.rs` 关键逻辑**

```rust
pub fn init_db(app_handle: &AppHandle) -> Result<Connection, String> {
    let dir = app_handle.path().app_data_dir().unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("pmf.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    if is_new_db(&conn) { conn.execute_batch(include_str!("../../../src/db/schema.sql"))?; }
    migrate_if_needed(&conn)?; // 幂等补列/索引
    seed_if_empty(&conn, app_handle)?; // 14维+311条+3规则
    Ok(conn)
}
```

**`db.rs` 事务示例**

```rust
#[tauri::command]
pub fn db_save_assembly(title: Option<String>, ir_json: String, final_prompt: String, config: AssemblyConfig, items: Vec<SelectedItem>, is_favorite: bool) -> Result<String, String> {
    let conn = get_conn()?;
    let tx = conn.unchecked_transaction()?;
    let id = Uuid::new_v4().to_string();
    tx.execute("INSERT INTO assemblies ...", params![id, title, ir_json, final_prompt, ...])?;
    for (idx, it) in items.iter().enumerate() { tx.execute("INSERT INTO assembly_items ...", params![Uuid::new_v4().to_string(), id, it.module.id, idx as i64, it.weight_override, it.locked as i32])?; }
    tx.commit()?; Ok(id)
}
```

**`lib.rs` 注册**

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::db::db_get_dimensions, commands::db::db_get_all_modules_grouped,
            commands::db::db_save_assembly, commands::db::db_list_recent, // ... 全量
            commands::migration::db_import_legacy_db
        ])
        .run(tauri::generate_context!()).expect("...");
}
```

### 4.3 文件清单

| 文件 | 动作 |
|------|------|
| `src/engine/models.ts` | 新增 |
| `src/engine/assembly.ts` | 新增 |
| `src/engine/rules.ts` | 新增 |
| `src/engine/adapters.ts` | 新增 |
| `src/engine/random.ts` | 新增 |
| `src/lib/db.ts` | 新增 |
| `src/lib/config.ts` | 新增（WINDOW_SIZE 等常量） |
| `src-tauri/src/commands/mod.rs` | 新增 |
| `src-tauri/src/commands/db.rs` | 新增 |
| `src-tauri/src/commands/migration.rs` | 新增 |
| `src-tauri/src/lib.rs` | 修改（注册 handler） |
| `tests/engine/*.test.ts` | 新增（Vitest） |

---

## 五、测试验收方式

### 5.1 自动化

```bash
# TS 引擎
bunx vitest run --reporter=verbose          # 期望 60+ passed
bun run build && bunx vue-tsc --noEmit     # 0 错误

# Rust
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml  # 若有 Rust 单测

# 联调（需 tauri dev 或 mock）
bunx vitest run tests/integration/db.test.ts  # mock invoke 或 e2e
```

### 5.2 手工验收

| # | 步骤 | 期望 |
|---|------|------|
| H1 | `assembly([face,top], sd)` → `"(top:1.2), face"` | 权重括号正确 |
| H2 | `outfit` + `top` → warnings 含“套装互斥”且 top 被剔除 | R01 生效 |
| H3 | `invoke('db_get_dimensions')` 返回 14 行 | Rust 打通 |
| H4 | `db_save_assembly` 后 `db_list_recent` 可查 | 持久化闭环 |
| H5 | 导入旧 `data/pmf.db` 后条目数一致 | 迁移无丢 |

---

## 六、测试验收标准

| 验收项 | 通过标准 | 失败 |
|--------|----------|------|
| TS 单测 | `vitest` 60+ passed，覆盖 >80% | <50 或失败 |
| Rust 编译 | `cargo check` 0 error | 任意 error |
| 行为一致 | TS `assemble` 与 Python 同输入同输出（抽 20 组对比） | 不一致 |
| 持久化 | Rust CRUD 全链路可读写，事务原子 | 丢数据/外键错 |
| 构建 | `bun run build` EXIT:0 | 非 0 |

> **出口：** 全部通过方可进入阶段三.

---

*下一阶段 06_阶段三_主布局与TopBar重构*
