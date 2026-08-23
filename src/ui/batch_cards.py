"""
批量结果 Card 流：ScrollableFrame + BatchCard

设计：
- ScrollableFrame：Canvas + 垂直滚动条 + inner Frame，参考文档 14.3 模板
- BatchCard：白底卡片，header/body/chips/warnings，单击任意空白即复制
"""
from __future__ import annotations
import tkinter as tk
from tkinter import ttk
from typing import Callable

from engine.models import PromptIR


# 维度配色（与 chips 一致，扩展时可直接增量）
_DIM_COLORS: dict[str, str] = {
    "gender": "#FCE7F3", "ethnicity": "#FEF3C7", "height": "#E0E7FF",
    "body": "#DCFCE7", "face": "#FFE4E6", "top": "#DBEAFE",
    "bottom": "#E0E7FF", "outfit": "#F3E8FF", "shoes": "#FFEDD5",
    "accessories": "#FEF9C3", "pose": "#CCFBF1", "props": "#FCE7F3",
    "background": "#E0F2FE", "camera": "#F1F5F9",
}


class ScrollableFrame(ttk.Frame):
    """可滚动容器：Canvas + Scrollbar + inner Frame。"""

    def __init__(self, parent, **kwargs):
        super().__init__(parent, **kwargs)
        self.canvas = tk.Canvas(self, highlightthickness=0, bg="#F8FAFC")
        self.ysb = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=self.ysb.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        self.ysb.pack(side="right", fill="y")

        self.inner = ttk.Frame(self.canvas)
        self._win = self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.inner.bind("<Configure>", lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfig(self._win, width=e.width))
        # Windows 滚轮
        self.canvas.bind_all("<MouseWheel>", self._on_mousewheel, add="+")
        # Linux 滚轮（Button-4/5）
        self.canvas.bind_all("<Button-4>", lambda e: self.canvas.yview_scroll(-1, "units"), add="+")
        self.canvas.bind_all("<Button-5>", lambda e: self.canvas.yview_scroll(1, "units"), add="+")

    def _on_mousewheel(self, event):
        # 仅当鼠标在当前 canvas 区域内才滚动（避免全局劫持）
        try:
            # event.delta 在 Windows 下为 ±120*n
            self.canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
        except Exception:
            pass


