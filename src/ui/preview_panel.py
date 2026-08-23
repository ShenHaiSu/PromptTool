"""
右栏：预览与操作面板。

实时展示拼装预览、冲突提示、IR 详情、批量结果，
以及一键复制、随机生成、导出 CSV 操作。
"""
from __future__ import annotations
import json
import tkinter as tk
from tkinter import ttk
from typing import Callable

from engine.models import PromptIR


class PreviewPanel(ttk.Frame):
    """右栏面板：预览 + IR + 批量 + 操作。"""

    def __init__(self, parent, on_random: Callable, on_export: Callable,
                 mono_font: tuple = ("Consolas", 11)):
        super().__init__(parent)
        self.on_random = on_random    # 随机回调 (count, allow_nsfw, use_partial) -> None
        self.on_export = on_export    # 导出回调
        self._mono_font = mono_font
        self._batch_results: list[PromptIR] = []
        self._build_ui()

    def _build_ui(self):
        # 预览区
        ttk.Label(self, text="实时预览").pack(anchor=tk.W, padx=4, pady=(4, 2))
        self.preview_text = tk.Text(self, height=5, font=self._mono_font,
                                     wrap=tk.WORD, state=tk.DISABLED)
        self.preview_text.pack(fill=tk.X, padx=4, pady=2)

        # 冲突提示
        self.warning_label = tk.Label(self, text="无冲突", bg="#E8F5E9",
                                       font=("Microsoft YaHei UI", 10),
                                       anchor=tk.W, padx=4)
        self.warning_label.pack(fill=tk.X, padx=4, pady=2)

        # IR 详情
        ir_frame = ttk.LabelFrame(self, text="IR 详情")
        ir_frame.pack(fill=tk.X, padx=4, pady=4)
        self.ir_text = tk.Text(ir_frame, height=8, font=self._mono_font,
                               wrap=tk.NONE, state=tk.DISABLED)
        self.ir_text.pack(fill=tk.X, padx=4, pady=4)

        # 批量结果
        batch_frame = ttk.LabelFrame(self, text="批量结果")
        batch_frame.pack(fill=tk.BOTH, expand=True, padx=4, pady=4)

        ctrl = ttk.Frame(batch_frame)
        ctrl.pack(fill=tk.X, padx=4, pady=4)
        ttk.Label(ctrl, text="生成数量:").pack(side=tk.LEFT)
        self.batch_count_var = tk.IntVar(value=10)
        spin = ttk.Spinbox(ctrl, from_=1, to=500, width=5,
                           textvariable=self.batch_count_var)
        spin.pack(side=tk.LEFT, padx=4)
        ttk.Button(ctrl, text="随机生成", command=self._on_random_click).pack(side=tk.LEFT, padx=4)
        self.nsfw_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(ctrl, text="含 NSFW", variable=self.nsfw_var
                        ).pack(side=tk.LEFT, padx=4)
        self.partial_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(ctrl, text="可控部分随机", variable=self.partial_var
                        ).pack(side=tk.LEFT, padx=4)

        self.batch_text = tk.Text(batch_frame, font=self._mono_font,
                                   wrap=tk.WORD, state=tk.DISABLED)
        batch_ysb = ttk.Scrollbar(batch_frame, orient=tk.VERTICAL,
                                   command=self.batch_text.yview)
        self.batch_text.configure(yscrollcommand=batch_ysb.set)
        self.batch_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(4, 0), pady=4)
        batch_ysb.pack(side=tk.RIGHT, fill=tk.Y, pady=4)

        # 操作按钮
        action_frame = ttk.Frame(self)
        action_frame.pack(fill=tk.X, padx=4, pady=4)
        ttk.Button(action_frame, text="一键复制", command=self._on_copy).pack(side=tk.LEFT, padx=4)
        ttk.Button(action_frame, text="导出 CSV", command=self._on_export_click).pack(side=tk.LEFT, padx=4)

        # 当前模型标签
        ttk.Label(action_frame, text="当前模型: SD").pack(side=tk.RIGHT, padx=4)

    def update_preview(self, ir: PromptIR, final_prompt: str, warnings: list[str]):
        """由 MainWindow 调用，更新预览区。"""
        self.preview_text.config(state=tk.NORMAL)
        self.preview_text.delete("1.0", tk.END)
        self.preview_text.insert("1.0", final_prompt)
        self.preview_text.config(state=tk.DISABLED)

        # 冲突提示
        if warnings:
            self.warning_label.config(
                text="⚠ " + " | ".join(warnings),
                bg="#FFF2CC",
            )
        else:
            self.warning_label.config(text="无冲突", bg="#E8F5E9")

        # IR 预览
        ir_dict = {
            "segments": [
                {"dim": s.dimension_key, "text": s.text, "weight": s.weight}
                for s in ir.segments
            ],
            "warnings": ir.warnings,
        }
        self.ir_text.config(state=tk.NORMAL)
        self.ir_text.delete("1.0", tk.END)
        self.ir_text.insert("1.0", json.dumps(ir_dict, indent=2, ensure_ascii=False))
        self.ir_text.config(state=tk.DISABLED)

    def update_batch(self, results: list[PromptIR]):
        """更新批量结果区。"""
        self._batch_results = results
        self.batch_text.config(state=tk.NORMAL)
        self.batch_text.delete("1.0", tk.END)
        if not results:
            self.batch_text.insert(tk.END, "（无结果）")
        else:
            for i, ir in enumerate(results, 1):
                prompt = ", ".join(s.text for s in ir.segments)
                self.batch_text.insert(tk.END, f"--- #{i} ---\n{prompt}\n\n")
        self.batch_text.config(state=tk.DISABLED)

    def get_batch_results(self) -> list[PromptIR]:
        """返回当前批量结果，供 CSV 导出使用。"""
        return self._batch_results

    def _on_random_click(self):
        count = self.batch_count_var.get()
        self.on_random(count, self.nsfw_var.get(), self.partial_var.get())

    def _on_export_click(self):
        self.on_export()

    def _on_copy(self):
        """一键复制到剪贴板。"""
        content = self.preview_text.get("1.0", tk.END).strip()
        self.clipboard_clear()
        self.clipboard_append(content)
        self._show_toast("已复制到剪贴板")

    def _show_toast(self, msg: str):
        """简易 Toast：临时 Label。"""
        toast = ttk.Label(self, text=f"✓ {msg}", background="#4CAF50", foreground="white")
        toast.place(relx=0.5, rely=0.95, anchor=tk.CENTER)
        self.after(1500, toast.destroy)
