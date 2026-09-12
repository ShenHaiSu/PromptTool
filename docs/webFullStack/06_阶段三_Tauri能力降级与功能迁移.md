# 06 阶段三 — Tauri 能力降级与功能迁移

## 原则

浏览器能做的用浏览器 API；多库/路径概念删除；凡删功能必给替代入口。

## 逐项改造

1. 文件导出（CSV/JSON）：复用 `lib/export.ts` Blob 下载；删除 `db_export_csv/db_export_library_to_dir` 分支。文件名 `pmf-batch-<ts>.csv` / `pmf-library-<ts>.json`。
2. 文件导入：`LibraryDialog/SegmentImportDialog/DimensionTranslateDialog/DimensionGenerateDialog` 的“选文件”改为 `input[type=file]`（`accept=".json,.txt,.csv"`）+ `File.text()`，走已有 `*_text` 解析链路；`showOpenFilePicker` 仅渐进增强。
3. 剪贴板：保留 `navigator.clipboard.writeText` + `execCommand` 回退（App/BatchFactory 已有），HTTPS/localhost 外降级为“选中文本手动复制”提示。
4. 多库下线：`DbManagerDrawer.vue/BusinessDbOnboardingDialog.vue/stores/dbRegistry.ts` 在 web-pure 隐藏入口（StatusBar 去掉 DB 管理按钮），`App.vue onMounted` 删除 `fetchActiveInfo/onboarding` 分支，改为 `library.fetchAll() + history.fetchAll()`。`db_validate/create/switch/repair/rebuild/remove/updateRegistry` 统一抛错并在 UI 移除调用点。
5. 旧库迁移：删除 `db_import_legacy_db` 自动迁移；替代文案：“Tauri 版 → 词库导出 JSON → Web 版导入”。
6. `revealInExplorer/getDefaultExportDir`：删除调用，UI 改为“下载后请自行打开文件夹”。

## 验收

- 无 `plugin-dialog/opener` import；无文件路径字符串（`C:\ / exe / data/`）；断网（file:// 或纯静态 serve）下全部 CRUD 可用。
