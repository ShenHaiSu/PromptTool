"""已选画布 AssemblyCanvas — 取代 Listbox 的 Chips 流。"""
from __future__ import annotations
import tkinter as tk
from tkinter import ttk, messagebox
from typing import Callable

from engine.models import SelectedItem, Module, AssemblyConfig
from ui.styles import DIM_COLORS, get_dim_colors


class AssemblyCanvas(ttk.Frame):
    def __init__(self, parent, on_changed: Callable[[list[SelectedItem], AssemblyConfig], None],
                 config: AssemblyConfig,
                 on_save: Callable[[bool], None] | None = None,
                 on_save_template: Callable | None = None):
        super().__init__(parent)
        self.on_changed = on_changed
        self.assembly_config = config
        self.on_save = on_save
        self.on_save_template = on_save_template
        self.selected_items: list[SelectedItem] = []
        self._drag_from: int | None = None
        self._build_ui()
        self._render_chips()

    def _build_ui(self):
        # 头部
        header = ttk.Frame(self)
        header.pack(fill=tk.X, padx=4, pady=4)
        self.count_label = ttk.Label(header, text="已选 0")
        self.count_label.pack(side=tk.LEFT)
        ttk.Button(header, text="清空", width=6, command=self._clear).pack(side=tk.RIGHT, padx=2)
        ttk.Button(header, text="… 设置", width=8, command=self._open_settings).pack(side=tk.RIGHT, padx=2)

        # 保存行
        save_frame = ttk.Frame(self)
        save_frame.pack(fill=tk.X, padx=4, pady=2)
        ttk.Button(save_frame, text="保存方案", command=lambda: self._on_save_click(False)).pack(side=tk.LEFT, padx=2)
        ttk.Button(save_frame, text="★ 收藏并保存", command=lambda: self._on_save_click(True)).pack(side=tk.LEFT, padx=2)
        ttk.Button(save_frame, text="另存为模板", command=self._on_save_template_click).pack(side=tk.RIGHT, padx=2)

        # 滚动容器
        container = ttk.Frame(self)
        container.pack(fill=tk.BOTH, expand=True, padx=4, pady=4)
        self.canvas = tk.Canvas(container, highlightthickness=0, bg="#F8FAFC")
        ysb = ttk.Scrollbar(container, orient=tk.VERTICAL, command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=ysb.set)
        self.canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        ysb.pack(side=tk.RIGHT, fill=tk.Y)
        self.inner = ttk.Frame(self.canvas)
        self._win = self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.inner.bind("<Configure>", lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfig(self._win, width=e.width))
        # 仅 canvas 滚轮，不劫持全局
        self.canvas.bind("<MouseWheel>", self._on_mousewheel)
        self.inner.bind("<MouseWheel>", self._on_mousewheel)

        # 空状态容器（在 inner 内居中）
        self.empty_frame = ttk.Frame(self.inner)
        # 不 pack，空时才显示

        # 拖拽 ghost
        self._ghost: tk.Toplevel | None = None

    def _on_mousewheel(self, event):
        try:
            self.canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
        except Exception:
            pass

    # ---- 兼容 API ----
    def add_module(self, module: Module):
        self.selected_items.append(SelectedItem(module=module))
        self._render_chips()
        self._notify_changed()

    def set_items(self, items: list[SelectedItem]):
        self.selected_items = list(items)
        self._render_chips()
        self._notify_changed()

    def apply_config(self, config: AssemblyConfig):
        self.assembly_config.separator = config.separator
        self.assembly_config.use_weight_brackets = config.use_weight_brackets
        self.assembly_config.model_profile = config.model_profile
        self.assembly_config.sort_by = config.sort_by
        self._notify_changed()

    def get_items(self) -> list[SelectedItem]:
        return list(self.selected_items)

    def get_locked_module_ids(self) -> set[str]:
        return {it.module.id for it in self.selected_items if it.locked}

    def has_items(self) -> bool:
        return len(self.selected_items) > 0

    def delete_selected(self):
        # 无选中概念，忽略
        pass

    # ---- 渲染 ----
    def _render_chips(self):
        for child in list(self.inner.winfo_children()):
            try:
                child.destroy()
            except Exception:
                pass
        self.count_label.configure(text=f"已选 {len(self.selected_items)}")
        if not self.selected_items:
            self._show_empty()
            return
        for idx, item in enumerate(self.selected_items):
            self._create_chip(idx, item)

    def _show_empty(self):
        f = ttk.Frame(self.inner)
        f.pack(fill=tk.BOTH, expand=True, pady=40)
        ttk.Label(f, text="◈", font=("Microsoft YaHei UI", 24), foreground="#94A3B8").pack()
        ttk.Label(f, text="从左侧双击添加词条", foreground="#64748B").pack(pady=4)
        ttk.Button(f, text="试试随机生成", command=lambda: None).pack(pady=4)

    def _create_chip(self, idx: int, item: SelectedItem):
        dim_key = item.module.dimension_key or ""
        bg = DIM_COLORS.get(dim_key, "#F1F5F9")
        row = tk.Frame(self.inner, bg="#FFFFFF", highlightbackground="#E2E8F0", highlightthickness=1, bd=0)
        row.pack(fill=tk.X, padx=4, pady=3)

        # 拖拽手柄
        handle = tk.Label(row, text="⠿", bg="#FFFFFF", fg="#94A3B8", font=("Microsoft YaHei UI", 10))
        handle.pack(side=tk.LEFT, padx=(6, 4), pady=6)
        # 拖拽绑定
        handle.bind("<Button-1>", lambda e, i=idx: self._on_drag_start(i))
        handle.bind("<B1-Motion>", self._on_drag_motion)
        handle.bind("<ButtonRelease-1>", lambda e, i=idx: self._on_drop(e, i))
        row.bind("<Button-1>", lambda e, i=idx: self._on_drag_start(i))
        row.bind("<ButtonRelease-1>", lambda e, i=idx: self._on_drop(e, i))

        # dim pill
        pill = tk.Label(row, text=dim_key or "—", bg=bg, fg="#334155", font=("Microsoft YaHei UI", 8), padx=6, pady=1)
        pill.pack(side=tk.LEFT, padx=4)

        # 名称
        name = item.module.display_name
        ttk.Label(row, text=name, font=("Microsoft YaHei UI", 10)).pack(side=tk.LEFT, padx=4)

        # 权重（可点击改）
        w = item.weight_override if item.weight_override is not None else item.module.weight
        w_label = tk.Label(row, text=f"w{w:.1f}", bg="#FFFFFF", fg="#3B82F6", font=("Microsoft YaHei UI", 9, "underline"), cursor="hand2")
        w_label.pack(side=tk.LEFT, padx=6)
        w_label.bind("<Button-1>", lambda e, i=idx: self._on_chip_weight_click(i))

        # 右侧：锁定 / 删除
        del_btn = ttk.Button(row, text="✕", width=3, command=lambda i=idx: self._on_delete(i))
        del_btn.pack(side=tk.RIGHT, padx=4)
        lock_text = "🔒" if item.locked else "🔓"
        lock_btn = ttk.Button(row, text=lock_text, width=3, command=lambda i=idx: self._on_toggle_lock(i))
        lock_btn.pack(side=tk.RIGHT, padx=2)

    # ---- 交互 ----
    def _on_drag_start(self, idx: int):
        self._drag_from = idx

    def _on_drag_motion(self, event):
        pass

    def _on_drop(self, event, idx: int):
        if self._drag_from is None:
            return
        # 根据鼠标 y 坐标计算目标索引
        try:
            y = event.y_root - self.inner.winfo_rooty()
            # 估算每行 ~44px
            target = max(0, min(len(self.selected_items) - 1, int(y / 44)))
        except Exception:
            target = idx
        frm = self._drag_from
        self._drag_from = None
        if frm == target:
            return
        item = self.selected_items.pop(frm)
        self.selected_items.insert(target, item)
        self._render_chips()
        self._notify_changed()

    def _on_chip_weight_click(self, idx: int):
        item = self.selected_items[idx]
        cur = item.weight_override if item.weight_override is not None else item.module.weight

        top = tk.Toplevel(self)
        top.title("权重")
        top.transient(self.winfo_toplevel())
        top.grab_set()
        ttk.Label(top, text=f"{item.module.display_name} 权重 (0.5~2.0):").pack(padx=10, pady=(10, 4))
        var = tk.DoubleVar(value=cur)
        spin = ttk.Spinbox(top, from_=0.5, to=2.0, increment=0.1, textvariable=var, width=8)
        spin.pack(padx=10, pady=4)
        spin.focus_set()

        def _confirm():
            try:
                v = float(var.get())
                v = max(0.5, min(2.0, round(v, 1)))
            except Exception:
                return
            item.weight_override = v if v != 1.0 else None
            # 若为 1.0 且原权重即 1.0 则置 None，否则保留
            if v == item.module.weight:
                item.weight_override = None
            else:
                item.weight_override = v
            top.destroy()
            self._render_chips()
            self._notify_changed()

        btn = ttk.Frame(top)
        btn.pack(pady=8)
        ttk.Button(btn, text="确定", command=_confirm).pack(side=tk.LEFT, padx=6)
        ttk.Button(btn, text="取消", command=top.destroy).pack(side=tk.LEFT, padx=6)
        top.bind("<Return>", lambda e: _confirm())
        spin.bind("<Return>", lambda e: _confirm())

    def _on_toggle_lock(self, idx: int):
        self.selected_items[idx].locked = not self.selected_items[idx].locked
        self._render_chips()
        self._notify_changed()

    def _on_delete(self, idx: int):
        del self.selected_items[idx]
        self._render_chips()
        self._notify_changed()

    def _clear(self):
        if not self.selected_items:
            return
        self.selected_items.clear()
        self._render_chips()
        self._notify_changed()

    def _on_save_click(self, is_favorite: bool):
        if self.on_save:
            self.on_save(is_favorite)

    def _on_save_template_click(self):
        if self.on_save_template:
            self.on_save_template()

    def _open_settings(self):
        top = tk.Toplevel(self)
        top.title("拼装设置")
        top.transient(self.winfo_toplevel())
        top.grab_set()
        f = ttk.Frame(top, padding=12)
        f.pack(fill=tk.BOTH, expand=True)

        ttk.Label(f, text="分隔符:").grid(row=0, column=0, sticky=tk.W, pady=4)
        sep_var = tk.StringVar(value=self.assembly_config.separator)
        ttk.Combobox(f, textvariable=sep_var, values=[", ", " BREAK ", "\n"], state="readonly", width=14).grid(row=0, column=1, pady=4, padx=8)

        bracket_var = tk.BooleanVar(value=self.assembly_config.use_weight_brackets)
        ttk.Checkbutton(f, text="权重括号", variable=bracket_var).grid(row=1, column=0, columnspan=2, sticky=tk.W, pady=4)

        ttk.Label(f, text="排序:").grid(row=2, column=0, sticky=tk.W, pady=4)
        sort_map = {"维度顺序": "dimensionOrder", "自定义拖拽": "customDragOrder"}
        rev_map = {v: k for k, v in sort_map.items()}
        sort_var = tk.StringVar(value=rev_map.get(self.assembly_config.sort_by, "维度顺序"))
        ttk.Combobox(f, textvariable=sort_var, values=list(sort_map.keys()), state="readonly", width=14).grid(row=2, column=1, pady=4, padx=8)

        ttk.Label(f, text=f"模型: {self.assembly_config.model_profile} (只读)").grid(row=3, column=0, columnspan=2, sticky=tk.W, pady=4)

        def _apply():
            self.assembly_config.separator = sep_var.get()
            self.assembly_config.use_weight_brackets = bool(bracket_var.get())
            self.assembly_config.sort_by = sort_map.get(sort_var.get(), "dimensionOrder")
            top.destroy()
            self._notify_changed()

        btn = ttk.Frame(f)
        btn.grid(row=4, column=0, columnspan=2, pady=10)
        ttk.Button(btn, text="应用", command=_apply).pack(side=tk.LEFT, padx=8)
        ttk.Button(btn, text="取消", command=top.destroy).pack(side=tk.LEFT, padx=8)

    def _notify_changed(self):
        self.on_changed(self.selected_items, self.assembly_config)
