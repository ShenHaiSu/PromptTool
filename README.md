# Prompt Modular Factory — Web

> **技术栈：** `Vue 3 + TypeScript + Vite + Pinia + Tailwind + IndexedDB`
> **形态：** 纯前端静态 SPA，无后端，数据仅保存在本浏览器 IndexedDB（库名 `pmf-web`）。
> **分支：** `web-pure`；旧 Tauri/Rust 实现已整体移除（见 CHANGELOG `v3.1-web`）。

## 快速开始

```bash
# 安装依赖
npm install

# 本地开发（http://localhost:1420，strictPort）
npm run dev

# 类型检查 + 生产构建（产物 dist/，`base './'`，可直接静态托管或 file:// 打开）
npm run build

# 预览构建产物
npm run preview
```

## 界面布局

`src/App.vue` 三栏 + 底栏，无常驻 TopBar：

```
+----------------+----------------------+----------------+
| DimensionPanel | BatchFactory         | HistoryPanel   |
| 左栏（维度/   | 中栏（拼装/批量/预览）| 右栏（历史/    |
| 词条/已选）   |                      | 收藏/模板/规则）|
+----------------+----------------------+----------------+
| StatusBar（计数 / 词库 / 分片导入 / 主题）              |
```

双 sash 拖拽调比（`useSash`，`pmf:sash` 持久化），几何持久化 `usePersist`，窗口最小 `1280×720`。

## 目录结构

```
.
├── src/
│   ├── App.vue / main.ts / app.css / vite-env.d.ts
│   ├── engine/        # 拼装引擎：models / assembly / rules+ruleEngine+ruleTypes /
│   │                  #   adapters(SD/MJ/Flux) / random+randomHistory / irCodec / index
│   ├── stores/        # Pinia：assembly / batch / history / library / rules /
│   │                  #   theme / dbRegistry / dimensionPanel / randomHistory
│   ├── components/    # DimensionPanel / BatchFactory+BatchCard / HistoryPanel / StatusBar /
│   │                  #   LibraryDialog / SegmentImportDialog / PromptPreviewDialog /
│   │                  #   IrConflictEditorDialog / RuleEditDialog+RuleListPanel /
│   │                  #   DimensionEdit+Generate+Translate / ModuleEdit+ModuleBatch /
│   │                  #   SaveDialog / DbManagerDrawer / BusinessDbOnboardingDialog / ui
│   ├── composables/   # useSash / useToast / useShortcuts / usePersist /
│   │                  #   useVirtualList / useDragSort / useResizeObserver
│   ├── lib/           # db.idb.ts（IndexedDB 实现）+ db.*（按域拆分：dimensions/rows/
│   │                  #   segments/library/rules/templates/assemblies/batch/system/
│   │                  #   translation/batch）→ 入口 db.ts 聚合重导出；
│   │                  #   irEdit / segmentParse+segmentPrompt /
│   │                  #   translationParse+translationPrompt /
│   │                  #   fragmentGenerateParse+fragmentGeneratePrompt /
│   │                  #   moduleBatch / need05Position / clipboard / export.ts(CSV) /
│   │                  #   seed.ts+seed-data.ts / libraryEvents / idb / utils / config
│   └── assets/        # tokens.css / 设计 token
├── scripts/
│   └── gen-seed.mjs   # 从 docs/samplePrompt 生成 src/lib/seed-data.ts
├── docs/
│   ├── webFullStack/  # Web 版设计文档 00-09（从 00_目录与总览 起读）
│   ├── need01/        # 分片聚合 → 结果解析 → 批量回填（07 施工计划/验收）
│   ├── need02/        # IR 中间表示 + 规则引擎 + IR 冲突编辑器
│   ├── need03/        # 维度右键菜单 + 翻译/生成提示词组合器 + 批量入库
│   └── samplePrompt/  # 种子词条来源
├── public/            # 静态资源
├── index.html         # 含首屏主题 FOUC 防闪脚本
├── vite.config.ts     # base './' + port 1420 strictPort + @ 别名 + vitest(jsdom)
└── package.json       # 仅 dev/build/preview；测试用 npx vitest run
```

## 核心能力

- **拼装引擎** `src/engine/*`：`assemble()` + 规则 `R01-R03`/`ruleEngine` + `SD/MJ/Flux` 适配 + 随机/部分随机（含 `randomHistory` 去重）+ `PromptIR` 编解码（`irCodec`，`hash()` 去重）
- **规则与冲突**：`RuleListPanel + RuleEditDialog` 维护规则；`PromptPreviewDialog → IrConflictEditorDialog`（`irEdit`）逐段解决冲突后再落库（need02）
- **词条生产流**：
  - need01：聚合提示词分片（`segmentPrompt`）→ 结果解析（`segmentParse`）→ `SegmentImportDialog` 预览确认批量回填
  - need03：维度右键 `翻译`（`translationPrompt/Parse`）/ `生成`（`fragmentGeneratePrompt/Parse`）→ 批量入库（`moduleBatch`）
- **本地存储** `src/lib/db.*`：IndexedDB 建表、种子数据（14 维 / 全量词条 / 规则）、历史/收藏/模板、规则 CRUD，`db.ts` 为唯一入口
- **批量工厂**：`@tanstack/vue-virtual` 虚拟化长列表，数量钳制 1–500（`APP_CONFIG.batch`），一键复制全部、导出 CSV
- **资产沉淀**：历史/收藏/模板 + 快照回填二次确认
- **导入导出**：词库 JSON（标准 `pmf-library` 格式，去重导入，预览后二次确认）+ CSV 导出（UTF-8 BOM）+ 单库 Blob 导出
- **系统集成**：快捷键（`Ctrl+F` 聚焦搜索 / `Ctrl+S` 保存 / `Ctrl+C` 复制 / `Delete` 移除末项，输入框内不劫持）、明暗主题持久化（`pmf:theme` + 首屏脚本防闪）、Toast 队列（`MAX_TOASTS=5`）、全局错误处理、剪贴板 `execCommand` 回退

## 数据与隐私

纯本地版：数据仅保存在本浏览器 IndexedDB，不上传、不鉴权；换浏览器/清空站点数据会丢失，请在「词库管理」（`StatusBar` → `LibraryDialog`）中定期导出 JSON 备份。旧版本数据可先导出词库 JSON，再在此导入（camelCase 兼容别名保留）。

## 测试

```bash
npx vitest run --reporter=verbose
```

47 个测试文件、391 个用例全绿（含引擎/存储/生产流解析/store/组件行为/布局与 p6 系统测试）。`package.json` 未设 `test` 脚本，直接调用 `vitest`（配置见 `vite.config.ts` 的 `test` 段，`jsdom + ./vitest.setup.ts`）。

## 文档

- 设计文档：`docs/webFullStack/`（`00_目录与总览.md` 起读，01 现状盘点 … 09 构建部署验收）
- 需求文档：`docs/need01/`（分片回填）、`docs/need02/`（IR 与冲突编辑器）、`docs/need03/`（翻译/生成入库），各含 `00_目录与总览`
- 种子来源：`docs/samplePrompt/`，改后跑 `node scripts/gen-seed.mjs` 再构建
- 变更记录：`CHANGELOG.md`（当前 `v3.1-web`）

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar)
