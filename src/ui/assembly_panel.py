"""
中栏：已选拼装面板。

展示已选条目，支持上移/下移、权重滑杆、锁定、删除、清空，
以及分隔符与权重括号开关。
"""
from __future__ import annotations
import tkinter as tk
from tkinter import ttk
from typing import Callable

from engine.models import SelectedItem, Module, AssemblyConfig


class AssemblyPanel(ttk.Frame):
    """中栏面板：已选拼装条目列表 + 控件。"""

    def __init__(
        self,
        parent,
        on_changed: Callable,
        config: AssemblyConfig,
        on_save: Callable[[bool], None] | None = None,
        on_save_template: Callable | None = None,
    ):
        super().__init__(parent)
        self.on_changed = on_changed    # 拼装变化回调
        self.assembly_config = config     # AssemblyConfig 引用
        self.on_save = on_save            # 保存回调 (is_favorite) -> None
        self.on_save_template = on_save_template
        self.selected_items: list[SelectedItem] = []
        self._build_ui()

    def _build_ui(self):
        # 头部
        header = ttk.Frame(self)
        header.pack(fill=tk.X, padx=4, pady=4)
        self.count_label = ttk.Label(header, text="已选拼装 (0)")
        self.count_label.pack(side=tk.LEFT)

        # Listbox + 滚动条
        list_frame = ttk.Frame(self)
        list_frame.pack(fill=tk.BOTH, expand=True, padx=4, pady=2)
        self.listbox = tk.Listbox(list_frame, font=("Microsoft YaHei UI", 10),
                                   selectmode=tk.SINGLE, activestyle="dotbox")
        ysb = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=self.listbox.yview)
        self.listbox.configure(yscrollcommand=ysb.set)
        self.listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        ysb.pack(side=tk.RIGHT, fill=tk.Y)
        self.listbox.bind("<<ListboxSelect>>", self._on_select)

        # 控制按钮
        ctrl = ttk.Frame(self)
        ctrl.pack(fill=tk.X, padx=4, pady=4)
        ttk.Button(ctrl, text="↑ 上移", command=self._move_up).pack(side=tk.LEFT, padx=2)
        ttk.Button(ctrl, text="↓ 下移", command=self._move_down).pack(side=tk.LEFT, padx=2)
        ttk.Button(ctrl, text="删除", command=self._delete).pack(side=tk.LEFT, padx=2)
        ttk.Button(ctrl, text="锁定/解锁", command=self._toggle_lock).pack(side=tk.LEFT, padx=2)
        ttk.Button(ctrl, text="清空全部", command=self._clear).pack(side=tk.RIGHT, padx=2)

        # 权重滑杆
        weight_frame = ttk.Frame(self)
        weight_frame.pack(fill=tk.X, padx=4, pady=4)
        ttk.Label(weight_frame, text="权重:").pack(side=tk.LEFT)
        self.weight_val_label = ttk.Label(weight_frame, text="1.0", width=4)
        self.weight_val_label.pack(side=tk.LEFT, padx=4)
        self.weight_scale = ttk.Scale(
            weight_frame, from_=0.5, to=2.0, orient=tk.HORIZONTAL,
            command=self._on_weight_change
        )
        self.weight_scale.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=4)
        self.weight_scale.set(1.0)

        # 分隔符 + 括号开关
        sep_frame = ttk.Frame(self)
        sep_frame.pack(fill=tk.X, padx=4, pady=4)
        ttk.Label(sep_frame, text="分隔符:").pack(side=tk.LEFT)
        self.sep_var = tk.StringVar(value=", ")
        sep_combo = ttk.Combobox(
            sep_frame, textvariable=self.sep_var, values=[", ", " BREAK ", "\n"],
            state="readonly", width=10
        )
        sep_combo.pack(side=tk.LEFT, padx=4)
        sep_combo.bind("<<ComboboxSelected>>", lambda e: self._on_config_change())

        self.bracket_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            sep_frame, text="权重括号", variable=self.bracket_var,
            command=self._on_config_change
        ).pack(side=tk.LEFT, padx=8)

        # 排序方式
        ttk.Label(sep_frame, text="排序:").pack(side=tk.LEFT, padx=(8, 0))
        self.sort_var = tk.StringVar(value="dimensionOrder")
        sort_combo = ttk.Combobox(
            sep_frame, textvariable=self.sort_var,
            values=["dimensionOrder", "customDragOrder"],
            state="readonly", width=14
        )
        sort_combo.pack(side=tk.LEFT, padx=4)
        sort_combo.bind("<<ComboboxSelected>>", lambda e: self._on_config_change())

        # 保存/收藏/模板 行（P0-01）
        save_frame = ttk.Frame(self)
        save_frame.pack(fill=tk.X, padx=4, pady=(8, 4))
        ttk.Button(save_frame, text="保存方案", command=lambda: self._on_save_click(False)).pack(side=tk.LEFT, padx=2)
        ttk.Button(save_frame, text="★ 收藏并保存", command=lambda: self._on_save_click(True)).pack(side=tk.LEFT, padx=2)
        ttk.Button(save_frame, text="另存为模板", command=self._on_save_template_click).pack(side=tk.RIGHT, padx=2)

    def _on_save_click(self, is_favorite: bool):
        if self.on_save:
            self.on_save(is_favorite)

    def _on_save_template_click(self):
        if self.on_save_template:
            self.on_save_template()

    # ---- P0-01 一键复用 API ----

    def get_items(self) -> list[SelectedItem]:
        return list(self.selected_items)

    def set_items(self, items: list[SelectedItem]):
        """清空后批量回填（历史一键复用），并触发拼装刷新。"""
        self.selected_items = list(items)
        self._refresh_listbox()
        self._notify_changed()

    def apply_config(self, config: AssemblyConfig):
        """应用模板配置：回写控件并更新 assembly_config。"""
        self.assembly_config.separator = config.separator
        self.assembly_config.use_weight_brackets = config.use_weight_brackets
        self.assembly_config.model_profile = config.model_profile
        self.assembly_config.sort_by = config.sort_by
        # 同步控件
        self.sep_var.set(config.separator)
        self.bracket_var.set(config.use_weight_brackets)
        self.sort_var.set(config.sort_by)
        self._notify_changed()

    def add_module(self, module: Module):
        """从左栏添加条目到中栏。"""
        self.selected_items.append(SelectedItem(module=module))
        self._refresh_listbox()
        self._notify_changed()

    def _refresh_listbox(self):
        """刷新 Listbox 显示。"""
        self.listbox.delete(0, tk.END)
        for item in self.selected_items:
            dim = item.module.dimension_key or ""
            name = item.module.display_name
            w = item.weight_override if item.weight_override is not None else item.module.weight
            lock = " [L]" if item.locked else ""
            self.listbox.insert(tk.END, f"[{dim}] {name} (w:{w:.1f}){lock}")
        self.count_label.config(text=f"已选拼装 ({len(self.selected_items)})")

    def _on_select(self, event):
        """Listbox 选中项变化 → 更新 Scale 值。"""
        idx = self.listbox.curselection()
        if not idx:
            return
        item = self.selected_items[idx[0]]
        w = item.weight_override if item.weight_override is not None else item.module.weight
        self.weight_scale.set(w)
        self.weight_val_label.config(text=f"{w:.1f}")

    def _on_weight_change(self, value: str):
        """Scale 拖动 → 更新选中项权重。"""
        idx = self.listbox.curselection()
        if not idx:
            return
        w = round(float(value), 1)
        self.selected_items[idx[0]].weight_override = w
        self.weight_val_label.config(text=f"{w:.1f}")
        self._refresh_listbox()
        self.listbox.selection_set(idx[0])
        self._notify_changed()

    def _move_up(self):
        idx = self.listbox.curselection()
        if not idx or idx[0] == 0:
            return
        i = idx[0]
        self.selected_items[i], self.selected_items[i - 1] = \
            self.selected_items[i - 1], self.selected_items[i]
        self._refresh_listbox()
        self.listbox.selection_set(i - 1)
        self._notify_changed()

    def _move_down(self):
        idx = self.listbox.curselection()
        if not idx or idx[0] == len(self.selected_items) - 1:
            return
        i = idx[0]
        self.selected_items[i], self.selected_items[i + 1] = \
            self.selected_items[i + 1], self.selected_items[i]
        self._refresh_listbox()
        self.listbox.selection_set(i + 1)
        self._notify_changed()

    def _delete(self):
        idx = self.listbox.curselection()
        if not idx:
            return
        del self.selected_items[idx[0]]
        self._refresh_listbox()
        self._notify_changed()

    def _toggle_lock(self):
        idx = self.listbox.curselection()
        if not idx:
            return
        self.selected_items[idx[0]].locked = not self.selected_items[idx[0]].locked
        self._refresh_listbox()
        self.listbox.selection_set(idx[0])
        self._notify_changed()

    def _clear(self):
        self.selected_items.clear()
        self._refresh_listbox()
        self._notify_changed()

    def _on_config_change(self):
        """分隔符/括号/排序变化 → 更新 config 并通知。"""
        self.assembly_config.separator = self.sep_var.get()
        self.assembly_config.use_weight_brackets = self.bracket_var.get()
        self.assembly_config.sort_by = self.sort_var.get()
        self._notify_changed()

    def _notify_changed(self):
        """通知 MainWindow 重新拼装。"""
        self.on_changed(self.selected_items, self.assembly_config)

    def get_locked_module_ids(self) -> set[str]:
        """返回锁定条目的 module ID 集合。"""
        return {it.module.id for it in self.selected_items if it.locked}
