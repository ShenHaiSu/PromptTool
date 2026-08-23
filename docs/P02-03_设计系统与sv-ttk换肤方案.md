# P02-03 设计系统与 sv-ttk 换肤方案

> 分册 03/05 — Design Tokens、色板、字体、图标与 sv-ttk 接入细节

| 元信息 | 内容 |
|---|---|
| 分册 | 03/05 |
| 依赖 | `P02-00` `P02-02` |
| 关联代码 | `src/ui/styles.py` `src/ui/batch_cards.py` `src/config.py` `requirements.txt` |

---

## 1 目标与原则

- **Token 驱动**：色/字/距/圆角全部走 `styles.py` 导出，面板内禁止硬编码。
- **一键换肤**：`sv-ttk` 明暗双主题，缺失时优雅回退 `clam`。
- **一致性**：全量 `ttk` 为主，`tk.Frame(highlightbackground)` 仅在 `BatchCard` 保留并统一用 Token 边框。

---

## 2 Design Tokens

### 2.1 色板（Light 主题为基准，Dark 见 2.4）

| Token | Light 值 | 用途 | 现状对照 |
|---|---|---|---|
| `bg` | `#F8FAFC` | 画布/页面底 | `batch_cards.Canvas bg` |
| `surface` | `#FFFFFF` | 卡片/面板面 | `BatchCard bg` |
| `border` | `#E2E8F0` | 边框/分隔线 | `highlightbackground` |
| `border_strong` | `#CBD5E1` | 悬停/聚焦边框 | 无 |
| `text` | `#0F172A` | 主文本 | `fg #1E293B` |
| `text_muted` | `#64748B` | 次文本/占位 | 无 |
| `primary` | `#3B82F6` | 主按钮/悬停边 | 卡片 hover `#3B82F6` |
| `success` | `#22C55E` | 成功/无冲突 | `warning #E8F5E9` + toast `#4CAF50` 统一 |
| `success_bg` | `#DCFCE7` | 成功底 | 同上 |
| `warning` | `#F59E0B` | 冲突 badge | `#FFF2CC` |
| `warning_bg` | `#FFFBEB` | 冲突底 | `#FFF7ED` |
| `danger` | `#EF4444` | 删除/错误 | 无 |
| `nsfw` | `#E11D48` | NSFW 标记 | `#D32F2F` |

维度 chips 复用 `batch_cards._DIM_COLORS` 14 色，纳入 Tokens：

```python
DIM_COLORS = {
  "gender":"#FCE7F3","ethnicity":"#FEF3C7","height":"#E0E7FF",
  "body":"#DCFCE7","face":"#FFE4E6","top":"#DBEAFE",
  "bottom":"#E0E7FF","outfit":"#F3E8FF","shoes":"#FFEDD5",
  "accessories":"#FEF9C3","pose":"#CCFBF1","props":"#FCE7F3",
  "background":"#E0F2FE","camera":"#F1F5F9",
}
```

### 2.2 间距与圆角

| Token | 值 | 用途 |
|---|---|---|
| `space_xs` | 4px | chip 内距、按钮间隙 |
| `space_sm` | 8px | 卡片内距、行距 |
| `space_md` | 12px | 面板内边距 |
| `space_lg` | 16px | 区块间隙 |
| `radius_sm` | 6px | chips、badge |
| `radius_md` | 8px | 卡片、输入框 |
| `radius_lg` | 12px | TopBar、面板 |
| `rowheight` | 28px | Treeview 行高（保留） |
| `shadow` | `—` | tkinter 无阴影，用 `border_strong` 模拟，提升靠 `highlightbackground` |

tkinter 原生不支持 `border-radius`，圆角通过 `sv-ttk` 主题自带实现；`BatchCard` 仍用矩形边框，不强行模拟圆角。

### 2.3 字体

| Token | 值 | 用途 |
|---|---|---|
| `font_sans` | `("Microsoft YaHei UI", 10)` | 正文/标签 |
| `font_sans_bold` | `("Microsoft YaHei UI", 10, "bold")` | 标题/表头 |
| `font_sans_sm` | `("Microsoft YaHei UI", 9)` | 次要信息 |
| `font_mono` | `("Consolas", 11)` | 预览/ prompt 全文 |
| `font_mono_sm` | `("Consolas", 10)` | IR JSON |

`MONO_FONT` 保留但改由 `styles.apply_style` 统一返回 `{"mono": ..., "tokens": TOKENS}`。

### 2.4 暗色主题

| Token | Dark 值 | 切换 |
|---|---|---|
| `bg` | `#0F172A` | `sv_ttk.set_theme("dark")` 自动处理 ttk 部分 |
| `surface` | `#1E293B` | 同上 |
| `border` | `#334155` | 同上 |
| `text` | `#F1F5F9` | 同上 |
| `DIM_COLORS` 暗色 | 各色 `+ #1E293B` 混合 30% | 代码中 `mix_color(base, "#1E293B", 0.3)` |

tk 部分（`BatchCard tk.Frame / Canvas`）需手动在 `toggle_theme` 时重设 `bg/highlightbackground/fg`。

---

## 3 sv-ttk 接入

### 3.1 安装与依赖

`requirements.txt`：

```
pytest>=8.0
pytest-cov>=5.0
sv-ttk>=2.6
```

分发时 `pip install -r requirements.txt` 即含主题；离线环境可缺省。

### 3.2 styles.py 重写

