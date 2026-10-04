# Prompt Modular Factory — Tauri 桌面端（主力分支 `tauri`）

> Windows 桌面客户端：`Tauri 2 + Vue 3 + TypeScript + Rust + SQLite`。
> 本分支是当前**主力开发线**，`main` 仅为导航页（旧 Python/tkinter 已归档至 `archive/main-python-final`），
> `web-pure` 为纯静态前端变体（IndexedDB，无 Rust 后端）。三者关系见文末「分支策略」。

**产品形态一句话**：本地词库（维度/词条/规则/标签）→ 拼装引擎（组装 + 规则 R01-R03 + 模型适配 SD/MJ/Flux + 随机）→
单发预览 / 批量工厂 / 生图队列 / 统计报表 → 历史·收藏·模板沉淀 → 词库导出/导入复用。

---

## 1. 功能总览

### 1.1 提示词拼装（核心）
- **拼装引擎** `src/engine/`：`assemble()` + `applyRules(R01-R03)` + `adaptToModel(SD/MJ/Flux)` + `randomAssembly / partialRandomAssembly`
- **PromptIR**：去重哈希 `md5(dim:text:weight)`，可序列化、可回放、可存档
- **冲突处理**：TopBar badge 提示 + `IR` 折叠区 + `IrConflictEditorDialog` 手动消解
- **模型适配**：不同模型不同的分隔符/权重语法/触发词处理，见 `src/engine/adapters.ts`

### 1.2 维度与词条（左侧面板）
- 维度 CRUD + 启用/禁用（`Ctrl+点击` 或右键菜单）
- 词条 CRUD + 搜索 + 拖拽排序（`vue-draggable-plus`）+ 虚拟化
- 右键菜单 7 项：翻译 / 片段批量生成 / 启用开关 / 清空 / 迁移 / 复制键名 / 复制中文名
- **清空**：内联确认 + `清空中… i/N` 进度 + 逐条软删 + 失败快照回显
- **迁移**：`DimensionMigrateDialog` 预览归档 `_bak_` + 原 key 原位重建，模块行零搬运
- 维度排序以 DB `sortOrder` 为唯一真相源，新建/导入按 `max+1` 自增

### 1.3 拼装画布（中栏）
- 已选词条画布：增删、权重调整、分组展示
- TopBar：`88↔168` 展开、`prompt` 单行省略·展开、复制（含剪贴板回退）、导出 CSV（UTF-8 BOM，列 `序号/提示词/维度构成/冲突警告`）
- 生成对话框与维度右键菜单接入，单测覆盖

### 1.4 批量工厂（右栏/抽屉演进史）
- `TanStack Virtual（h-[400px] / estimateSize 110 / overscan 5）` 虚拟化，500 Card 首屏 <100ms
- 一键复制全部、批量导出 CSV、失败重试
- 当前版本右栏已收纳为**历史抽屉**，布局收敛为左栏单比例 + 中区自适应（见 §3 布局）

