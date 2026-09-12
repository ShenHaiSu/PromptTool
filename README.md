# Prompt Modular Factory — Web

> **技术栈：** `Vue 3 + TypeScript + Vite + Pinia + Tailwind + IndexedDB`
> **形态：** 纯前端静态 SPA，无后端，数据仅保存在本浏览器 IndexedDB（库名 `pmf-web`）。
> **分支：** `web-pure`；旧 Tauri/Rust 实现已整体移除（见 CHANGELOG `v3.1-web`）。

## 快速开始

```bash
# 安装依赖
npm install

# 本地开发（http://localhost:1420）
npm run dev

# 类型检查 + 生产构建（产物 dist/，`base './'`，可直接静态托管或 file:// 打开）
npm run build

# 预览构建产物
npm run preview
```

## 目录结构

```
.
├── src/
│   ├── engine/        # 拼装引擎：models / assembly / rules / adapters / random
│   ├── stores/        # Pinia：assembly / batch / history / library / theme / dbRegistry / dimensionPanel
│   ├── components/    # TopBar / DimensionPanel / BatchFactory / HistoryPanel / 各类 Dialog / ui
│   ├── composables/   # useSash / useToast / useShortcuts / usePersist / useVirtualList / useDragSort
│   ├── lib/           # db.*（IndexedDB 适配层，按域拆分，入口 db.ts）/ export.ts（CSV）/ utils.ts / config.ts
│   └── assets/        # tokens.css / 设计 token
├── scripts/
│   └── gen-seed.mjs   # 从 docs/samplePrompt 生成 src/lib/seed-data.ts（`node scripts/gen-seed.mjs`）
├── docs/
│   ├── webFullStack/  # Web 版设计文档 00-09
│   ├── need01..03/    # 需求文档
│   └── samplePrompt/  # 种子词条来源
├── public/            # 静态资源
├── index.html         # 含首屏主题 FOUC 防闪脚本
├── vite.config.ts
└── package.json
```

## 核心能力

- **拼装引擎** `src/engine/*`：`assemble()` + 规则 `R01-R03` + 多模型适配（SD/MJ/Flux）+ 随机/部分随机，去重 `PromptIR.hash()`
- **本地存储** `src/lib/db.*`：IndexedDB 建表、种子数据（14 维 / 全量词条 / 规则）、历史/收藏/模板、规则 CRUD
- **批量工厂**：虚拟化长列表，数量钳制 1–500，一键复制全部、导出 CSV
- **资产沉淀**：历史/收藏/模板 + 快照回填二次确认
- **导入导出**：词库 JSON（标准 `pmf-library` 格式，去重导入，预览后二次确认）+ CSV 导出（UTF-8 BOM）
- **系统集成**：快捷键（`Ctrl+F/S/C`、`Delete`）、明暗主题持久化、Toast 队列、全局错误处理

## 数据与隐私

纯本地版：数据仅保存在本浏览器 IndexedDB，不上传、不鉴权；换浏览器/清空站点数据会丢失，请在「词库管理」中定期导出 JSON 备份。旧版本数据可先导出词库 JSON，再在此导入。

## 测试

```bash
npx vitest run --reporter=verbose
```

## 文档

设计文档见 `docs/webFullStack/`（00 目录与总览起读）；需求见 `docs/need01..03/`。

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar)
