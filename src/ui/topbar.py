"""顶部通栏预览 TopPreviewBar。"""
from __future__ import annotations
import tkinter as tk
from tkinter import ttk
from typing import Callable
import json

from engine.models import PromptIR


class TopPreviewBar(ttk.Frame):
    def __init__(self, parent, on_copy: Callable[[str], None], on_export: Callable,
                 mono_font: tuple = ("Consolas", 11)):
        super().__init__(parent)
        self.on_copy = on_copy
        self.on_export = on_export
        self._mono_font = mono_font
        self._final_prompt: str = ""
        self._ir: PromptIR | None = None
        self._warnings: list[str] = []
        self._expanded: bool = False  # prompt 展开
        self._ir_expanded: bool = False
        self._build_ui()

    def _build_ui(self):
        # 主行
        main = ttk.Frame(self)
        main.pack(fill=tk.X, padx=8, pady=(8, 4))

        # badge
        self.badge = ttk.Label(main, text="无冲突 ✓", style="Success.TLabel", padding=(8, 2))
        self.badge.pack(side=tk.LEFT, padx=(0, 8))

        # prompt 容器（Label 单行省略 / Text 展开）
        self.prompt_frame = ttk.Frame(main)
        self.prompt_frame.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=4)
        self.prompt_label = ttk.Label(self.prompt_frame, text="(空) — 从左侧双击添加", foreground="#64748B", anchor="w")
        self.prompt_label.pack(fill=tk.X)
        self.prompt_label.bind("<Button-1>", lambda e: self._toggle_expand())
        # 展开用的 Text（初始隐藏）
        self.prompt_text = tk.Text(self.prompt_frame, font=self._mono_font, wrap=tk.WORD, height=3, state=tk.DISABLED)
        # 不 pack，展开时切换

        self.expand_btn = ttk.Button(main, text="展开▼", width=8, command=self._toggle_expand)
        self.expand_btn.pack(side=tk.LEFT, padx=4)

        # actions
        actions = ttk.Frame(main)
        actions.pack(side=tk.RIGHT, padx=(8, 0))
        self.copy_btn = ttk.Button(actions, text="复制", width=8, command=self._on_copy)
        self.copy_btn.pack(side=tk.LEFT, padx=2)
        self.copy_btn.configure(state=tk.DISABLED)
        ttk.Button(actions, text="导出", width=8, command=self.on_export).pack(side=tk.LEFT, padx=2)
        self.ir_btn = ttk.Button(actions, text="</> IR", width=7, command=self._toggle_ir)
        self.ir_btn.pack(side=tk.LEFT, padx=2)

        # IR 折叠区
        self.ir_frame = ttk.Frame(self)
        # 初始不 pack
        self.ir_text = tk.Text(self.ir_frame, font=self._mono_font, wrap=tk.NONE, height=4, state=tk.DISABLED)
        self.ir_text.pack(fill=tk.BOTH, expand=True, padx=8, pady=4)

        # 响应式 wraplength（prompt_label）
        self.bind("<Configure>", self._update_wraplength, add="+")

    def _update_wraplength(self, event=None):
        try:
            w = self.winfo_width()
            # badge~120 + actions~200 + pad 64
            avail = max(120, w - 120 - 200 - 64)
            self.prompt_label.configure(wraplength=avail)
            if hasattr(self, "ir_text"):
                self.ir_text.configure(wrap=tk.WORD)
        except Exception:
            pass

    def _toggle_expand(self):
        if not self._final_prompt:
            return
        self._expanded = not self._expanded
        if self._expanded:
            # 切换为 Text
            try:
                self.prompt_label.pack_forget()
            except Exception:
                pass
            self.prompt_text.configure(state=tk.NORMAL)
            self.prompt_text.delete("1.0", tk.END)
            self.prompt_text.insert("1.0", self._final_prompt)
            self.prompt_text.configure(state=tk.DISABLED)
            self.prompt_text.pack(fill=tk.X, pady=2)
            self.expand_btn.configure(text="收起▲")
        else:
            try:
                self.prompt_text.pack_forget()
            except Exception:
                pass
            self.prompt_label.pack(fill=tk.X)
            self.expand_btn.configure(text="展开▼")

    def _toggle_ir(self):
        self._ir_expanded = not self._ir_expanded
        if self._ir_expanded:
            self.ir_frame.pack(fill=tk.X, padx=8, pady=(0, 4))
            self._refresh_ir_text()
        else:
            try:
                self.ir_frame.pack_forget()
            except Exception:
                pass

    def _refresh_ir_text(self):
        if self._ir is None:
            return
        ir_dict = {
            "segments": [{"dim": s.dimension_key, "text": s.text, "weight": s.weight} for s in self._ir.segments],
            "warnings": self._ir.warnings,
        }
        self.ir_text.configure(state=tk.NORMAL)
        self.ir_text.delete("1.0", tk.END)
        self.ir_text.insert("1.0", json.dumps(ir_dict, indent=2, ensure_ascii=False))
        if self._warnings:
            self.ir_text.insert(tk.END, "\n\n⚠ " + " | ".join(self._warnings))
        self.ir_text.configure(state=tk.DISABLED)

    def _on_copy(self):
        if not self._final_prompt:
            return
        try:
            self.clipboard_clear()
            self.clipboard_append(self._final_prompt)
        except Exception:
            pass
        if self.on_copy:
            try:
                self.on_copy(self._final_prompt)
            except Exception:
                pass
        # 绿边反馈
        try:
            self.copy_btn.configure(style="Success.TButton" if False else "TButton")
        except Exception:
            pass

    def update(self, ir: PromptIR, final_prompt: str, warnings: list[str]):  # type: ignore[override]
        self._ir = ir
        self._final_prompt = final_prompt
        self._warnings = list(warnings or [])
        # badge
        if self._warnings:
            txt = f"⚠ {len(self._warnings)}  {self._warnings[0][:12]}"
            try:
                self.badge.configure(text=txt, style="Warning.TLabel")
            except Exception:
                self.badge.configure(text=txt)
        else:
            try:
                self.badge.configure(text="无冲突 ✓", style="Success.TLabel")
            except Exception:
                self.badge.configure(text="无冲突 ✓")
        # prompt 显示
        display = final_prompt if final_prompt else "(空) — 从左侧双击添加"
        # 单行省略：ttk.Label + wraplength 已处理，超长由 wraplength 截断
        self.prompt_label.configure(text=display, foreground="#0F172A" if final_prompt else "#64748B")
        if self._expanded:
            self.prompt_text.configure(state=tk.NORMAL)
            self.prompt_text.delete("1.0", tk.END)
            self.prompt_text.insert("1.0", final_prompt)
            self.prompt_text.configure(state=tk.DISABLED)
        # IR 刷新若已展开
        if self._ir_expanded:
            self._refresh_ir_text()
        # 复制按钮可用性
        try:
            self.copy_btn.configure(state=tk.NORMAL if final_prompt else tk.DISABLED)
        except Exception:
            pass
        # 兼容：供测试/旧代码读取
        self._last_final = final_prompt

    def clear(self):
        self.update(PromptIR(segments=[], warnings=[]), "", [])

    # 兼容旧 PreviewPanel 的 update_preview 别名
    def update_preview(self, ir: PromptIR, final_prompt: str, warnings: list[str]):
        self.update(ir, final_prompt, warnings)
