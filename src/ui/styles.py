"""
ttk 主题与 Design Tokens（P02）。

- Token 驱动：色/字/距/圆角走 TOKENS_*，面板内禁止硬编码
- sv-ttk 明暗双主题，缺失时优雅回退 clam
"""
from __future__ import annotations
import tkinter as tk
from tkinter import ttk

TOKENS_LIGHT: dict[str, str | int] = {
    "bg": "#F8FAFC",
    "surface": "#FFFFFF",
    "border": "#E2E8F0",
    "border_strong": "#CBD5E1",
    "text": "#0F172A",
    "text_muted": "#64748B",
    "primary": "#3B82F6",
    "success": "#22C55E",
    "success_bg": "#DCFCE7",
    "warning": "#F59E0B",
    "warning_bg": "#FFFBEB",
    "danger": "#EF4444",
    "nsfw": "#E11D48",
    "space_xs": 4,
    "space_sm": 8,
    "space_md": 12,
    "space_lg": 16,
    "radius_sm": 6,
    "radius_md": 8,
    "radius_lg": 12,
    "rowheight": 28,
}

TOKENS_DARK: dict[str, str | int] = {
    "bg": "#0F172A",
    "surface": "#1E293B",
    "border": "#334155",
    "border_strong": "#475569",
    "text": "#F1F5F9",
    "text_muted": "#94A3B8",
    "primary": "#60A5FA",
    "success": "#4ADE80",
    "success_bg": "#14532D",
    "warning": "#FBBF24",
    "warning_bg": "#78350F",
    "danger": "#F87171",
    "nsfw": "#FB7185",
    "space_xs": 4,
    "space_sm": 8,
    "space_md": 12,
    "space_lg": 16,
    "radius_sm": 6,
    "radius_md": 8,
    "radius_lg": 12,
    "rowheight": 28,
}

DIM_COLORS: dict[str, str] = {
    "gender": "#FCE7F3",
    "ethnicity": "#FEF3C7",
    "height": "#E0E7FF",
    "body": "#DCFCE7",
    "face": "#FFE4E6",
    "top": "#DBEAFE",
    "bottom": "#E0E7FF",
    "outfit": "#F3E8FF",
    "shoes": "#FFEDD5",
    "accessories": "#FEF9C3",
    "pose": "#CCFBF1",
    "props": "#FCE7F3",
    "background": "#E0F2FE",
    "camera": "#F1F5F9",
}


def _mix_color(base: str, mix: str, ratio: float) -> str:
    """将 base 与 mix 按 ratio 混合（ratio 为 mix 占比）。用于暗色 DIM_COLORS。"""
    try:
        br, bg, bb = int(base[1:3], 16), int(base[3:5], 16), int(base[5:7], 16)
        mr, mg, mb = int(mix[1:3], 16), int(mix[3:5], 16), int(mix[5:7], 16)
        r = int(br * (1 - ratio) + mr * ratio)
        g = int(bg * (1 - ratio) + mg * ratio)
        b = int(bb * (1 - ratio) + mb * ratio)
        return f"#{r:02X}{g:02X}{b:02X}"
    except Exception:
        return base


def get_dim_colors(theme: str = "light") -> dict[str, str]:
    if theme == "dark":
        return {k: _mix_color(v, "#1E293B", 0.3) for k, v in DIM_COLORS.items()}
    return dict(DIM_COLORS)


def _sync_tk_widgets(root: tk.Tk, theme: str):
    """手动同步 tk.* 控件（Canvas / tk.Frame）在主题切换后。"""
    tokens = TOKENS_DARK if theme == "dark" else TOKENS_LIGHT
    bg = tokens["bg"]
    surface = tokens["surface"]
    border = tokens["border"]
    # 遍历所有子控件，按类型批量更新（不抛异常）
    try:
        for w in root.winfo_children():
            _sync_recursive(w, theme, tokens)
    except Exception:
        pass
    # root 背景
    try:
        root.configure(bg=bg)
    except Exception:
        pass


def _sync_recursive(widget, theme: str, tokens: dict):
    try:
        cls = widget.winfo_class()
    except Exception:
        return
    bg = tokens["bg"]
    surface = tokens["surface"]
    border = tokens["border"]
    # Canvas
    if cls == "Canvas":
        try:
            # 仅更新已知为面板背景的 Canvas；避免误改
            cur = widget.cget("bg")
            if cur in ("#F8FAFC", "#0F172A", bg, surface):
                widget.configure(bg=bg, highlightbackground=border)
        except Exception:
            pass
    # tk.Frame（含 BatchCard card）
    elif cls == "Frame":
        try:
            cur = widget.cget("bg")
            # 白底卡片 → surface，普通帧 → bg
            if cur in ("#FFFFFF", "#1E293B", surface):
                widget.configure(bg=surface, highlightbackground=border)
            elif cur in ("#F8FAFC", "#0F172A", bg):
                widget.configure(bg=bg)
        except Exception:
            pass
    for child in widget.winfo_children():
        _sync_recursive(child, theme, tokens)


def apply_style(root: tk.Tk, theme: str = "light") -> dict:
    """应用主题。优先 sv-ttk，缺失则回退 clam。始终统一 ttk 样式。"""
    use_sv = False
    try:
        import sv_ttk  # type: ignore
        sv_ttk.set_theme("dark" if theme == "dark" else "light")
        use_sv = True
    except Exception:
        # 优雅降级
        style = ttk.Style(root)
        try:
            style.theme_use("clam")
        except Exception:
            pass

    style = ttk.Style(root)
    # 统一样式（无论 sv-ttk 与否都覆盖，确保一致）
    style.configure("Treeview", font=("Microsoft YaHei UI", 10), rowheight=28)
    style.configure("Treeview.Heading", font=("Microsoft YaHei UI", 10, "bold"))
    style.configure("TButton", font=("Microsoft YaHei UI", 10), padding=6)
    style.configure("TLabel", font=("Microsoft YaHei UI", 10))
    style.configure("TLabelframe.Label", font=("Microsoft YaHei UI", 10, "bold"))
    tokens = TOKENS_DARK if theme == "dark" else TOKENS_LIGHT
    # badge 样式
    try:
        style.configure("Success.TLabel", background=tokens["success_bg"], foreground=tokens["success"] if theme == "dark" else "#166534")
        style.configure("Warning.TLabel", background=tokens["warning_bg"], foreground=tokens["warning"] if theme == "dark" else "#92400E")
    except Exception:
        pass

    dim_colors = get_dim_colors(theme)
    return {
        "mono": ("Consolas", 11),
        "mono_sm": ("Consolas", 10),
        "tokens": tokens,
        "dim_colors": dim_colors,
        "theme": theme,
        "use_sv": use_sv,
    }


def toggle_theme(root: tk.Tk, current: str) -> str:
    nxt = "dark" if current == "light" else "light"
    apply_style(root, nxt)
    _sync_tk_widgets(root, nxt)
    return nxt
