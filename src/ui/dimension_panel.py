"""
左栏：维度/条目管理面板（P02：实时搜索 + NSFW 筛选 + 290px 列宽 + Tooltip）。
"""
from __future__ import annotations
import tkinter as tk
from tkinter import ttk, messagebox, simpledialog
import logging
from typing import Callable, Optional

from engine.models import Dimension, Module
from db.repository import DimensionRepository, ModuleRepository
from ui.styles import TOKENS_LIGHT

log = logging.getLogger(__name__)


class DimensionPanel(ttk.Frame):
    """左栏面板：维度树 + 搜索 + 新建。"""

    def __init__(self, parent, on_module_selected: Callable, repos: dict):
        super().__init__(parent)
        self.on_module_selected = on_module_selected
        self.module_repo: ModuleRepository = repos["module"]
        self.dimension_repo: DimensionRepository = repos["dimension"]
        self._module_cache: dict[str, Module] = {}
        self._nsfw_only: bool = False
        self._search_after: str | None = None
        self._build_ui()
        self._load_data()

    def _build_ui(self):
        # 搜索区
        search_frame = ttk.Frame(self)
        search_frame.pack(fill=tk.X, padx=4, pady=4)
        self.search_var = tk.StringVar()
        self.search_var.trace_add("write", self._on_search_live)
        entry = ttk.Entry(search_frame, textvariable=self.search_var)
        entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        self._search_entry = entry
        entry.bind("<Return>", lambda e: self._on_search())
        ttk.Button(search_frame, text="搜索", command=self._on_search).pack(
            side=tk.RIGHT, padx=(4, 0)
        )

        # 筛选 pill 行
        pill_frame = ttk.Frame(self)
        pill_frame.pack(fill=tk.X, padx=4, pady=(0, 4))
        self.nsfw_btn = ttk.Button(pill_frame, text="NSFW 筛选: 全部", width=14, command=self._toggle_nsfw_filter)
        self.nsfw_btn.pack(side=tk.LEFT, padx=2)
        ttk.Button(pill_frame, text="清空搜索", width=10, command=self._clear_search).pack(side=tk.LEFT, padx=4)

        # Treeview
        tree_frame = ttk.Frame(self)
        tree_frame.pack(fill=tk.BOTH, expand=True, padx=4, pady=2)
        self.tree = ttk.Treeview(
            tree_frame,
            columns=("weight", "nsfw", "status"),
            show="tree headings",
        )
        self.tree.column("#0", width=290)
        self.tree.column("weight", width=55, anchor=tk.CENTER)
        self.tree.column("nsfw", width=45, anchor=tk.CENTER)
        self.tree.column("status", width=55, anchor=tk.CENTER)
        self.tree.heading("#0", text="维度 / 条目")
        self.tree.heading("weight", text="权重")
        self.tree.heading("nsfw", text="NSFW")
        self.tree.heading("status", text="状态")
        try:
            self.tree.tag_configure("nsfw", foreground=TOKENS_LIGHT["nsfw"], font=("Microsoft YaHei UI", 9, "bold"))
        except Exception:
            pass

        ysb = ttk.Scrollbar(tree_frame, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=ysb.set)
        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        ysb.pack(side=tk.RIGHT, fill=tk.Y)

        self.tree.bind("<Double-1>", self._on_double_click)
        self.tree.bind("<Button-3>", self._on_right_click)

        bottom = ttk.Frame(self)
        bottom.pack(fill=tk.X, padx=4, pady=4)
        ttk.Button(bottom, text="+ 新建条目", command=self._on_add).pack(side=tk.LEFT)
        ttk.Button(bottom, text="刷新", command=self._load_data).pack(side=tk.RIGHT)

        self._context_menu = tk.Menu(self, tearoff=0)
        self._context_menu.add_command(label="编辑", command=self._on_edit)
        self._context_menu.add_command(label="删除", command=self._on_delete)
        self._context_menu.add_separator()
        self._context_menu.add_command(label="启用/禁用切换", command=self._on_toggle_enabled)

    def focus_search(self):
        try:
            self._search_entry.focus_set()
            self._search_entry.select_range(0, tk.END)
        except Exception:
            pass

    def _toggle_nsfw_filter(self):
        self._nsfw_only = not self._nsfw_only
        self.nsfw_btn.configure(text="NSFW 筛选: 仅NSFW" if self._nsfw_only else "NSFW 筛选: 全部")
        self._on_search()

    def _on_search_live(self, *_args):
        # 防抖 250ms
        if self._search_after:
            try:
                self.after_cancel(self._search_after)
            except Exception:
                pass
        self._search_after = self.after(250, self._on_search)

    def _clear_search(self):
        self.search_var.set("")
        self._nsfw_only = False
        self.nsfw_btn.configure(text="NSFW 筛选: 全部")
        self._load_data()

    def _load_data(self):
        for item in self.tree.get_children():
            self.tree.delete(item)
        self._module_cache.clear()
        dimensions = self.dimension_repo.get_all()
        _pinned = {"gender", "ethnicity", "height"}
        for dim in dimensions:
            dim_node = self.tree.insert(
                "", tk.END,
                iid=f"dim_{dim.key}",
                text=f"{dim.name_cn} ({dim.name_en})",
                values=("", "", ""),
                open=(dim.key in _pinned),
            )
            modules = self.module_repo.get_by_dimension(dim.id)
            for mod in modules:
                if self._nsfw_only and not mod.is_nsfw:
                    continue
                status = "启用" if mod.is_enabled else "禁用"
                nsfw_mark = "√" if mod.is_nsfw else "×"
                tags = ("nsfw",) if mod.is_nsfw else ()
                self.tree.insert(
                    dim_node, tk.END,
                    iid=mod.id,
                    text=mod.display_name,
                    values=(f"{mod.weight:.1f}", nsfw_mark, status),
                    tags=tags,
                )
                self._module_cache[mod.id] = mod

    def _on_search(self):
        keyword = self.search_var.get().strip()
        if not keyword and not self._nsfw_only:
            self._load_data()
            return
        for item in self.tree.get_children():
            self.tree.delete(item)
        self._module_cache.clear()
        if keyword:
            results = self.module_repo.search(keyword)
        else:
            # 仅 NSFW 筛选：取全部再过滤
            results = []
            for dim in self.dimension_repo.get_all():
                results.extend(self.module_repo.get_by_dimension(dim.id))
        if self._nsfw_only:
            results = [m for m in results if m.is_nsfw]
        if not results:
            self.tree.insert("", tk.END, text="（无匹配）", open=True)
            return
        search_node = self.tree.insert(
            "", tk.END, iid="dim_search", text=f"搜索结果（{len(results)} 条）", open=True
        )
        for mod in results:
            status = "启用" if mod.is_enabled else "禁用"
            nsfw_mark = "√" if mod.is_nsfw else "×"
            tags = ("nsfw",) if mod.is_nsfw else ()
            self.tree.insert(
                search_node, tk.END,
                iid=mod.id,
                text=mod.display_name,
                values=(f"{mod.weight:.1f}", nsfw_mark, status),
                tags=tags,
            )
            self._module_cache[mod.id] = mod

    def _on_double_click(self, event):
        sel = self.tree.selection()
        if not sel:
            return
        item_id = sel[0]
        if item_id.startswith("dim_"):
            return
        module = self._find_module_by_id(item_id)
        if module and module.is_enabled:
            self.on_module_selected(module)
        elif module and not module.is_enabled:
            messagebox.showinfo("提示", "该条目已禁用，无法选中。")

    def _on_right_click(self, event):
        iid = self.tree.identify_row(event.y)
        if not iid:
            return
        if iid.startswith("dim_"):
            return
        self.tree.selection_set(iid)
        self.tree.focus(iid)
        self._context_menu.post(event.x_root, event.y_root)

    def _find_module_by_id(self, module_id: str) -> Optional[Module]:
        return self._module_cache.get(module_id)

    def _on_add(self):
        dims = self.dimension_repo.get_all()
        if not dims:
            messagebox.showerror("错误", "未找到维度数据，请先初始化。")
            return
        form = ModuleEditDialog(self, dims, title="新建条目")
        self.wait_window(form.top)
        if not form.result:
            return
        r = form.result
        try:
            self.module_repo.create(
                dimension_id=r["dimension_id"],
                content_en=r["content_en"],
                display_name=r["display_name"],
                weight=r["weight"],
                notes=r.get("notes"),
                is_nsfw=r.get("is_nsfw", False),
            )
            self._load_data()
            log.info(f"新建条目: {r['display_name']}")
        except Exception as e:
            log.error(f"新建条目失败: {e}")
            messagebox.showerror("错误", f"新建失败: {e}")

    def _on_edit(self):
        sel = self.tree.selection()
        if not sel or sel[0].startswith("dim_"):
            return
        mod = self._find_module_by_id(sel[0])
        if not mod:
            return
        dims = self.dimension_repo.get_all()
        form = ModuleEditDialog(self, dims, title="编辑条目", module=mod)
        self.wait_window(form.top)
        if not form.result:
            return
        r = form.result
        mod.content_en = r["content_en"]
        mod.display_name = r["display_name"]
        mod.weight = r["weight"]
        mod.notes = r.get("notes")
        mod.is_nsfw = r.get("is_nsfw", mod.is_nsfw)
        try:
            self.module_repo.update(mod)
            self._load_data()
            log.info(f"编辑条目: {mod.display_name}")
        except Exception as e:
            log.error(f"编辑条目失败: {e}")
            messagebox.showerror("错误", f"编辑失败: {e}")

    def _on_delete(self):
        sel = self.tree.selection()
        if not sel or sel[0].startswith("dim_"):
            return
        mod = self._find_module_by_id(sel[0])
        if not mod:
            return
        if not messagebox.askyesno("确认", f"确定删除条目「{mod.display_name}」吗？"):
            return
        try:
            self.module_repo.soft_delete(mod.id)
            self._load_data()
            log.info(f"删除条目: {mod.display_name}")
        except Exception as e:
            log.error(f"删除条目失败: {e}")
            messagebox.showerror("错误", f"删除失败: {e}")

    def _on_toggle_enabled(self):
        sel = self.tree.selection()
        if not sel or sel[0].startswith("dim_"):
            return
        mod = self._find_module_by_id(sel[0])
        if not mod:
            return
        mod.is_enabled = not mod.is_enabled
        try:
            self.module_repo.update(mod)
            self._load_data()
            log.info(f"切换条目状态: {mod.display_name} → {'启用' if mod.is_enabled else '禁用'}")
        except Exception as e:
            log.error(f"切换状态失败: {e}")
            messagebox.showerror("错误", f"操作失败: {e}")

    def reload(self):
        self._load_data()