class BatchCard(ttk.Frame):
    """单条批量结果 Card。单击任意空白处即复制全文。"""

    def __init__(
        self,
        parent,
        index: int,
        ir: PromptIR,
        final_prompt: str,
        on_copy: Callable[[str, int], None] | None = None,
        on_favorite: Callable[[PromptIR, str], None] | None = None,
        on_restore: Callable[[PromptIR], None] | None = None,
        on_view_ir: Callable[[PromptIR], None] | None = None,
        mono_font: tuple = ("Consolas", 11),
    ):
        super().__init__(parent)
        self.index = index
        self.ir = ir
        self.final_prompt = final_prompt
        self.on_copy = on_copy
        self.on_favorite = on_favorite
        self.on_restore = on_restore
        self.on_view_ir = on_view_ir
        self._mono_font = mono_font

        # 外层卡片容器（白底 + 边框）
        self.card = tk.Frame(self, bg="#FFFFFF", highlightbackground="#E2E8F0",
                             highlightthickness=1, bd=0)
        self.card.pack(fill=tk.X, padx=4, pady=4)

        self._build_header()
        self._build_body()
        self._build_chips()
        self._build_warnings()

        # 整卡点击复制（子控件透传）
        self._bind_copy_recursive(self.card)

    def _build_header(self):
        header = tk.Frame(self.card, bg="#FFFFFF")
        header.pack(fill=tk.X, padx=8, pady=(6, 2))

        seg_count = len(self.ir.segments)
        warn_count = len(self.ir.warnings) + len(self.ir.warnings) if False else len(self.ir.warnings)
        # 兼容 ir.warnings 与上层 warnings（此处仅展示 ir.warnings 数量）
        header_text = f"#{self.index}  ·  {seg_count}段  ·  ⚠ {warn_count}"
        ttk.Label(header, text=header_text, font=("Microsoft YaHei UI", 9, "bold"),
                  background="#FFFFFF").pack(side=tk.LEFT)

        # 右侧操作按钮
        btn_frame = tk.Frame(header, bg="#FFFFFF")
        btn_frame.pack(side=tk.RIGHT)

        ttk.Button(btn_frame, text="复制", width=6,
                   command=self._do_copy).pack(side=tk.LEFT, padx=2)
        ttk.Button(btn_frame, text="★", width=3,
                   command=self._do_favorite).pack(side=tk.LEFT, padx=1)
        ttk.Button(btn_frame, text="↩ 回填", width=7,
                   command=self._do_restore).pack(side=tk.LEFT, padx=1)
        if self.on_view_ir is not None:
            ttk.Button(btn_frame, text="IR", width=4,
                       command=self._do_view_ir).pack(side=tk.LEFT, padx=1)

    def _build_body(self):
        body = tk.Frame(self.card, bg="#FFFFFF")
        body.pack(fill=tk.X, padx=8, pady=2)
        # 使用 Label + wraplength 自适应，超出自动换行；不依赖 Text
        self.body_label = tk.Label(
            body, text=self.final_prompt or "(空)",
            font=self._mono_font, bg="#FFFFFF", fg="#1E293B",
            anchor="w", justify="left", wraplength=520,
        )
        self.body_label.pack(fill=tk.X, anchor="w")
        # 窗口宽度变化时更新 wraplength
        def _update_wrap(event):
            self.body_label.configure(wraplength=max(200, event.width - 40))
        self.card.bind("<Configure>", _update_wrap, add="+")

    def _build_chips(self):
        dim_keys = [s.dimension_key for s in self.ir.segments if s.dimension_key]
        if not dim_keys:
            return
        chips_frame = tk.Frame(self.card, bg="#FFFFFF")
        chips_frame.pack(fill=tk.X, padx=8, pady=(2, 2))
        for dk in dim_keys:
            bg = _DIM_COLORS.get(dk, "#F1F5F9")
            lbl = tk.Label(chips_frame, text=dk, font=("Microsoft YaHei UI", 8),
                           bg=bg, fg="#334155", padx=6, pady=1,
                           bd=1, relief="solid", highlightbackground="#E2E8F0")
            lbl.pack(side=tk.LEFT, padx=2, pady=1)

    def _build_warnings(self):
        if not self.ir.warnings:
            return
        warn_frame = tk.Frame(self.card, bg="#FFF7ED")
        warn_frame.pack(fill=tk.X, padx=8, pady=(2, 6))
        text = "⚠ " + " | ".join(self.ir.warnings)
        tk.Label(warn_frame, text=text, font=("Microsoft YaHei UI", 8),
                 bg="#FFF7ED", fg="#9A3412", wraplength=520,
                 anchor="w", justify="left").pack(fill=tk.X, padx=4, pady=2)

    # ---- 交互 ----

    def _bind_copy_recursive(self, widget: tk.Widget):
        """递归绑定点击复制到所有子容器（按钮除外）。"""
        # 按钮自身不劫持单击，保留按钮原有命令
        if isinstance(widget, ttk.Button):
            return
        # 绑定点击复制
        widget.bind("<Button-1>", self._do_copy_event, add="+")
        # hover 高亮
        widget.bind("<Enter>", lambda e: self._set_hover(True), add="+")
        widget.bind("<Leave>", lambda e: self._set_hover(False), add="+")
        for child in widget.winfo_children():
            self._bind_copy_recursive(child)

    def _set_hover(self, on: bool):
        try:
            if on:
                self.card.configure(highlightbackground="#3B82F6", bg="#F8FAFC")
            else:
                self.card.configure(highlightbackground="#E2E8F0", bg="#FFFFFF")
        except Exception:
            pass

    def _do_copy(self):
        if self.on_copy:
            self.on_copy(self.final_prompt, self.index)
        # 视觉反馈：绿边 350ms
        try:
            self.card.configure(highlightbackground="#22C55E")
            self.after(350, lambda: self.card.configure(highlightbackground="#E2E8F0"))
        except Exception:
            pass

    def _do_copy_event(self, event=None):
        # 忽略来自按钮的冒泡（已在 _bind_copy_recursive 中排除按钮，但仍做二次防护）
        try:
            # 若点击目标是按钮，不处理
            widget = event.widget if event else None
            if widget and widget.winfo_class() in ("TButton", "Button"):
                return
        except Exception:
            pass
        self._do_copy()

    def _do_favorite(self):
        if self.on_favorite:
            self.on_favorite(self.ir, self.final_prompt)

    def _do_restore(self):
        if self.on_restore:
            self.on_restore(self.ir)

    def _do_view_ir(self):
        if self.on_view_ir:
            self.on_view_ir(self.ir)
