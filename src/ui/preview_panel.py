"""
兼容 shim：旧 PreviewPanel 转发至 TopPreviewBar + BatchFactory。

保留 1 个版本后可删除。旧测试/旧代码仍可 import PreviewPanel。
"""
from __future__ import annotations
import tkinter as tk
from tkinter import ttk
from typing import Callable

from engine.models import PromptIR, AssemblyConfig
from ui.batch_factory import BatchFactory
from ui.topbar import TopPreviewBar


class PreviewPanel(BatchFactory):
    """兼容旧名：继承 BatchFactory，额外暴露 preview_text/warning_label 等属性。"""

    def __init__(self, parent, on_random: Callable, on_export: Callable,
                 mono_font: tuple = ("Consolas", 11),
                 assembly_config_getter: Callable[[], AssemblyConfig] | None = None,
                 on_batch_favorite=None, on_batch_restore=None,
                 **_kwargs):
        super().__init__(parent, on_random=on_random, on_export=on_export,
                         mono_font=mono_font,
                         assembly_config_getter=assembly_config_getter,
                         on_batch_favorite=on_batch_favorite,
                         on_batch_restore=on_batch_restore)
        # 旧属性占位：部分测试会访问 preview_text / ir_text / warning_label
        self.preview_text = tk.Text(self, height=1, state=tk.DISABLED)
        self.ir_text = tk.Text(self, height=1, state=tk.DISABLED)
        self.warning_label = ttk.Label(self, text="无冲突")
        # 不 pack，仅占位

    def update_preview(self, ir: PromptIR, final_prompt: str, warnings: list[str]):
        # 兼容：旧调用方直接 update_preview；转发到父类的隐藏逻辑 + 同步文本占位
        try:
            self.preview_text.configure(state=tk.NORMAL)
            self.preview_text.delete("1.0", tk.END)
            self.preview_text.insert("1.0", final_prompt)
            self.preview_text.configure(state=tk.DISABLED)
        except Exception:
            pass
        try:
            import json
            ir_dict = {"segments": [{"dim": s.dimension_key, "text": s.text, "weight": s.weight} for s in ir.segments], "warnings": warnings}
            self.ir_text.configure(state=tk.NORMAL)
            self.ir_text.delete("1.0", tk.END)
            self.ir_text.insert("1.0", json.dumps(ir_dict, indent=2, ensure_ascii=False))
            self.ir_text.configure(state=tk.DISABLED)
        except Exception:
            pass
        if warnings:
            try:
                self.warning_label.configure(text="⚠ " + " | ".join(warnings))
            except Exception:
                pass
        else:
            try:
                self.warning_label.configure(text="无冲突")
            except Exception:
                pass
