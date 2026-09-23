# Changelog
## need08 — 2026-09-23 · 维度右键菜单增强（去Emoji/开关/清空/迁移）

### 菜单重构（DimensionPanel + need05Position）

- **7项两线**：翻译/生成/开关/清空/迁移/复制键名/复制中文名，顺序与docs/need08/02 §1一致；生成项去 ✨（精确文本`片段批量生成`，testid不变）；清空/迁移空维度disabled+title说明，危险项`text-destructive`。
- **定位**：`MENU_W 180→208`、`MENU_H_EST 110→220`，视口右下角翻转不溢出；薄包装`onToggleFromMenu/onClearFromMenu/onMigrateFromMenu`（关菜单再委托）；维度头title改为`Ctrl+点击或右键菜单可启用/禁用`。

### 开关/清空/迁移

- **开关**：复用`onToggleDimension`（fresh兜底+乐观更新+`enable/disable-dimension`事件），与Ctrl+Click双轨。
- **清空**：内联确认小Dialog（N/K+checkbox门控+`清空中… i/N`进度）→逐条`dbSoftDeleteModule`→`assembly.removeModule`联动→`clear-dimension`事件+`fetchAll`强刷；中途失败快照回显+`clear-dimension-failed`+`fetchAll`对齐，toast如实报`已删除 i 条`。
- **迁移**：新建`DimensionMigrateDialog`（归档`_bak_`预览+N/K+规则Tips+checkbox门控）；`dbMigrateDimension`→联动移出已选→`migrate-dimension`+`fetchAll`+`setExpanded(原key,true)`。

### 后端事务（db.rs + lib.rs注册）

- **新增`db_migrate_dimension`**：读源→计数（0则`空维度无需迁移`）→服务端`rand6`防重循环（≤10次，`{key}_bak_{6位}`，31字符集剔除易混淆）→`BEGIN IMMEDIATE`内改名归档（沉底`MAX+1`、`nameCn+（归档）`）+原key原位重建→`COMMIT/ROLLBACK`；模块行零搬运。错误口径：不存在→`维度 '{id}' 不存在或已删除`、10次全撞→`归档键名冲突，请重试`。
- **单测7例**：`migrate_happy_path/empty_rejected/missing_dimension_rejected/key_collision_retry/second_round_key_differs/rollback/rand6_format_and_archive_name`。

### 测试验收

- **前端**：新增`DimensionCtxToggle/CtxClear/Migrate`三文件12用例（顺序/文案/开关翻转/清空N次调用+联动+失败保持打开/迁移预览+一次调用+失败保持打开）；存量`DimensionGenerate/Translate/disable/need05Position`同步，全量57文件456用例通过，`vue-tsc --noEmit`零错误。
- **后端**：`cargo test` 116通过（含迁移7例）。


## need07 — 2026-09-23 · Windows 路径治理 + 存量无感迁移（方案B）

### 路径中枢与目录回退

