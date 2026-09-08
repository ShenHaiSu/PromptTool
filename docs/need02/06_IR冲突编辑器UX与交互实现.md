# 06 — IR 冲突编辑器 UX 与交互实现

> 本文档定布局、视觉、交互、快捷键、测试契约。约束：**只用现有基础组件 + 语义 token**，不引入 Dialog/Popover 库；`z` 取 `40/50` 对话框、`70` 菜单浮窗；暗色必须验证一遍。

---

## 1. 总布局（三区 + 两栏）

```
┌ IrConflictEditorDialog（居中，w-[min(1120px,94vw)] max-h-[min(84vh,800px)]）┐
│ 标题行 h-9：[标题 text-sm font-semibold] [findings Badge]        [↩撤销][✕] │
│ 工具行：[+ 添加空段] [全部解锁?] [profile select] [separator select] [☐权重括号] │
├────────────── 左区 58% ──────────────┬────────── 右区 42% ─────────────────┤
│ Segment Table（ScrollArea flex-1）    │ Tabs(findings/rules)                │
│ 段卡片流（见 §2）                     │ findings 列表 / RuleListPanel       │
├──────────────────────────────────────┴─────────────────────────────────────┤
│ 底栏预览：finalPrompt（font-mono line-clamp-3 + 展开）· N 段 · hash短码      │
│        [复制全文][导出CSV][另存方案][应用到画布 primary]                     │
└────────────────────────────────────────────────────────────────────────────┘
```

- 容器抄 `PromptPreviewDialog` 居中模式：`fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4` + 内层 `Card p-4 shadow-xl`，`@click.self` 关闭（脏时先 confirm），`Escape` 关闭。
- 左右区：`flex gap-3 min-h-0 flex-1`，左 `flex-[58]` 右 `flex-[42]`，各自 `section.flex.min-h-0.flex-1.flex-col.overflow-hidden` + `ScrollArea.flex-1`（面板定高禁止，沿用 DimensionPanel 三段式）。
- 窄屏（`<900px`）：左右改上下堆叠（`flex-col`），右区 `max-h-[38vh]`。

---

## 2. 视觉语言（沿用 + 增补）

沿用（禁发明）：

- 密度：标题 `text-sm font-semibold h-9`，控件 `h-7 text-xs`，元信息 `text-xs text-muted-foreground`，徽标 `text-[10/11px]`。
- 维度身份：`dimColor(key)` 左边框 4px + 圆点 `h-2 w-2` + 浅底 `rgba(dimColor,0.08/0.16 dark)`（抄 `selected-card` 内联 style 逻辑）。
- 警告：`text-amber-600 dark:text-amber-400` + 底 `bg-amber-50 dark:bg-amber-950`；冲突删除用 `destructive`；成功瞬间 `ring-green-500`。
- 字体：Prompt/权重/dimKey/计数一律 `font-mono`，`whitespace-pre-wrap break-words`。
- Toast 时长：成功 1200-1500ms，提示 1800ms，错误常驻至手动关（沿用 `useToast`）。

增补（本需求新增语义，需全局一致）：

| 元素 | 样式 |
|------|------|
| `type Badge` | `mutex: bg-amber-100 text-amber-800`、`requires: bg-blue-100 text-blue-800`、`excludes: bg-orange-100 text-orange-800`、`limit: bg-slate-100 text-slate-700`、`isolated: destructive` |
| `severity` 色点 | `error: bg-red-500`、`warning: bg-amber-500`（`h-2 w-2 rounded-full`） |
| findings 头 Badge | `✓ 无冲突：secondary` / `⚠ N 冲突：amber` / `⛔ N 错误：destructive`，`data-testid=ir-editor-badge` |
| fix 预览子块 | `rounded-md border bg-muted/30 p-2`，移除 chips `destructive outline`，保留 chips `secondary` |
| 定位高亮 | `ring-2 ring-primary` 持续 1.2s（`setTimeout` 清除，`prefers-reduced-motion` 下直接跳过动画只滚动） |
| 锁定段 | `ring-1 ring-primary` 常驻 + `🔒` 实心态 |

---

## 3. 控件明细

### 3.1 标题行

- 左：标题 + `ir-editor-badge`（文案规则：`0 → ✓ 无冲突`；`>0 且无 error → ⚠ N 冲突`；`有 error → ⛔ N 错误`）。
- 右：`ir-editor-undo（↩ 撤销，disabled=undoStack空）` + 关闭 `✕`（ghost）。

### 3.2 工具行

- `ir-editor-add-seg（+ 添加空段，outline h-7 text-xs）`。
- `ir-editor-unlock-all（全部解锁，ghost，仅有锁定段时显示）`。
- 右侧配置组（`ml-auto flex gap-2`）：`profile select（SD/MJ/Flux，ir-editor-profile）` + `separator select（, / 空格 / 换行，ir-editor-separator）` + `☐ 权重括号 checkbox（ir-editor-brackets）`。改动即重算预览（`dirty=true`，但不触发 findings 重算）。

### 3.3 段卡片（左区行）

```
┌ [≡][●][dimKey chip][text截断 flex-1][w stepper][🔒][✕] ┐
└ 展开行：[text Input 全文][sourceModuleId 缩略][维度中文名][写回权重][启用开关] ┘
```

- 收起态 `px-3 py-2`，`hover:shadow`；`text` 点击展开（`cursor-text`），`title` 为全文。
- `weight stepper`：`button wxx font-mono bg-muted` 显示 `w1.0`，点击弹浮窗（`Teleport body + fixed z-[70] + calcPopoverPos`，抄权重浮窗：`range 0.5-2.0 step0.1 + number input + 取消/确定`）。
- `title` 无障碍：禁用态必须写原因（如 `title='无来源模块，不可写回权重'`）。