```python
# src/ui/styles.py — 新版骨架
from __future__ import annotations
import tkinter as tk
from tkinter import ttk

TOKENS_LIGHT = {
  "bg": "#F8FAFC", "surface": "#FFFFFF", "border": "#E2E8F0",
  "border_strong": "#CBD5E1", "text": "#0F172A", "text_muted": "#64748B",
  "primary": "#3B82F6", "success": "#22C55E", "success_bg": "#DCFCE7",
  "warning": "#F59E0B", "warning_bg": "#FFFBEB", "danger": "#EF4444",
  "nsfw": "#E11D48",
  "space_xs": 4, "space_sm": 8, "space_md": 12, "space_lg": 16,
  "radius_sm": 6, "radius_md": 8, "radius_lg": 12,
}
TOKENS_DARK = { ... }  # 暗色对照
DIM_COLORS = { ... }   # 14 维

def apply_style(root: tk.Tk, theme: str = "light"):
    use_sv = False
    try:
        import sv_ttk
        sv_ttk.set_theme("dark" if theme == "dark" else "light")
        use_sv = True
    except Exception:
        # 优雅降级
        style = ttk.Style(root)
        try: style.theme_use("clam")
        except Exception: pass

    style = ttk.Style(root)
    # 统一样式（无论 sv-ttk 与否都生效）
    style.configure("Treeview", font=("Microsoft YaHei UI", 10), rowheight=28)
    style.configure("Treeview.Heading", font=("Microsoft YaHei UI", 10, "bold"))
    style.configure("TButton", font=("Microsoft YaHei UI", 10), padding=6)
    style.configure("TLabel", font=("Microsoft YaHei UI", 10))
    style.configure("TLabelframe.Label", font=("Microsoft YaHei UI", 10, "bold"))
    # 成功/警告 标签样式（供 badge 使用）
    style.configure("Success.TLabel", background=TOKENS_LIGHT["success_bg"])
    style.configure("Warning.TLabel", background=TOKENS_LIGHT["warning_bg"])

    tokens = TOKENS_DARK if theme == "dark" else TOKENS_LIGHT
    return {"mono": ("Consolas", 11), "mono_sm": ("Consolas", 10),
            "tokens": tokens, "dim_colors": DIM_COLORS,
            "theme": theme, "use_sv": use_sv}

def toggle_theme(root: tk.Tk, current: str) -> str:
    nxt = "dark" if current == "light" else "light"
    apply_style(root, nxt)
    # 手动同步 tk 控件（Canvas/BatchCard）
    _sync_tk_widgets(root, nxt)
    return nxt
```

要点：

- `try import sv_ttk` 包裹，缺失不抛异常。
- `TButton padding` 从 4 调至 6，贴合 Sun Valley。
- `Success/Warning.TLabel` 供 `TopBar badge` 直接 `style="Success.TLabel"`。

### 3.3 主题切换入口

- `MenuBar` 新增 `视图 → 浅色/深色`（`command=lambda: toggle_theme(root, ...)`），状态持久化到 `data/pmf.json: {"theme":"light"}`。
- `StatusBar` 右侧加 `☀/🌙` 按钮一键切换（`ttk.Button` 图标字）。
- 启动时 `app.py` 读取 `data/pmf.json` 决定 `apply_style(theme=...)`。

### 3.4 存量硬编码迁移清单

| 文件 | 硬编码 | 替换为 |
|---|---|---|
| `batch_cards.py` | `Canvas bg #F8FAFC` / `card bg #FFFFFF / border #E2E8F0 / hover #3B82F6 / copied #22C55E / warn #FFF7ED` | `tokens["bg"/"surface"/"border"/"primary"/"success"/"warning_bg"]` |
| `preview_panel.py` | `warning_label bg #E8F5E9/#FFF2CC` / `toast bg #4CAF50` | `tokens["success_bg"/"warning_bg"/"success"]` |
| `dimension_panel.py` | `nsfw fg #D32F2F` | `tokens["nsfw"]` |
| `history_panel.py` | 无硬编码，但 `height=8` 需改为 `fill` | `ttk` 自适应 |
| `assembly_panel.py` | `Listbox` 背景 | 废弃，改 canvas 后统一 |

---

## 4 图标与视觉细节

- **不引入图标库**：用 Unicode 符号 `★ ☆ 🔒 🔓 ✕ ⚠ ✓ ◈ …` 避免新增依赖；如需更精致可后续加 `Pillow` 贴图。
- **Toast**：从 `ttk.Label(bg="#4CAF50")` 改为 `tokens["success"]`，增加队列（`_toast_queue`）避免重叠，见 P02-04。
- **空状态**：`ttk.Label` 居中图文，`◈` 大字 + 灰字说明 + 操作按钮，已在 P02-02 定义。
- **焦点与无障碍**：所有 `Entry/Spinbox` 保留 `focus` 环，`Treeview` 选中态由 `sv-ttk` 接管。

---

## 5 验收（视觉）

- [ ] 明/暗双主题切换无报错，缺 `sv-ttk` 时回退 `clam` 功能正常。
- [ ] 全量色值走 Tokens，无面板内硬编码残留（`grep -rn "#[0-9A-F]" src/ui` 仅 `styles.py` 有定义）。
- [ ] Treeview/Button/Entry 在两主题下对比度达标，无黑底黑字。
- [ ] BatchCard hover/复制反馈色与 Token 一致。

> 下一分册 `P02-04` 给出组件拆分与数据流 diff。