### 1.5 生图队列（图片工作区）
- 任务队列：排队 / 并发 / 重试 / 取消 / 查看详情（`ImageTaskDetailDialog`）
- 独立可控随机：`loopUsePartial / loopAllowNsfw`，不再依赖批量工厂 `lastRandomMode`
- 图片缩放平移 composable（`useImageZoomPan`），大图内存释放
- 输出目录解析：`iq_open_output_dir / iq_get_resolved_output_dir`，Windows 路径 `\\?\` 脱壳 + 盘符大写 + `display_path` 展示
- 报表 CSV 后端落盘 + 导出冷却，文件名预占位反查与台账挂钩
- 连接配置独立 `connection.json` 及快照，模型配置 SSOT 抽离 + 独立配置面板

### 1.6 单发预览与图片解析
- 上下分栏 + 图片工作区交互，缩放平移 + 面板联动单测
- 图片解析面板与入口（`need02-02`），图片元数据面板（`ImageMetaPanel`）
- 生成台账持久化与统计查询后端

### 1.7 历史·收藏·模板（资产沉淀）
- 历史 / 收藏 / 模板 Tabs + 快照双写 `assemblies.prompt_ir + assembly_items`
- 已删除词条以 `[已失效]` 占位保留结构，回填需二次确认
- 右栏收纳为历史抽屉（`HistoryDrawer`），快捷键可开合
- 随机历史独立记录（`randomHistory`），队列独立可控随机变更记录

### 1.8 词库管理（导入/导出/多库）
- 标准 `pmf-library` JSON：`format / formatVersion / exportedAt / counts + dimensions / modules / rules / tags`，仅导出 `is_deleted=0`
- 后端命令：`db_export_library`（path 空返文本→前端 Blob 下载；非空原子写盘）、`db_import_library(_text)`
- 去重合并：维度按 `key`、词条按 `id` / `dimensionKey+contentEn`、规则按 `id`/签名、标签按 `name`
- 导入模式：`skip`（默认保留现有）/ `overwrite`（按文件更新）
- UI 入口：底部 `StatusBar` 「📚 词库」→ `LibraryDialog`（导出下载、文件导入、模式单选、结果报告）
- 多库注册表（`dbRegistry`）：`Default.db` 字符串洗白 + `path_schema_version='2'` 幂等迁移 + `.bak-<ts>`，业务库 onboarding / 管理抽屉（`BusinessDbOnboardingDialog / DbManagerDrawer`）
- 片段/分段导入、翻译对话框、模块批量对话框，格式兼容 + 预览确认 + 完整备份 + 清空

### 1.9 统计报表
- 生成台账 + 统计查询后端，前端 `StatsReportDialog` 展示
- CSV 导出复用 `src/lib/export.ts`（RFC4180 转义 + BOM）

---

## 2. 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 壳 | Tauri 2 | `src-tauri/tauri.conf.json`，`productName Prompt Modular Factory`，`identifier com.pmf.tauri-app` |
| 前端 | Vue 3.5 + TS 5.6 + Vite 6 | `@` 指向 `src/`，`unplugin-vue-components + ElementPlusResolver` 按需引入（禁止从 `element-plus` 根 barrel 导入） |
| UI | Element Plus 2 + Tailwind 3 | 自建 ui 原语已移除，全面切 Element Plus；`src/styles/ep-overrides.css` 做主题覆写 |
| 状态 | Pinia 4 | `assembly / batch / history / theme / library / dbRegistry / dimensionPanel / connectionProfile / imageQueue* / rules` |
| 虚拟化/拖拽 | `@tanstack/vue-virtual / vue-draggable-plus` | 批量 500 Card、维度长列表 |
| 后端 | Rust 2021 + rusqlite(bundled+backup) + tokio + serde + reqwest(rustls) | SQLite 自带，无需系统 sqlite3；Backup API 做旧库迁移 |
| 测试 | Vitest 4 + jsdom + @vue/test-utils + cargo test | 前端 ~57 文件 460+ 用例，覆盖率阈值 lines 70 / branches 60；后端 100+ 用例 |
| 包管理/构建 | Bun 1.1 + Node ≥20 + Rust ≥1.77 | `bun install`，`vue-tsc --noEmit && vite build` 门禁 |

---

## 3. 界面布局

```
┌ TopBar（88↔168 展开，badge 冲突，prompt 省略·展开，IR 折叠，复制/导出） ┐
├ 左:DimensionPanel ┬ 中:AssemblyCanvas/SingleShot/ImageQueue ┬ 历史抽屉 ┤
└ StatusBar（主题切换，📚 词库，统计，几何/存储状态） ────────────────────┘
```

- 三栏 Flex + Sash `pointer capture + rAF` 60fps + `contain: layout paint`
- 持久化双写兼容键：`pmf:sash / pmf-sash`、`pmf:theme / pmf-theme`、`pmf:geometry / pmf-geometry`（`beforeunload` + 768p 溢出保护）
- 首屏主题脚本（`index.html` 内联）防 FOUC，跟随 `prefers-color-scheme` 回退
- 窗口：默认 `1600×1080`，最小 `1280×720`，`index.html` min-width/min-height + `App.vue` flex+overflow-hidden 双保险
- Toast 队列：`MAX 5` 并发，溢出丢最旧，`error` 红边（S7 后统一为 EP Message）
- 全局错误：`app.config.errorHandler + window.onerror + unhandledrejection` 进 console + notify
- 快捷键（`useShortcuts`，输入框内不劫持）：`Ctrl+F` 聚焦搜索 / `Ctrl+S` 保存方案 / `Ctrl+C` 复制 Prompt（含 `textarea execCommand` 回退）/ `Delete` 移除末项；历史抽屉快捷键见抽屉 title

---

## 4. 目录结构

```
.
├── src/
│   ├── engine/        # models / assembly / irCodec / rules+ruleEngine / adapters / random(+History)
│   ├── stores/        # assembly / batch / history / theme / library / dbRegistry / dimensionPanel
│   │                  # connectionProfile / imageQueue(.config/.tasks) / rules / randomHistory
│   ├── components/    # DimensionPanel / AssemblyCanvas / BatchFactory / HistoryDrawer+Panel
│   │                  # SingleShotPanel / ImageQueuePanel(+Settings) / ImageTaskCard(+Detail)
│   │                  # ModelConfigPanel / ImageMetaPanel / StatsReportDialog / StatusBar
│   │                  # LibraryDialog / DbManagerDrawer / BusinessDbOnboardingDialog
│   │                  # Dimension{Edit,Generate,Translate,Migrate}Dialog / Rule{Edit,List} / SaveDialog
│   │                  # PromptPreviewDialog / SegmentImportDialog / Module{Batch,Edit}Dialog
│   │                  # dimension/ generate/ ir/ queue/ segment/ single-shot/ translate/ 子组件
│   ├── composables/   # useSash / useShortcuts / usePersist / useAppBootstrap / useDimensionCrud(Panel)
│   │                  # useGenerateDialog / useTranslateDialog / useSegmentImport / useSingleShot
│   │                  # useImageMeta / useImageTaskDialog / useImageZoomPan / useIrEditor / useStatsReport
│   ├── lib/           # db.ts(invoke 封装) / db/ / export.ts(CSV) / notify / logger / config
│   │                  # connectionProfile / fragmentGenerateParse+Prompt / segmentParse+Prompt
│   │                  # imageQueue(Api) / imageLoop / imageMeta / irEdit / jsonProbe / libraryEvents
│   │                  # pathDisplay / seed(-data) / statsApi / storageKeys / utils
│   ├── assets/        # tokens.css / design tokens
│   ├── styles/        # ep-overrides.css（Element Plus 覆写）
│   └── tests/         # tauri-mock.ts + 各模块单测基建
├── src-tauri/
│   ├── tauri.conf.json / Cargo.toml / build.rs
│   ├── capabilities/default.json
│   ├── resources/schema.sql + meta_schema.sql（随包发布）
│   └── src/commands/  # db / migration / batch / business / export / meta / rules
│                      # segment / translation / image_queue/* / path_resolve
├── docs/
│   ├── Tauri-develop/ # 重构设计文档 00-10（总览→附录验收总表）
│   ├── need01~need09  # 无感升级/模型配置/对话框接入/排序真相源/路径治理/右键菜单/队列随机…
│   ├── pitfalls/      # Windows 路径等踩坑记录
│   └── samplePrompt/  # 示例提示词
├── index.html         # 首屏主题防闪脚本 + 1280×720 最小尺寸
├── vite.config.ts     # 1420 固定端口 / `@` 别名 / vitest(jsdom+globals, ElementPlus inline, 覆盖率阈值)
├── build.bat          # Windows 一键打包（bun run tauri build）
└── package.json       # v3.0.0（scripts 见 §5）
```

---

## 5. 快速开始

### 5.1 环境要求

- **Node ≥20 / Bun ≥1.1**：包管理与 Vite 构建
- **Rust ≥1.77 / Cargo**：Tauri 后端（`rusqlite bundled` 自带 SQLite）
- **WebView2**：Win10/11 自带；Win7 需 `webviewInstallMode: downloadBootstrapper`
- 建议 IDE：VS Code + `Vue - Official` + `Tauri` + `rust-analyzer`

### 5.2 安装与运行

```bash
# 克隆主力分支（注意：不要 clone 默认 main 导航页）
git clone -b tauri https://github.com/ShenHaiSu/PromptTool.git
cd PromptTool

