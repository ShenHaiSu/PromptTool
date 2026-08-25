# Prompt Modular Factory — Tauri v3.0

> **技术栈：** `Tauri 2 + Vue 3 + TypeScript + Rust + SQLite + Tailwind + shadcn-vue`
> **分支：** `tauri`（orphan，与 `main` Python/tkinter 线无共同历史）；`main` 保留老版本。

## 快速开始

```bash
# 安装依赖
bun install

# 仅前端（Vite HMR http://localhost:1420）
bun run dev

# Tauri 窗口（含 Rust 热重载）
bun run tauri dev

# 生产构建（vue-tsc + vite）
bun run build

# 打包（Windows msi/exe，macOS dmg/app）
bun run tauri build
# 产物：src-tauri/target/release/bundle/
```

### 依赖说明

- **Node ≥20 / Bun ≥1.1** — 包管理与 Vite 构建
- **Rust ≥1.77 / Cargo** — Tauri 后端（`rusqlite bundled` 自带 SQLite，无需系统 sqlite3）
- **WebView2** — Windows 打包依赖（Win10/11 自带，Win7 需 `webviewInstallMode: downloadBootstrapper`）
- **SQLite DB** — 新库位于 **exe 所在目录 `data/pmf.db`**（`pmf.db-wal/-shm` 伴生），不侵入 `%APPDATA%`；旧 `%APPDATA%/com.pmf.tauri-app/pmf.db` 仅作只读数据源
  - 首次启动自动建库 + 导入 `resources/schema.sql` + 种子 14 维 / 311 条；旧库存在时自动通过 SQLite Backup API 迁移到新路径（幂等、旧库保留）
  - exe 目录不可写时明确报错提示，不静默回退到 AppData
  - 旧库手动导入：设置页“导入旧版数据”或 Rust `db_import_legacy_db`（ATTACH + INSERT OR IGNORE）
- **词库导出/去重导入** — `db_export_library` / `db_import_library(_text)`：标准 `pmf-library` JSON（维度按 `key`、词条按 `id`/`dimensionKey+contentEn`、规则按 `id`/签名、标签按 `name` 去重合并）；UI 入口在底部 `StatusBar` 的「📚 词库」按钮

## 目录结构

```
.
├── src/
│   ├── engine/        # models / assembly / rules / adapters / random
│   ├── stores/        # Pinia: assembly / batch / history / theme
│   ├── components/    # TopBar / DimensionPanel / AssemblyCanvas / BatchFactory / HistoryPanel / ui
│   ├── composables/   # useSash / useToast / useShortcuts / usePersist / useVirtualList / useDragSort
│   ├── lib/           # db.ts (invoke) / export.ts (CSV) / utils.ts / config.ts
│   └── assets/        # tokens.css / design tokens
├── src-tauri/
│   ├── Cargo.toml / tauri.conf.json
│   ├── resources/schema.sql
│   ├── capabilites/default.json
│   └── src/commands/{db,migration}.rs
├── docs/Tauri-develop/  # 重构设计文档 00-10
├── index.html         # 含首屏主题 FOUC 防闪脚本 + 1280×720 最小宽度
├── vite.config.ts
└── package.json       # v3.0.0
```

## 核心能力

- **拼装引擎** `src/engine/*`：`assemble()` + `applyRules(R01-R03)` + `adaptToModel(SD/MJ/Flux)` + `randomAssembly/partialRandomAssembly`，与 Python 1:1，去重 `PromptIR.hash()=md5(dim:text:weight)`
- **布局** `App.vue`：`30:38:32` Flex 三栏 + Sash `pointer capture + rAF` 60fps + `contain: layout paint`；持久化双写 `pmf:sash/pmf-sash`
- **TopBar**：`88↔168` 展开、`badge` 冲突、`prompt` 单行省略·展开、`IR` 折叠区、`复制` 回退、`导出` UTF-8 BOM CSV 复用 `lib/export.ts`
- **批量工厂**：`TanStack Virtual h-[400px] estimateSize 110 overscan 5` 虚拟化，500 Card 首屏 <100ms
- **资产沉淀**：历史/收藏/模板 Tabs + 快照双写 `assemblies.prompt_ir + assembly_items` + 已删 `[已失效]` 占位 + 回填二次确认
- **系统集成（阶段六）**：
  - 快捷键 `Ctrl+F/S/C` + `Delete`（`useShortcuts`，输入框内不劫持）
  - 明暗主题持久化（`pmf:theme/pmf-theme` + 首屏脚本防 FOUC + StatusBar 切换）
  - `sash` + 窗口几何持久化（`pmf:sash/pmf-sash` + `pmf:geometry/pmf-geometry` + `beforeunload` + 768p 溢出保护 + 可选 Rust `save_window_state`）
  - `Toast` 队列（`MAX 5` 并发，溢出丢弃最旧，`error` 红边）
  - CSV 导出（`lib/export.ts` 列 `序号/提示词/维度构成/冲突警告`，对标 `exporter.py`）
  - 一键复制全部（BatchFactory）
  - 全局错误处理 `app.config.errorHandler + window.onerror + unhandledrejection`
  - 最小窗口 `1280×720` 无溢出（`index.html` min-width/min-height + `App.vue` flex+overflow-hidden）

## 常用命令

```bash
# 校验
bun run build                 # vue-tsc --noEmit && vite build  必须 EXIT:0
npx vue-tsc --noEmit         # 类型检查
cargo check --manifest-path src-tauri/Cargo.toml
npx vitest run --reporter=verbose
npx vitest run --coverage

# 测试（staging 已覆盖）
cargo test --manifest-path src-tauri/Cargo.toml
```

## 文档

重构方案详见 `docs/Tauri-develop/`：

| 编号 | 标题 |
|------|------|
| 00 | 目录与总览 |
| 01 | 现状诊断与重构动因 |
| 02 | 总体架构与技术选型 |
| 03 | 数据模型与存储迁移 |
| 04 | 阶段一：工程基座与设计系统 |
| 05 | 阶段二：核心领域与 Rust 后端 |
| 06 | 阶段三：主布局与 TopBar 重构 |
| 07 | 阶段四：拼装画布与批量工厂 |
| 08 | 阶段五：资产沉淀与历史模板 |
| 09 | 阶段六：系统集成与交付 |
| 10 | 附录：命令清单与验收总表 |

验收手工项：`F01-F17` 功能 + `V01-V06` 视觉 + `P01-P05` 性能（见 `10_附录`）。

## 分支策略

- `main` — Python/tkinter 线（维护态）
- `tauri` — Tauri 重构线（开发态，orphan）
- 交付：`tauri` 经评审后设为默认分支或内容覆盖归档到 `main`，不使用 `merge`（无共同祖先）；发布 `git tag v3.0-tauri`

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
