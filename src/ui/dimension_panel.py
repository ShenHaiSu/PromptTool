"""
左栏：维度/条目管理面板。

Treeview 展示 14 维度及条目，支持双击选词、搜索、新建/编辑/删除/启禁用，NSFW 列 √/×。
"""
from __future__ import annotations
import tkinter as tk
from tkinter import ttk, messagebox, simpledialog
import logging
from typing import Callable, Optional

from engine.models import Dimension, Module
from db.repository import DimensionRepository, ModuleRepository

log = logging.getLogger(__name__)


class DimensionPanel(ttk.Frame):
    """左栏面板：维度树 + 搜索 + 新建。"""

    def __init__(self, parent, on_module_selected: Callable, repos: dict):
        super().__init__(parent)
        self.on_module_selected = on_module_selected  # 回调函数
        self.module_repo: ModuleRepository = repos["module"]
        self.dimension_repo: DimensionRepository = repos["dimension"]
        self._module_cache: dict[str, Module] = {}  # module_id → Module
        self._build_ui()
        self._load_data()

    def _build_ui(self):
        # 搜索区
        search_frame = ttk.Frame(self)
        search_frame.pack(fill=tk.X, padx=4, pady=4)
        self.search_var = tk.StringVar()
        entry = ttk.Entry(search_frame, textvariable=self.search_var)
        entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        entry.bind("<Return>", lambda e: self._on_search())
        ttk.Button(search_frame, text="搜索", command=self._on_search).pack(
            side=tk.RIGHT, padx=(4, 0)
        )

        # Treeview — 三列：权重 / NSFW / 状态
        tree_frame = ttk.Frame(self)
        tree_frame.pack(fill=tk.BOTH, expand=True, padx=4, pady=2)
        self.tree = ttk.Treeview(
            tree_frame,
            columns=("weight", "nsfw", "status"),
            show="tree headings",
        )
        self.tree.column("#0", width=260)
        self.tree.column("weight", width=55, anchor=tk.CENTER)
        self.tree.column("nsfw", width=45, anchor=tk.CENTER)
        self.tree.column("status", width=55, anchor=tk.CENTER)
        self.tree.heading("#0", text="维度 / 条目")
        self.tree.heading("weight", text="权重")
        self.tree.heading("nsfw", text="NSFW")
        self.tree.heading("status", text="状态")
        try:
            self.tree.tag_configure("nsfw", foreground="#D32F2F", font=("Microsoft YaHei UI", 9, "bold"))
        except Exception:
            pass

        # 滚动条
        ysb = ttk.Scrollbar(tree_frame, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=ysb.set)
        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        ysb.pack(side=tk.RIGHT, fill=tk.Y)

        self.tree.bind("<Double-1>", self._on_double_click)
        self.tree.bind("<Button-3>", self._on_right_click)

        # 底部按钮
        bottom = ttk.Frame(self)
        bottom.pack(fill=tk.X, padx=4, pady=4)
        ttk.Button(bottom, text="+ 新建条目", command=self._on_add).pack(side=tk.LEFT)
        ttk.Button(bottom, text="刷新", command=self._load_data).pack(side=tk.RIGHT)

        # 右键菜单
        self._context_menu = tk.Menu(self, tearoff=0)
        self._context_menu.add_command(label="编辑", command=self._on_edit)
        self._context_menu.add_command(label="删除", command=self._on_delete)
        self._context_menu.add_separator()
        self._context_menu.add_command(label="启用/禁用切换", command=self._on_toggle_enabled)

    def _load_data(self):
        """从数据库加载维度和条目，填充 Treeview。"""
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
        if not keyword:
            self._load_data()
            return
        # 搜索结果：展平显示，归到一个虚拟根节点
        for item in self.tree.get_children():
            self.tree.delete(item)
        self._module_cache.clear()
        results = self.module_repo.search(keyword)
        if not results:
            self.tree.insert("", tk.END, text="（无匹配结果）", open=True)
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
        """双击条目 → 回调 MainWindow。"""
        sel = self.tree.selection()
        if not sel:
            return
        item_id = sel[0]
        # 只响应条目节点（非维度节点）
        if item_id.startswith("dim_"):
            # 维度节点：展开/折叠切换
            return
        module = self._find_module_by_id(item_id)
        if module and module.is_enabled:
            self.on_module_selected(module)
        elif module and not module.is_enabled:
            messagebox.showinfo("提示", "该条目已禁用，无法选中。")

    def _on_right_click(self, event):
        """右键弹出上下文菜单。"""
        iid = self.tree.identify_row(event.y)
        if not iid:
            return
        # 只对条目节点弹出菜单
        if iid.startswith("dim_"):
            return
        self.tree.selection_set(iid)
        self.tree.focus(iid)
        self._context_menu.post(event.x_root, event.y_root)

    def _find_module_by_id(self, module_id: str) -> Optional[Module]:
        """从缓存中查找模块。"""
        return self._module_cache.get(module_id)

    def _on_add(self):
        """弹出新建条目表单。"""
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
        """编辑选中条目。"""
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
        """软删除选中条目。"""
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
        """切换启用/禁用状态。"""
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
        """供 MainWindow 调用的外部刷新接口。"""
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

        # 维度选择
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

        # 英文内容
        ttk.Label(f, text="英文提示词:").grid(row=1, column=0, sticky=tk.W, pady=2)
        self.content_var = tk.StringVar(value=module.content_en if module else "")
        ttk.Entry(f, textvariable=self.content_var, width=40).grid(row=1, column=1, pady=2)

        # 中文名
        ttk.Label(f, text="中文显示名:").grid(row=2, column=0, sticky=tk.W, pady=2)
        self.name_var = tk.StringVar(value=module.display_name if module else "")
        ttk.Entry(f, textvariable=self.name_var, width=40).grid(row=2, column=1, pady=2)

        # 权重
        ttk.Label(f, text="权重 (0.5~2.0):").grid(row=3, column=0, sticky=tk.W, pady=2)
        self.weight_var = tk.StringVar(value=f"{module.weight:.1f}" if module else "1.0")
        ttk.Entry(f, textvariable=self.weight_var, width=10).grid(row=3, column=1, sticky=tk.W, pady=2)

        # NSFW
        self.nsfw_var = tk.BooleanVar(value=bool(module.is_nsfw) if module else False)
        ttk.Checkbutton(f, text="NSFW（私密）", variable=self.nsfw_var).grid(row=4, column=0, columnspan=2, sticky=tk.W, pady=2)

        # 备注
        ttk.Label(f, text="备注:").grid(row=5, column=0, sticky=tk.W, pady=2)
        self.notes_var = tk.StringVar(value=module.notes or "" if module else "")
        ttk.Entry(f, textvariable=self.notes_var, width=40).grid(row=5, column=1, pady=2)

        # 按钮
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