# 安装依赖
bun install

# 仅前端（Vite HMR http://localhost:1420）
bun run dev

# Tauri 窗口（含 Rust 热重载，日常开发用这个）
bun run tauri dev

# 生产构建（vue-tsc 类型门禁 + vite 打包，必须 EXIT:0）
bun run build

# 打包（Windows msi/exe，macOS dmg/app）
# Windows 一键：双击 build.bat，或：
bun run tauri build
# 产物：src-tauri/target/release/bundle/
```

### 5.3 常用命令

```bash
# 类型检查
bun run typecheck            # vue-tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml

# 测试
bun run test                 # vitest run
bun run test:coverage        # vitest run --coverage（阈值 lines 70 / branches 60）
npx vitest run --reporter=verbose
cargo test --manifest-path src-tauri/Cargo.toml

# 预览/占位
bun run preview
bun run test:e2e              # e2e TODO，占位
```

---

## 6. 数据与存储（必读）

- **新库位置**：**exe 所在目录 `data/pmf.db`**（伴生 `pmf.db-wal / -shm`），不侵入 `%APPDATA%`
- **旧库只读源**：`%APPDATA%/com.pmf.tauri-app/pmf.db` 仅作迁移数据源
- **首次启动**：自动建库 + 导入 `resources/schema.sql` + 种子 **14 维 / 311 条**；旧库存在时经 SQLite Backup API 原子迁移到新路径（幂等，旧库保留可回滚）
- **不可写处理**：exe 目录不可写时明确报错（提示管理员权限/换可写路径），不静默回退 AppData
- **手动导入旧库**：设置页「导入旧版数据」或 Rust `db_import_legacy_db`（`ATTACH + INSERT OR IGNORE`）
- **路径三规则**（`commands/path_resolve.rs` + `src/lib/pathDisplay.ts` 锁定一致）：
  - 入库永不含 `\\?\`（canonicalize 后必脱壳 + 盘符大写）
  - 日志/前端一律 `display_path` 展示
  - 比较一律 `norm_key`
  - `resolve_data_dir` 双 base：`exe/data` 可写即用，否则回退 `app_data_dir` + 探针 `.pmf_write_probe.tmp`
- **后端命令规模**：约 83 个 `#[tauri::command]`，覆盖维度/词条/拼装/历史/模板/词库/分段/翻译/生图队列/报表/路径/迁移（详见 `src-tauri/src/commands/` + `src/lib/db.ts` 封装）

