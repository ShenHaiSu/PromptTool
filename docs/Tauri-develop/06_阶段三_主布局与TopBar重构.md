# 06 阶段三：主布局与 TopBar 重构

> **阶段编号：** P2-01 · **预计工期：** 2 人天 · **前置阶段：** 阶段二（领域+后端通过） · **分支：** `feat/tauri-vue-rust`

---

## 一、前置检查方案

| # | 检查项 | 命令（`tauri-app/`） | 目的 |
|---|--------|----------------------|------|
| C1 | 阶段二验收通过 | `bunx vitest run 2>&1 \| tail -5` | 引擎+后端就绪 |
| C2 | Rust Command 可调 | `cargo check --manifest-path src-tauri/Cargo.toml` | 后端无编译错误 |
| C3 | 基座构建 | `bun run build 2>&1 \| tail -5` | 前端可构建 |
| C4 | Pinia Store 就绪 | `ls src/stores/*.ts && ls src/engine/*.ts` | 状态与引擎存在 |
| C5 | 设计 Token 就绪 | `cat src/assets/tokens.css \| head -10` | 样式基座存在 |
| C6 | 原布局参照 | `cat ../../src/ui/main_window.py \| grep -A2 "LAYOUT_WEIGHTS\|TOPBAR"` | 对齐原 30:38:32 / 88/168px 规范 |

---

## 二、前置检查结果期望值

| # | 期望 | 判定 |
|---|------|------|
| C1 | `vitest 60+ passed` | 阻塞 |
| C2 | `cargo check` 0 error | 阻塞 |
| C3 | `✓ built in <1s` `EXIT:0` | 阻塞 |
| C4 | `assembly.ts, batch.ts, history.ts, theme.ts` + `models.ts` 等存在 | 缺失则补 |
| C5 | `:root` 含 `--bg/--surface/--border/--primary` | 缺失则回阶段一 |
| C6 | `LAYOUT_WEIGHTS = {"left":30,"center":38,"right":32}`, `TOPBAR 88/168` | 与 P02-02 一致 |

---

## 三、既定目标

### 3.1 交付物

- [ ] `App.vue` 实现 **30:38:32 三栏 Resizable 布局**（基于 `allotment`/`vue-split-grid` 或 CSS Grid + `ResizeObserver`），GPU 合成，拖拽 sash 60fps
- [ ] `components/TopBar.vue` 实现 **88px折叠 / 168px展开** 顶部通栏：prompt 单行省略·展开、冲突 badge、IR 折叠、复制/导出
- [ ] `components/DimensionPanel.vue` 初版：`Tree` + 搜索 + NSFW pill（筛选联动 Pinia）
- [ ] `components/HistoryPanel.vue` 占位（Tabs 壳）
- [ ] 布局状态持久化：`sash 比例 + 主题` 存 `localStorage` + Rust 侧 `pmf.json`（兼容原逻辑）

### 3.2 量化目标

- 拖拽 sash / 窗口 resize 时 **≥55fps**（Performance 面板）
- 首屏渲染 <300ms（空数据）
- 明暗主题切换无闪烁（<50ms）

---

## 四、实现方案

