# 踩坑记录 02：Windows 路径三坑 — canonicalize verbatim / explorer 单参数 / 裸字符串比较

- **日期**：2026-09-23（need07 施工收敛）
- **影响模块**：`src-tauri/src/commands/{path_resolve,business,export,meta,image_queue/queue}`、`src/lib/pathDisplay.ts`、三视图（`ImageQueuePanel/DbManagerDrawer/LibraryDialog`）
- **严重程度**：高（Program Files 展示脏 + 默认输出开错 Documents + 前台判定抖动）
- **状态**：已修复（方案B：路径中枢 + 注册表 v2 迁移 + reveal 重写）

---

## 一、坑1：`canonicalize` 在 Windows 返回 `\\?\` verbatim，前端直展即脏

### 现象

用户在 `Program Files\Prompt Modular Factory\data\luoli.db` 建库/切库后，
DB 页展示为 `\\?\D:\Program Files\...\luoli.db`。

### 根因

- `business.rs normalize_business_path` / `export.rs normalize_export_dir` 对存在文件直接
  `abs.canonicalize()`，Windows 语义即返回 verbatim 路径（绕过 MAX_PATH、固定大小写），
  随后原样存入 `db_registry.path` + `foreground_path`。
- `DbManagerDrawer` 原样展示 `row.path`，脏前缀即暴露。

### 修复（need07 中枢三规则）

- 新增 `commands/path_resolve.rs`：`strip_verbatim`（手写零依赖，与前端 `stripVerbatim` 同规则、
  前后端单测互相锁定）+ `display_path` + `norm_key` + `canonical_stripped`。
- 入库统一过 `canonical_stripped`（canonicalize 后必脱壳 + 盘符大写）；读侧
  `row_from_sql` 再 `display_path` 一次（防手工改库/旧备份恢复带前缀）。
- 启动 `migrate_path_schema_v2` 洗存量：`strip → 盘符大写 → 按 norm_key 去重 → 补前台`，
  全程单事务 + `.bak-<ts>` 备份，幂等可重入（`path_schema_version='2'`）。

### 复用规则

- 入库/返给前端的路径**永不含 `\\?\` 前缀**（`\\?\UNC\` 一并处理，`GLOBALROOT` 原样）。
- 所有路径日志用 `display_path`；`GetDiskFreeSpaceExW` 入参先脱壳再 `encode_utf16`。

---

## 二、坑2：`explorer /select` 拼成一个 arg + 相对/占位符透传，打开即回落 Documents

### 现象

- 默认输出（`outputDir == ""`）点“打开输出目录”只开 `Documents` 库。
- 含空格路径（`Program Files`）`/select` 选中态失效。

### 根因

1. `ImageQueuePanel onOpenOutput` 取占位 `'<data_dir>/output/images'` 直接
   `dbRevealInExplorer('<data_dir>/output/images')`；后端旧 `db_reveal_in_explorer`
   无归一，`PathBuf::from(相对路径)` + `exists()==false` 直接丢给 explorer，
   Explorer 对非法/相对参数的兜底即打开 `Documents`。
2. `export.rs` 用 `.arg(format!("/select,\"{}\"", p))` 把动词+路径拼成**一个**参数，
   `/select` 失效；且打开前无 `create_dir_all` 保活。

### 修复

- 重写 `db_reveal_in_explorer(app, path)`：占位符（`startsWith('<')`）拦截报错 →
  脱壳 → 相对拼 `active data_dir` → `ensure_dir` 保活（文件保活 parent）→
  Windows 文件 `.arg("/select,").arg(file)`（**两个参数**）、目录 `.arg(dir)` →
  `spawn` 失败回退 `tauri_plugin_opener::open_path`。
- 新增 `iq_open_output_dir`（解析+保活+打开，返回 display 目录）/
  `iq_get_resolved_output_dir`（只解析不打开，供 placeholder）；
  `onOpenOutput` 空配置改调 `iq_open_output_dir`，删除 `<data_dir>` 占位符。

### 复用规则

- 相对路径/占位符**永远不再透传给 explorer**（Code Review 必查）。
- 打开目录前**保证目录存在**（`create_dir_all` + 写探针）。

---

## 三、坑3：裸 `to_ascii_lowercase` 直比 + `NOCASE UNIQUE` 判不出 `\\?\` 同文件

### 现象

- `\\?\D:\a.db` 与 `D:\a.db` 同一文件可重复注册；`wasForeground` 前台判定抖动。

### 根因

- `business.rs wasForeground` 用裸字符串 `to_ascii_lowercase()` 直比，verbatim 与普通路径永远不等。
- SQLite `path UNIQUE COLLATE NOCASE` 对 `\\?\` vs 普通路径视为**不同行**。

### 修复

- `norm_key = strip_verbatim → to_lowercase → \ 统一 /`，全仓替换前台/驻留/去重比较；
  入库前应用层 `norm_key` 预查（不依赖 NOCASE）；迁移按 `norm_key` 分组去重
  （保留 `last_opened_at` 最大者，计数取最大者）。

---

## 四、附带：`Program Files/data` 不可写首启即失败

- 旧逻辑 `create_dir_all` 失败只报“请用管理员运行”。
- need07 改双 base：`resolve_data_dir` 先探针写 `exe/data`（`.pmf_write_probe.tmp`），
  失败回退 `app.path().app_data_dir()`，旧 `Default.db` 存在则 `migrate_legacy_db` 搬一次；
  `path_get_bases` 暴露 `exeDir/exeData/activeData/docDir/base/writable` 供探针验收。