---

## 7. 文档索引

- 重构主文档：`docs/Tauri-develop/`（00 目录总览 → 10 附录验收总表，含 `F01-F17` 功能 + `V01-V06` 视觉 + `P01-P05` 性能手工验收项）
- 需求增量：`docs/need01`（无感升级/台账/单发）→ `need02`（模型 SSOT/图片解析/报表落盘）→ `need03`（生成对话框接入）→ `need04`（排序真相源）→ `need05`（定位/清理）→ `need07`（路径治理方案B）→ `need08`（右键菜单）→ `need09`（队列独立随机）
- 踩坑：`docs/pitfalls/02-windows-path.md`（Windows 路径脱壳/盘符/比较三规则）
- 变更史：`CHANGELOG.md`（`v3.0-tauri` 交付 → `v3.0.1` 路径迁移+词库 → need07/08/09…）
- 发布标记：`v3.0-tauri` / `v3.0-web-pure`（双线分开发布，见 §8）

---

## 8. 分支策略

| 分支 | 状态 | 说明 |
|------|------|------|
| `main` | 导航页 | 仅 `README.md`，禁止业务代码（已加 Require PR 保护）。旧 Python 线封存于 `archive/main-python-final` |
| `tauri` | **主力开发线** | 本分支。Vue+Tauri+SQLite，Windows 打包。日常开发/默认分支都在这里 |
| `web-pure` | 静态变体 | 纯 Web，IndexedDB 后端，可静态部署。从 `b3ecf46（2026-09-10）` 与 `tauri` 分叉后独立演进 |

- `main` 与 `tauri`/`web-pure` **无共同祖先**（`tauri` 初代提交为 `1d3f67f feat: initial Tauri rebuild, orphan from main`），**不可 merge**，只能 cherry-pick 点对点搬运
- `tauri` 与 `web-pure` 共享基座到 `b3ecf46`，之后 `tauri +48 / web-pure +16` 各自独立（含 web-pure 去 Tauri 化转 IndexedDB），不做全量合流
- 发版：`git tag vX.Y-tauri` / `vX.Y-web-pure` 分开打
- 归档查看：`git checkout archive/main-python-final`

```bash
git fetch origin
git checkout tauri      # 主力
git checkout web-pure   # 静态版
git checkout archive/main-python-final  # 旧 Python 归档
```

---

## 9. 故障排查

| 现象 | 排查 |
|------|------|
| `bun run tauri dev` 端口占用 | Vite 固定 `1420`（`strictPort`），先杀占用进程；移动端 HMR 用 `TAURI_DEV_HOST`，对应 `1421` ws 端口 |
| Windows 打包缺 WebView2 | Win10/11 自带；Win7 切 `webviewInstallMode: downloadBootstrapper` |
| 启动报 exe 目录不可写 | 换可写路径安装或管理员运行；绝不自动回 AppData，错误信息会明示 |
| 旧数据没过来 | 确认旧库 `%APPDATA%/com.pmf.tauri-app/pmf.db` 是否存在；不存在则走设置页手动导入；迁移幂等可重复触发 |
| 路径显示 `\\?\` 前缀 | 前端一律过 `displayPath`，入库对比用 `norm_key`；见 `pitfalls/02-windows-path.md` |
| `bun run build` 挂在 vue-tsc | 先 `bun run typecheck` 看具体文件；禁止从 `element-plus` 根导入，改按需 `element-plus/es/...` |
| 测试挂 | 前端 `npx vitest run --reporter=verbose` 定位文件；后端 `cargo test --manifest-path src-tauri/Cargo.toml`；Tauri API 用 `src/tests/tauri-mock.ts` 打桩 |
| clone 下来只有 README | 你 clone 了 `main` 导航页，改用 `git clone -b tauri …` |

---

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