### 4.1 文件清单

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/App.vue` | 重写 | 三栏布局壳 + TopBar + StatusBar + 主题切换 |
| `src/components/TopBar.vue` | 新增 | 顶部通栏（对标 `src/ui/topbar.py 186行`） |
| `src/components/DimensionPanel.vue` | 新增 | 左栏（对标 `dimension_panel.py 379行`） |
| `src/components/HistoryPanel.vue` | 新增（占位） | 右下 Tabs 壳 |
| `src/components/BatchFactory.vue` | 新增（占位） | 右上占位 |
| `src/composables/useResizeObserver.ts` | 新增 | 监听容器宽度，更新 wraplength（替代 tkinter `bind<Configure>`） |
| `src/stores/theme.ts` | 修改 | 持久化 `localStorage['pmf-theme']` + `document.documentElement.classList.toggle('dark')` |
| `src/stores/assembly.ts` | 修改 | 暴露 `ir/finalPrompt/warnings` 供 TopBar 订阅 |
| `src/lib/utils.ts` | 修改 | `cn()` + `ellipsis()` |

### 4.2 布局设计（对标 P02-02）

```
┌─────────────────────────────────────────────────────────────┐ 1600x1080
│ TopBar 88px(折叠) / 168px(展开) — 全宽 flex, GPU 合成       │
│  [badge 120px] [prompt flex-1 truncate] [actions 160px]     │
│  └─ IR 折叠区 80px (JSON + warnings)                        │
├──────────────┬──────────────────────┬───────────────────────┤ 748px
│ Dimension    │ AssemblyCanvas       │ Batch + History       │ 30:38:32
│ 320px        │ 560px                │ 520px                 │
│ Tree + 搜索  │ (阶段四实现)         │ (占位)                │
├──────────────┴──────────────────────┴───────────────────────┤
│ StatusBar — 维度/条目/已选/历史/收藏/模型 + 主题 ☀/🌙       │ 22px
└─────────────────────────────────────────────────────────────┘
```

**实现要点：**

- **三栏**：`CSS Grid: grid-cols-[320px_8px_1fr_8px_520px]` 或 `allotment` 库；sash 拖拽用 `pointer events` + `requestAnimationFrame`，**禁用** `onMouseMove` 每像素 setState 的防抖陷阱，改用 CSS `flex` 让浏览器合成.
- **TopBar**：`prompt` 单行 `truncate` + `...展开` 按钮，展开后 `max-h-24 overflow-y-auto`；`badge` 用 `shadcn Badge` variant `success/warning`；`IR` 区 `pre` + `max-h-20`; `复制` 用 `navigator.clipboard.writeText` + Toast.
- **DimensionPanel**：`Input` 实时过滤（`computed filteredModules`），`NSFW Pill` 为 `Toggle`；`Tree` 用 `shadcn Collapsible` 按维度分组，每项 `ModuleRow` 显示 `displayName + weight + NSFW dot`.

**关键代码片段**

```vue
<!-- App.vue 骨架 -->
<script setup lang="ts">
import TopBar from '@/components/TopBar.vue'
import DimensionPanel from '@/components/DimensionPanel.vue'
import { useAssemblyStore } from '@/stores/assembly'
const assembly = useAssemblyStore()
</script>
<template>
  <div class="h-screen flex flex-col bg-[var(--bg)]">
    <TopBar :prompt="assembly.finalPrompt" :warnings="assembly.warnings" :ir="assembly.ir" />
    <div class="flex-1 grid grid-cols-[320px_8px_1fr_8px_1fr] gap-0 overflow-hidden">
      <DimensionPanel />
      <div class="bg-[var(--border)] cursor-col-resize" /> <!-- sash -->
      <div class="overflow-auto"><!-- AssemblyCanvas 占位 --></div>
      <div class="bg-[var(--border)] cursor-col-resize" />
      <div class="flex flex-col overflow-hidden"><BatchFactory /><HistoryPanel /></div>
    </div>
    <StatusBar />
  </div>
</template>
```

### 4.3 与原项目对齐

- `TOPBAR_HEIGHT_COLLAPSED=88 / EXPANDED=168` → Vue 中 `h-[88px] / h-[168px]` + `transition-all duration-200`.
- `LAYOUT_WEIGHTS 30:38:32` → CSS Grid 比例，sash 持久化存 `localStorage['pmf-sash'] = [0.30, 0.38]`.
- `StatusBar` 字段 `维度 11→14, 条目 165→311` 动态来自 `invoke('db_get_dimensions')`.

---

## 五、测试验收方式

### 5.1 自动化

```bash
bun run build && bunx vue-tsc --noEmit
bunx vitest run --reporter=verbose
# 组件冒烟
bunx vitest run src/components/__tests__/TopBar.test.ts
```

### 5.2 手工验收

| # | 步骤 | 期望 |
|---|------|------|
| H1 | `bunx tauri dev` 拖拽窗口边框 | 无卡顿，Performance 帧率 ≥55fps |
| H2 | 拖拽 sash（左右分隔条） | 三栏比例实时跟手，无白屏闪烁 |
| H3 | TopBar 空状态 → 添加 3 条目 → TopBar 实时拼接 | 单行省略正常，展开后全文可见 |
| H4 | 触发 R01（outfit+top）→ badge 变黄 | `⚠ 1 套装互斥` 黄色 badge |
| H5 | 点击复制 → 剪贴板 | `finalPrompt` 已复制，Toast 1.5s |
| H6 | 明暗切换 | 全量色值切换，重启后记忆 |

---

## 六、测试验收标准

| 验收项 | 通过标准 | 失败 |
|--------|----------|------|
| 构建 | `build` 0, `vue-tsc` 0, `cargo check` 0 | 非 0 |
| 帧率 | sash/窗口 resize ≥55fps | <45fps |
| TopBar | 单行省略/展开/IR折叠/badge/复制 5 功能正常 | 任一缺失 |
| 布局 | 30:38:32 比例正确，最小 1280x720 无溢出 | 溢出/错位 |
| 持久化 | 刷新后 sash/主题恢复 | 丢失 |

> **出口：** 帧率与 TopBar 5 功能为阻塞项，必须通过方可进入阶段四.

---

*下一阶段 07_阶段四_拼装画布与批量工厂*