- **新增 `commands/path_resolve.rs`**：`strip_verbatim/display_path/norm_key/lexical_normalize/canonical_stripped/default_*_for` 纯函数 + `resolve_data_dir/resolve_image_dir/resolve_export_dir/ensure_dir` 薄适配层，零新依赖；`resolve_data_dir` 双 base（`exe/data` 可写即用，否则回退 `app_data_dir` + 探针 `.pmf_write_probe.tmp`），`setup` 改用 `active`。
- **存储/展示/比较三规则**：入库永不含 `\\?\`（canonicalize 后必脱壳 + 盘符大写），日志/前端一律 `display_path`，比较一律 `norm_key`；`check_disk_space` 先脱壳再 `encode_utf16`。
- **reveal 重写**：`db_reveal_in_explorer(app, path)` 占位符拦截 + 相对拼 active + `ensure` 保活 + Windows `explorer /select,` 双参数 + `opener` 回退；新增 `iq_open_output_dir/iq_get_resolved_output_dir/path_get_bases/path_migrate_status`。

### 注册表迁移与前端契约

- **`migrate_path_schema_v2`**：`Default.db` 字符串洗白（脱壳 + 盘符大写 + `norm_key` 去重 + 前台补注册），单事务 + `.bak-<ts>` + 幂等 `path_schema_version='2'`，失败不阻断启动；读写双防（入口 `canonical_stripped` + 读侧再脱壳 + `wasForeground` 改 `norm_key`）。
- **前端**：新增 `src/lib/pathDisplay.ts`（`stripVerbatim/displayPath`，与后端锁定）+ 单测；`ImageQueuePanel.onOpenOutput` 空配置改调 `iq_open_output_dir`；`imageQueueApi` 新增解析/探针 + 旧缓存 `washOutputDir`；`DbManagerDrawer/LibraryDialog` 展示过 `displayPath`，`repair` 拒绝空/占位符；`ImageQueueSettings` placeholder 显示解析值 + 老默认保留 hint。
- **收敛与清理**：三处 `lexical_normalize` 收敛为中枢转发；删除 `docs/need05/apikey.txt`；新增 `docs/pitfalls/02-windows-path.md`。

## v3.0.1 — 2026-08-25 · 数据库路径迁移 + 词库导出/去重导入

### 数据库路径迁移（Need01-01）

- **路径改写**：`init_db` / `db_path_for` 从 `%APPDATA%/com.pmf.tauri-app/pmf.db` 迁移到 **exe 所在目录 `data/pmf.db`**，不侵入用户路径
- **旧库自动迁移**：新库不存在时自动使用 rusqlite Backup API（事务级原子，含 WAL checkpoint）将旧库完整复制到新路径，旧库保留不动保证回滚安全
- **不可写提示**：`create_dir_all` 失败时返回明确错误信息，指导用户管理员权限运行或安装到可写路径，绝不静默回退到 AppData
- **新增公共函数**：`data_dir_for()` / `exe_db_path_for()` / `migrate_legacy_db()`
- **单元测试**：3 个测试覆盖路径拼接、全量迁移数据一致性、WAL 模式验证

### 词库导出/去重导入（Need01-02）

- **后端命令**：`db_export_library`（双模式：path 空返回 JSON 文本 → 前端 Blob 下载；path 非空原子写盘）、`db_import_library`（磁盘文件导入）、`db_import_library_text`（前端文本导入）
- **导出格式**：标准 `pmf-library` JSON（format/formatVersion/exportedAt/counts + dimensions/modules/rules/tags），仅导出 `is_deleted=0` 数据
- **去重导入算法**：维度按 `key` 合并/冲突新建；模块按 `id` 或 `dimensionKey+contentEn` 去重；规则按 `id` 或 `name+type+source/target` 签名匹配；标签按 `name` 唯一；FK 引用校验增强安全性
- **导入模式**：`skip`（默认，保留现有行） / `overwrite`（按文件内容更新现有行）
- **导入报告**：逐项打印新增/更新/跳过计数，冲突/错误明细可展开查看
- **前端封装**：`db.ts` 新增 `dbExportLibrary` / `dbImportLibrary` / `dbImportLibraryText` + TypeScript 类型 + 7 个前端 mock 测试
- **UI 词库管理**：`LibraryDialog.vue` 对话框（导出 Blob 下载、文件选择导入、模式单选、结果报告），入口在 `StatusBar`「📚 词库」按钮，导入后自动刷新统计与词条面板
- **单元测试**：8 个 Rust 测试覆盖导出完整性、roundtrip、二次幂等、跨 id 去重、维度冲突、overwrite 更新、非法文件拒绝

## v3.0-tauri — 2026-08-24 · Tauri 重构交付（阶段六）

### 系统集成与交付（P3 阶段六）

- **快捷键** `useShortcuts`：`Ctrl+F` 聚焦搜索（`dimension-search`）、`Ctrl+S` 保存方案（`history.save` + Toast）、`Ctrl+C` 复制最终 Prompt（含 `textarea execCommand` 回退）、`Delete/Backspace` 移除末项；输入框内不劫持，避免误触
- **主题持久化**：`pmf:theme/pmf-theme` 双写 + `stores/theme` `getStoredTheme()/applyTheme()` + `index.html` 首屏 `<script>` 注入 `localStorage` + `prefers-color-scheme` 回退，消除 FOUC；`StatusBar` 抽离为 `StatusBar.vue`
- **sash/几何持久化**：`useSash` 已双写 `pmf:sash/pmf-sash`（`12%~65%` + `left+center<0.92` 约束）；新增 `usePersist.persistGeometry()` 监听 `beforeunload` 双写 `pmf:geometry/pmf-geometry` 并 `768p` 溢出保护 + 可选 `invoke('save_window_state')`；`App.vue` 挂载时调用
- **Toast 队列**：`useToast` 补 `MAX_TOASTS=5` 溢出丢弃最旧 + `clear()`，`App.vue` 仅渲染 `slice(-5)`，`error` 红边
- **CSV 导出** `lib/export.ts`：对标 `exporter.py` 列 `序号/提示词/维度构成/冲突警告`，`UTF-8 BOM` + RFC4180 双引号转义；`TopBar` / `BatchFactory` 复用，批量 `exportBatchCsv(results)` 单条 `exportSingleCsv(ir,final)`
- **一键复制全部**：`BatchFactory onCopyAll` 保留（`navigator.clipboard.writeText` + Toast）
- **溢出保护(768p)**：`index.html` `min-width 1280 min-height 720` + `App.vue` `flex min-h-0 overflow-hidden` + 几何持久化阈值校验
- **全局错误处理** `main.ts`：`app.config.errorHandler` + `window error/unhandledrejection` 日志 + Toast 兜底展示
- **打包定版**：`package.json / src-tauri/tauri.conf.json / Cargo.toml` 版本 `0.1.0 → 3.0.0`，`tauri.conf.json` `productName Prompt Modular Factory` `width 1600×1080 min 1280×720 resizable resources schema.sql` 已就绪；`cargo check / build / vitest` 全绿可用 `bun run tauri build` 产出 `msi/exe`（`bundle.targets all`）
- **文档定版**：`README` 更新快速开始 `bun install && bun run tauri dev` + 依赖/DB/核心能力/阶段六集成说明；本 CHANGELOG 新增

### 前置阶段（阶段一～五回顾）

- **P1-01 工程基座**：`Vite + Vue 3 + TS + Tailwind + shadcn-vue + Pinia + Vitest` + `tokens.css` 设计 Token + `tauri.conf` 产品化
- **P1-02 核心领域**：`engine/models/assembly/rules/adapters/random` TS 1:1 + `rusqlite WAL` 7 表 + 种子 + `lib/db.ts` invoke + 60+ 单测
- **P2-01 主布局**：`App.vue 30:38:32 Flex + useSash rAF` + `TopBar 88/168` + `DimensionPanel` 搜索/NSFW + `StatusBar` + 双键持久化
- **P2-02 画布/批量**：`AssemblyCanvas` Chips DnD + 权重 Popover 本地 draft + `BatchFactory` 虚拟化 `h-400/110/5` + `BatchCard` 复制/收藏/回填
- **P2-03 资产沉淀**：`HistoryPanel Tabs 历史/收藏/模板` + `history` store 全链路 + `SaveDialog` + 已删占位 `[已失效]` + 回填确认
