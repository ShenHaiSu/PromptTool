# PromptTool — Tauri Rebuild

> **分支说明：** `tauri` 为 `--orphan` 孤儿分支，与 `main` 无共同历史，专注 `Tauri 2 + Vue 3 + TypeScript + Rust` 彻底重构。老版本（Python/tkinter）保留在 `main` 分支。

## 技术栈

- 前端：Vue 3 + TypeScript + Vite + Tailwind CSS
- 后端：Rust (Tauri 2) + rusqlite + SQLite
- 包管理：Bun

## 目录结构

```
.
├── src/                 # Vue 前端源码
├── src-tauri/           # Rust 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
├── docs/Tauri-develop/  # 重构设计文档（00-10）
├── index.html
├── package.json
└── vite.config.ts
```

## 快速开始

```bash
# 安装依赖
bun install

# 开发（Vite + Tauri）
bun run tauri dev
# 或仅前端
bun run dev

# 构建
bun run build
bun run tauri build
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

## 分支策略

- `main` — Python/tkinter 线（维护态）
- `tauri` — Tauri 重构线（开发态，orphan）
- 未来交付：`tauri` 经评审后设为默认分支或内容覆盖归档到 `main`，不使用 `merge`（无共同祖先）

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