### 3.4 冲突行（右区 findings 页）

```
[●severity][ruleName 加粗 xs][type Badge][message 两行截断 title=全文]
[#1][#3] 段号 chips（ir-editor-goto-{i}）
[自动修复 primary h-6 text-xs | 定位 ghost | 忽略 ghost]
└ fix 预览子块（确认应用 destructive?/primary + 取消）
```

### 3.5 底栏预览

- 左：`finalPrompt`（`font-mono text-xs line-clamp-3`，`>400 字符` 给展开按钮，抄预览弹窗）+ 元信息 `N 段 · M 字符 · #短hash`。
- 右：`复制全文（outline）/ 导出 CSV（outline）/ 另存方案（outline）/ 应用到画布（default primary）`，`ir=null` 空态时除关闭外全 `disabled`。

---

## 4. 入口与调用（三处，按优先级）

| 入口 | 位置 | 行为 |
|------|------|------|
| P0 | `PromptPreviewDialog` 新增 `ir-editor-open（冲突编辑，outline h-7 text-xs）`，位于复制/导出右侧；badge 改读 `findings`（`✓/⚠/⛔` 规则同 §3.1，fallback 老关键字分类） | `IrConflictEditorDialog.open(ir, config)`，`applied` 后回写预览的 `prompt/ir`（父组件 `update:prompt` 或重 `reassemble`——以 `assembly` 为真源时直接 `assembly.setSelected` 后预览自动更新） |
| P0 | `BatchCard` 新增 `batch-card-edit（编辑，outline h-6 px-2 text-xs）`，位于复制/收藏/回填右侧；警告行优先显示 `findings[0].message` | 打开后 `applied` 提供“更新本卡”（用新 ir/final 重算该卡，见 05 §6 注：首版若成本高可仅支持“回填到画布”，但必须在 07 验收明确） |
| P1 | `DimensionPanel` 已选设置区“冲突 N”徽标（可选，首版可不做，若做则为 `dim-conflict-badge`，点击打开当前画布 ir 的编辑器） | 复用同一对话框，`ir=assembly.ir` |

---

## 5. 性能与暗色

- findings 计算同步、debounce 仅用于 text 输入（300ms）；段表 `>50` 行启用 `@tanstack/vue-virtual`（参数抄 `BatchFactory`：`estimateSize=110 overscan=5`），不足则普通渲染。
- 暗色：全部语义类 + `dark:` 变体走查一遍（amber 底、destructive、muted）；`dimColor` 在暗色下浅底用 `0.16` 透明度（抄 `selectedCardBg` 逻辑）。
- 动效：仅保留 hover 阴影 + 高亮 ring；尊重 `prefers-reduced-motion`。

---

## 6. 测试契约（`data-testid` 清单，新增即断言锚点）

```
ir-editor-overlay / ir-editor-dialog / ir-editor-badge / ir-editor-close
ir-editor-undo / ir-editor-add-seg / ir-editor-unlock-all
ir-editor-profile / ir-editor-separator / ir-editor-brackets
ir-editor-seg-list / ir-editor-seg-row-{index} / ir-editor-seg-text-{index}
ir-editor-seg-weight-{index} / ir-editor-seg-lock-{index} / ir-editor-seg-del-{index}
ir-editor-seg-expand-{index} / ir-editor-seg-writeback-{index} / ir-editor-seg-enabled-{index}
ir-editor-tabs / ir-editor-tab-findings / ir-editor-tab-rules
ir-editor-finding-row-{ruleId} / ir-editor-fix-{ruleId} / ir-editor-fix-confirm-{ruleId}
ir-editor-ignore-{ruleId} / ir-editor-locate-{ruleId} / ir-editor-goto-{index}
ir-editor-preview / ir-editor-preview-expand / ir-editor-hash
ir-editor-copy / ir-editor-export / ir-editor-save / ir-editor-apply
rule-list / rule-search / rule-create-btn / rule-row-{id} / rule-toggle-{id}
rule-edit-{id} / rule-del-{id}
rule-dialog / rule-name / rule-type / rule-source-dim / rule-source-module
rule-target-dim / rule-target-module / rule-limit-count / rule-message / rule-enabled / rule-save
```

- 单测 colocated：`src/engine/ruleEngine.test.ts`（五类语义 × 锁定矩阵）、`src/lib/irEdit.test.ts`（纯函数）、`src/components/__tests__/IrConflictEditor.behavior.test.ts`（打开/改段/修复/应用三出口）。
- 对话框统一 `v-model:open + update:open`，`defineExpose({refresh})`。

---

## 7. 快捷键与无障碍

| 按键 | 上下文 | 行为 |
|------|--------|------|
| `Escape` | 对话框/浮窗 | 关闭浮窗 → 关闭对话框（脏则 confirm） |
| `Ctrl/Cmd+Enter` | 规则表单 / 段展开输入 | 保存规则 / 确认改字 |
| `Ctrl+Z` | 编辑器内 | 撤销（限 draft 段表操作） |
| `Tab` 序 | 全框 | 标题 Vine → 工具行 → 段表 → Tabs → 底栏，浮窗打开时陷焦（`focus-trap` 手写：抄权重浮窗 `nextTick` 聚焦首个 input） |

- 所有图标按钮必须有 `title` + `aria-label`（`✕/🔒/↩/⋮⋮` 不可裸奔）。
- 菜单/列表加 `role=menu/menuitem`（规则列表操作区）或 `role=list/listitem`（段表/冲突表）。

---

*下一读：[07_施工计划与验收标准.md](07_施工计划与验收标准.md)*
