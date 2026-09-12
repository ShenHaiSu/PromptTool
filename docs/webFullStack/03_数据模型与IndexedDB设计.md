# 03 数据模型与 IndexedDB 设计

## 1. 表 → Object Store 映射

DB 名：`pmf-web`，版本 `1`（后续升级只加版本+upgrade）。

| SQLite 表 | IDB store | keyPath | 索引 |
|-----------|-----------|---------|------|
| dimensions | dimensions | id | key（unique）、is_deleted、sort_order |
| modules | modules | id | dimension_id、is_deleted、content_en |
| tags | tags | id | name（unique） |
| module_tags | module_tags | [module_id+tag_id]（复合，用 `module_id\x00tag_id` 字符串 key） | module_id、tag_id |
| assemblies | assemblies | id | is_deleted、is_favorite、created_at |
| assembly_items | assembly_items | id | assembly_id、module_id |
| templates | templates | id | is_deleted |
| template_items | template_items | id | template_id、module_id |
| rules | rules | id | is_enabled、type |
| app_settings/temp_carry | kv | k | —（单键：`settings/*`、`temp_carry`） |

`db_registry` 不迁移（单库，无多库概念）。字段与 `schema.sql/meta_schema.sql` 1:1，`INTEGER 0/1` 存为 `number`，`REAL/NULL` 保持原义。

## 2. 种子数据

复用 Tauri 版首次建库种子：14 维 / 311 条（`resources/schema.sql` + seed 逻辑）。做法：

- 把 seed 抽为 `src/lib/seed.ts`（JSON），首次 `idb.open` 且 `dimensions.count()==0` 时写入，加 `kv['seed_version']=1` 幂等。
- 中文显示名/英文片段/权重/多选/禁用位原样保留。

## 3. 事务与软删除约定

- 所有写操作单事务完成（如 saveAssembly 需要写 `assemblies + assembly_items` 多条，用一个 `readwrite` 事务）。
- 查询默认过滤 `is_deleted!=1`，与 Rust 侧一致；历史“已失效”占位逻辑（module 被删后 assembly_items 悬空）保留。
- `usage_count` 自增、排序 `sort_order` 逻辑搬自 `commands/db.rs`，逐函数对照。

## 4. 版本升级策略

- `onupgradeneeded` 按 `oldVersion` 顺序建 store/索引，不删用户数据。
- 导出文件带 `format: pmf-library/v1 + seed_version + exported_at`，导入时按版本兼容（未知字段忽略、缺字段填默认）。
