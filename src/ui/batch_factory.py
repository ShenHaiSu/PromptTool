"""批量工厂 BatchFactory — 从 PreviewPanel 剥离。"""
from __future__ import annotations
import tkinter as tk
from tkinter import ttk
from typing import Callable

from engine.models import PromptIR, AssemblyConfig
from engine.adapters import adapt_to_model
from ui.batch_cards import ScrollableFrame, BatchCard
from ui.tooltip import Tooltip


class BatchFactory(ttk.Frame):
    def __init__(self, parent, on_random: Callable, on_export: Callable,
                 mono_font: tuple = ("Consolas", 11),
                 assembly_config_getter: Callable[[], AssemblyConfig] | None = None,
                 on_batch_favorite=None, on_batch_restore=None):
        super().__init__(parent)
        self.on_random = on_random
        self.on_export = on_export
        self._mono_font = mono_font
        self._assembly_config_getter = assembly_config_getter
        self.on_batch_favorite = on_batch_favorite
        self.on_batch_restore = on_batch_restore
        self._batch_results: list[PromptIR] = []
        self._batch_final_prompts: list[str] = []
        self._cards: list[BatchCard] = []
        self._displayed_count: int = 0
        self._page_size: int = 50
        self._build_ui()

    def set_batch_callbacks(self, on_favorite=None, on_restore=None):
        if on_favorite is not None:
            self.on_batch_favorite = on_favorite
        if on_restore is not None:
            self.on_batch_restore = on_restore

    def _build_ui(self):
        # 批量工厂标题
        title = ttk.Frame(self)
        title.pack(fill=tk.X, padx=4, pady=(4, 2))
        ttk.Label(title, text="批量工厂", font=("Microsoft YaHei UI", 10, "bold")).pack(side=tk.LEFT)

        ctrl = ttk.Frame(self)
        ctrl.pack(fill=tk.X, padx=4, pady=4)
        ttk.Label(ctrl, text="数量:").pack(side=tk.LEFT)
        self.batch_count_var = tk.IntVar(value=10)
        ttk.Spinbox(ctrl, from_=1, to=500, width=5, textvariable=self.batch_count_var).pack(side=tk.LEFT, padx=4)
        ttk.Button(ctrl, text="随机生成", command=self._on_random_click).pack(side=tk.LEFT, padx=4)
        self.nsfw_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(ctrl, text="含 NSFW", variable=self.nsfw_var).pack(side=tk.LEFT, padx=4)
        self.partial_var = tk.BooleanVar(value=True)
        cb = ttk.Checkbutton(ctrl, text="可控部分随机", variable=self.partial_var)
        cb.pack(side=tk.LEFT, padx=4)
        Tooltip(cb, "以中栏已选为锚点，仅随机其余维度；未选锚点时退化为全随机")

        batch_action = ttk.Frame(self)
        batch_action.pack(fill=tk.X, padx=4, pady=(0, 4))
        ttk.Button(batch_action, text="复制全部", command=self._on_copy_all).pack(side=tk.LEFT, padx=2)
        ttk.Button(batch_action, text="清空", command=self.clear_batch).pack(side=tk.LEFT, padx=2)
        ttk.Button(batch_action, text="批量收藏", command=self._on_batch_favorite_all).pack(side=tk.LEFT, padx=2)
        ttk.Button(batch_action, text="导出 CSV", command=self._on_export_click).pack(side=tk.LEFT, padx=2)
        self.batch_count_label = ttk.Label(batch_action, text="0 条")
        self.batch_count_label.pack(side=tk.RIGHT, padx=4)

        # 空状态提示
        self.empty_label = ttk.Label(self, text="暂无批量结果 — 设置数量后点击随机生成", foreground="#64748B")
        self.empty_label.pack(pady=8)

        self.scroll_frame = ScrollableFrame(self)
        self.scroll_frame.pack(fill=tk.BOTH, expand=True, padx=4, pady=2)

        self.load_more_btn = ttk.Button(self, text="加载更多", command=self._load_more)
        # 兼容旧接口隐藏 batch_text
        self.batch_text = tk.Text(self, font=self._mono_font, wrap=tk.WORD, state=tk.DISABLED, height=1)

    def update_batch(self, results: list[PromptIR]):
        self._batch_results = list(results)
        self._batch_final_prompts = []
        config = None
        if self._assembly_config_getter:
            try:
                config = self._assembly_config_getter()
            except Exception:
                config = None
        for ir in self._batch_results:
            if config is not None:
                try:
                    prompt = adapt_to_model(ir, config.model_profile, config)
                except Exception:
                    prompt = ", ".join(s.text for s in ir.segments)
            else:
                prompt = ", ".join(s.text for s in ir.segments)
            self._batch_final_prompts.append(prompt)
        self._clear_cards()
        self._displayed_count = 0
        if not self._batch_results:
            self.batch_count_label.config(text="0 条")
            self._hide_load_more()
            self.empty_label.pack(pady=8)
            self.batch_text.config(state=tk.NORMAL)
            self.batch_text.delete("1.0", tk.END)
            self.batch_text.insert(tk.END, "（无结果）")
            self.batch_text.config(state=tk.DISABLED)
            return
        try:
            self.empty_label.pack_forget()
        except Exception:
            pass
        self.batch_count_label.config(text=f"{len(self._batch_results)} 条")
        self.batch_text.config(state=tk.NORMAL)
        self.batch_text.delete("1.0", tk.END)
        for i, prompt in enumerate(self._batch_final_prompts, 1):
            self.batch_text.insert(tk.END, f"--- #{i} ---\n{prompt}\n\n")
        self.batch_text.config(state=tk.DISABLED)
        self._render_next_page()

    def _clear_cards(self):
        for card in self._cards:
            try:
                card.destroy()
            except Exception:
                pass
        self._cards.clear()
        for child in list(self.scroll_frame.inner.winfo_children()):
            try:
                child.destroy()
            except Exception:
                pass

    def _render_next_page(self):
        total = len(self._batch_results)
        if self._displayed_count >= total:
            self._hide_load_more()
            return
        end = min(self._displayed_count + self._page_size, total)
        for idx in range(self._displayed_count, end):
            ir = self._batch_results[idx]
            prompt = self._batch_final_prompts[idx]
            card = BatchCard(
                self.scroll_frame.inner, index=idx + 1, ir=ir, final_prompt=prompt,
                on_copy=self._on_card_copy, on_favorite=self._on_card_favorite,
                on_restore=self._on_card_restore, on_view_ir=self._on_card_view_ir,
                mono_font=self._mono_font,
            )
            card.pack(fill=tk.X, padx=2, pady=2)
            self._cards.append(card)
        self._displayed_count = end
        if self._displayed_count < total:
            self._show_load_more()
        else:
            self._hide_load_more()
        if self._displayed_count == end and end <= self._page_size:
            try:
                self.scroll_frame.canvas.yview_moveto(0)
            except Exception:
                pass

    def _show_load_more(self):
        remaining = len(self._batch_results) - self._displayed_count
        self.load_more_btn.config(text=f"加载更多（剩余 {remaining} 条）")
        self.load_more_btn.pack(fill=tk.X, padx=4, pady=2)

    def _hide_load_more(self):
        try:
            self.load_more_btn.pack_forget()
        except Exception:
            pass

    def _load_more(self):
        self._hide_load_more()
        self._render_next_page()

    def clear_batch(self):
        self._batch_results.clear()
        self._batch_final_prompts.clear()
        self._clear_cards()
        self._displayed_count = 0
        self.batch_count_label.config(text="0 条")
        self._hide_load_more()
        self.empty_label.pack(pady=8)
        self.batch_text.config(state=tk.NORMAL)
        self.batch_text.delete("1.0", tk.END)
        self.batch_text.insert(tk.END, "（无结果）")
        self.batch_text.config(state=tk.DISABLED)

    def get_batch_results(self) -> list[PromptIR]:
        return self._batch_results

    def get_batch_final_prompts(self) -> list[str]:
        return list(self._batch_final_prompts)

    def _on_card_copy(self, text: str, index: int):
        try:
            self.clipboard_clear()
            self.clipboard_append(text)
            self._show_toast(f"已复制 #{index}")
        except Exception:
            pass

    def _on_card_favorite(self, ir: PromptIR, final_prompt: str):
        if self.on_batch_favorite:
            try:
                self.on_batch_favorite(ir, final_prompt)
            except Exception as e:
                self._show_toast(f"收藏失败: {e}")

    def _on_card_restore(self, ir: PromptIR):
        if self.on_batch_restore:
            try:
                self.on_batch_restore(ir)
            except Exception as e:
                self._show_toast(f"回填失败: {e}")

    def _on_card_view_ir(self, ir: PromptIR):
        import json
        win = tk.Toplevel(self)
        win.title(f"IR 详情 #{ir.hash()[:8]}")
        win.geometry("600x400")
        txt = tk.Text(win, font=self._mono_font, wrap=tk.WORD)
        txt.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)
        data = {"segments": [{"dim": s.dimension_key, "text": s.text, "weight": s.weight, "source": s.source_module_id} for s in ir.segments], "warnings": ir.warnings, "hash": ir.hash()}
        txt.insert("1.0", json.dumps(data, indent=2, ensure_ascii=False))
        txt.config(state=tk.DISABLED)
        ttk.Button(win, text="关闭", command=win.destroy).pack(pady=4)

    def _on_random_click(self):
        count = self.batch_count_var.get()
        if self.on_random:
            self.on_random(count, self.nsfw_var.get(), self.partial_var.get())

    def _on_export_click(self):
        if self.on_export:
            self.on_export()

    def _on_copy_all(self):
        if not self._batch_final_prompts:
            self._show_toast("暂无批量结果")
            return
        content = "\n\n".join(self._batch_final_prompts)
        try:
            self.clipboard_clear()
            self.clipboard_append(content)
            self._show_toast(f"已复制全部 {len(self._batch_final_prompts)} 条")
        except Exception:
            self._show_toast("复制失败")

    def _on_batch_favorite_all(self):
        if not self._batch_results:
            self._show_toast("暂无批量结果")
            return
        if not self.on_batch_favorite:
            self._show_toast("收藏功能未就绪")
            return
        count = 0
        for ir, prompt in zip(self._batch_results, self._batch_final_prompts):
            try:
                self.on_batch_favorite(ir, prompt)
                count += 1
            except Exception:
                pass
        self._show_toast(f"已批量收藏 {count} 条")

    def _show_toast(self, msg: str):
        # 优先冒泡到 MainWindow 的 toast 队列
        parent = self.winfo_toplevel()
        if hasattr(parent, "_show_toast"):
            try:
                parent._show_toast(msg)
                return
            except Exception:
                pass
        toast = ttk.Label(self, text=f"✓ {msg}", background="#4CAF50", foreground="white")
        try:
            toast.place(relx=0.5, rely=0.95, anchor=tk.CENTER)
            self.after(1500, toast.destroy)
        except Exception:
            pass

    # 兼容：update_preview 转发（旧测试可能调用）
    def update_preview(self, *args, **kwargs):
        pass