class ModuleEditDialog:
    """条目编辑/新建表单（Toplevel 对话框）。"""

    def __init__(self, parent, dimensions: list[Dimension],
                 title: str = "编辑条目", module: Optional[Module] = None):
        self.top = tk.Toplevel(parent)
        self.top.title(title)
        self.top.transient(parent)
        self.top.grab_set()
        self.result: Optional[dict] = None
        self._build(dimensions, module)

    def _build(self, dimensions, module):
        f = ttk.Frame(self.top, padding=10)
        f.pack(fill=tk.BOTH, expand=True)

        ttk.Label(f, text="所属维度:").grid(row=0, column=0, sticky=tk.W, pady=2)
        dim_keys = [f"{d.name_cn} ({d.key})" for d in dimensions]
        self._dim_map = {f"{d.name_cn} ({d.key})": d.id for d in dimensions}
        self.dim_var = tk.StringVar()
        self.dim_combo = ttk.Combobox(f, textvariable=self.dim_var, values=dim_keys,
                                      state="readonly", width=28)
        self.dim_combo.grid(row=0, column=1, pady=2)
        if module:
            for d in dimensions:
                if d.id == module.dimension_id:
                    self.dim_var.set(f"{d.name_cn} ({d.key})")
                    break
        else:
            self.dim_var.set(dim_keys[0])

        ttk.Label(f, text="英文提示词:").grid(row=1, column=0, sticky=tk.W, pady=2)
        self.content_var = tk.StringVar(value=module.content_en if module else "")
        ttk.Entry(f, textvariable=self.content_var, width=40).grid(row=1, column=1, pady=2)

        ttk.Label(f, text="中文显示名:").grid(row=2, column=0, sticky=tk.W, pady=2)
        self.name_var = tk.StringVar(value=module.display_name if module else "")
        ttk.Entry(f, textvariable=self.name_var, width=40).grid(row=2, column=1, pady=2)

        ttk.Label(f, text="权重 (0.5~2.0):").grid(row=3, column=0, sticky=tk.W, pady=2)
        self.weight_var = tk.StringVar(value=f"{module.weight:.1f}" if module else "1.0")
        ttk.Entry(f, textvariable=self.weight_var, width=10).grid(row=3, column=1, sticky=tk.W, pady=2)

        self.nsfw_var = tk.BooleanVar(value=bool(module.is_nsfw) if module else False)
        ttk.Checkbutton(f, text="NSFW（私密）", variable=self.nsfw_var).grid(row=4, column=0, columnspan=2, sticky=tk.W, pady=2)

        ttk.Label(f, text="备注:").grid(row=5, column=0, sticky=tk.W, pady=2)
        self.notes_var = tk.StringVar(value=module.notes or "" if module else "")
        ttk.Entry(f, textvariable=self.notes_var, width=40).grid(row=5, column=1, pady=2)

        btn_frame = ttk.Frame(f)
        btn_frame.grid(row=6, column=0, columnspan=2, pady=10)
        ttk.Button(btn_frame, text="确定", command=self._on_ok).pack(side=tk.LEFT, padx=8)
        ttk.Button(btn_frame, text="取消", command=self._on_cancel).pack(side=tk.LEFT, padx=8)

        self.top.protocol("WM_DELETE_WINDOW", self._on_cancel)

    def _on_ok(self):
        try:
            weight = float(self.weight_var.get())
            weight = max(0.5, min(2.0, weight))
        except ValueError:
            messagebox.showerror("错误", "权重必须为数字")
            return
        dim_label = self.dim_var.get()
        if not dim_label or dim_label not in self._dim_map:
            messagebox.showerror("错误", "请选择所属维度")
            return
        self.result = {
            "dimension_id": self._dim_map[dim_label],
            "content_en": self.content_var.get().strip(),
            "display_name": self.name_var.get().strip(),
            "weight": weight,
            "notes": self.notes_var.get().strip() or None,
            "is_nsfw": bool(self.nsfw_var.get()),
        }
        self.top.destroy()

    def _on_cancel(self):
        self.result = None
        self.top.destroy()
