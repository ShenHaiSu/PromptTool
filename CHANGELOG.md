# Changelog

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
