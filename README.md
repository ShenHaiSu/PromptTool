# PromptTool（导航页）

> `main` 分支不再承载业务代码，仅作导航与归档入口。
> Python/tkinter 旧 lineage 已归档，请勿基于 `main` 开发。

## 当前有效分支

| 分支 | 用途 | 说明 |
|------|------|------|
| `tauri` | **主力：Windows 客户端** | Vue + Rust/Tauri，SQLite 本地后端，Windows 打包。默认开发线。 |
| `web-pure` | **静态前端项目** | 纯 Web，IndexedDB 本地后端，可静态部署，无 Rust 后端。 |

从 `b3ecf46（2026-09-10）` 分叉，之后各自独立演进，不再合回 `main`。

## 快速上手

```bash
# Windows 客户端（主力）
git clone -b tauri https://github.com/ShenHaiSu/PromptTool.git
# 静态前端
git clone -b web-pure https://github.com/ShenHaiSu/PromptTool.git
```

已有克隆切换：

```bash
git fetch origin
git checkout tauri
git checkout web-pure
```

对应 Release 标记：`v3.0-tauri` / `v3.0-web-pure`。

## 旧 `main` 归档

- 旧 Python/tkinter 代码已打 Tag 封存：`archive/main-python-final`（即原 `main@c18ed76`，2026-08-23）。
- 查看归档内容：`git checkout archive/main-python-final`
- `main` 与 `tauri`/`web-pure` 无共同祖先（orphan rebuild），不可 merge，只能按需 cherry-pick。

## 分支规则

1. 默认开发线为 `tauri`（请在 GitHub Settings → General → Default branch 改为 `tauri`）。
2. `main` 保持为本导航页，禁止提交业务代码（建议开启 Branch protection：Require PR）。
3. `tauri` 与 `web-pure` 各自独立发布，版本号/Tag 分开：`vX.Y-tauri` / `vX.Y-web-pure`。
4. 共性逻辑需要复用时，用 cherry-pick 點对点搬运，不要全量 merge。
