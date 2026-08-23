"""
批量结果 Card 流：ScrollableFrame + BatchCard（P02 Token 化 + 自适应）
"""
from __future__ import annotations
import tkinter as tk
from tkinter import ttk
from typing import Callable

from engine.models import PromptIR
from ui.styles import TOKENS_LIGHT, DIM_COLORS

_TOKENS = TOKENS_LIGHT
_DIM_COLORS = DIM_COLORS


class ScrollableFrame(ttk.Frame):
    """可滚动容器：Canvas + Scrollbar + inner Frame。"""

    def __init__(self, parent, **kwargs):
        super().__init__(parent, **kwargs)
        self.canvas = tk.Canvas(self, highlightthickness=0, bg=_TOKENS["bg"])
        self.ysb = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=self.ysb.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        self.ysb.pack(side="right", fill="y")

        self.inner = ttk.Frame(self.canvas)
        self._win = self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.inner.bind("<Configure>", lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfig(self._win, width=e.width))
        # 仅 canvas 局部滚轮，不劫持全局
        self.canvas.bind("<MouseWheel>", self._on_mousewheel)
        self.canvas.bind("<Button-4>", lambda e: self.canvas.yview_scroll(-1, "units"))
        self.canvas.bind("<Button-5>", lambda e: self.canvas.yview_scroll(1, "units"))
        # inner 上的滚轮也转发
        self.inner.bind("<MouseWheel>", self._on_mousewheel)

    def _on_mousewheel(self, event):
        try:
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

        self.card = tk.Frame(self, bg=_TOKENS["surface"], highlightbackground=_TOKENS["border"],
                             highlightthickness=1, bd=0)
        self.card.pack(fill=tk.X, padx=4, pady=4)

        self._build_header()
        self._build_body()
        self._build_chips()
        self._build_warnings()
        self._bind_copy_recursive(self.card)

    def _build_header(self):
        header = tk.Frame(self.card, bg=_TOKENS["surface"])
        header.pack(fill=tk.X, padx=8, pady=(6, 2))
        seg_count = len(self.ir.segments)
        warn_count = len(self.ir.warnings)
        header_text = f"#{self.index}  ·  {seg_count}段  ·  ⚠ {warn_count}"
        ttk.Label(header, text=header_text, font=("Microsoft YaHei UI", 9, "bold"),
                  background=_TOKENS["surface"]).pack(side=tk.LEFT)
        btn_frame = tk.Frame(header, bg=_TOKENS["surface"])
        btn_frame.pack(side=tk.RIGHT)
        ttk.Button(btn_frame, text="复制", width=6, command=self._do_copy).pack(side=tk.LEFT, padx=2)
        ttk.Button(btn_frame, text="★", width=3, command=self._do_favorite).pack(side=tk.LEFT, padx=1)
        ttk.Button(btn_frame, text="↩ 回填", width=7, command=self._do_restore).pack(side=tk.LEFT, padx=1)
        if self.on_view_ir is not None:
            ttk.Button(btn_frame, text="IR", width=4, command=self._do_view_ir).pack(side=tk.LEFT, padx=1)

    def _build_body(self):
        body = tk.Frame(self.card, bg=_TOKENS["surface"])
        body.pack(fill=tk.X, padx=8, pady=2)
        self.body_label = tk.Label(
            body, text=self.final_prompt or "(空)",
            font=self._mono_font, bg=_TOKENS["surface"], fg=_TOKENS["text"],
            anchor="w", justify="left", wraplength=520,
        )
        self.body_label.pack(fill=tk.X, anchor="w")

        def _update_wrap(event):
            self.body_label.configure(wraplength=max(200, event.width - 40))
        self.card.bind("<Configure>", _update_wrap, add="+")

    def _build_chips(self):
        dim_keys = [s.dimension_key for s in self.ir.segments if s.dimension_key]
        if not dim_keys:
            return
        chips_frame = tk.Frame(self.card, bg=_TOKENS["surface"])
        chips_frame.pack(fill=tk.X, padx=8, pady=(2, 2))
        for dk in dim_keys:
            bg = _DIM_COLORS.get(dk, _TOKENS["border"])
            lbl = tk.Label(chips_frame, text=dk, font=("Microsoft YaHei UI", 8),
                           bg=bg, fg="#334155", padx=6, pady=1,
                           bd=1, relief="solid", highlightbackground=_TOKENS["border"])
            lbl.pack(side=tk.LEFT, padx=2, pady=1)

    def _build_warnings(self):
        if not self.ir.warnings:
            return
        warn_frame = tk.Frame(self.card, bg=_TOKENS["warning_bg"])
        warn_frame.pack(fill=tk.X, padx=8, pady=(2, 6))
        text = "⚠ " + " | ".join(self.ir.warnings)
        tk.Label(warn_frame, text=text, font=("Microsoft YaHei UI", 8),
                 bg=_TOKENS["warning_bg"], fg="#9A3412", wraplength=520,
                 anchor="w", justify="left").pack(fill=tk.X, padx=4, pady=2)

    def _bind_copy_recursive(self, widget: tk.Widget):
        if isinstance(widget, ttk.Button):
            return
        widget.bind("<Button-1>", self._do_copy_event, add="+")
        widget.bind("<Enter>", lambda e: self._set_hover(True), add="+")
        widget.bind("<Leave>", lambda e: self._set_hover(False), add="+")
        for child in widget.winfo_children():
            self._bind_copy_recursive(child)

    def _set_hover(self, on: bool):
        try:
            if on:
                self.card.configure(highlightbackground=_TOKENS["primary"], bg=_TOKENS["bg"])
            else:
                self.card.configure(highlightbackground=_TOKENS["border"], bg=_TOKENS["surface"])
        except Exception:
            pass

    def _do_copy(self):
        if self.on_copy:
            self.on_copy(self.final_prompt, self.index)
        try:
            self.card.configure(highlightbackground=_TOKENS["success"])
            self.after(350, lambda: self.card.configure(highlightbackground=_TOKENS["border"]))
        except Exception:
            pass

    def _do_copy_event(self, event=None):
        try:
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
