"""
历史/收藏/模板 面板：右栏可切换的持久化资产视图。

提供：
- Notebook：历史 / 收藏 / 模板 三 Tab
- 搜索框 + Treeview + 双击回填 + 右键菜单（收藏/重命名/删除）
- 对外 refresh() / on_restore / on_template_apply 回调
"""
from __future__ import annotations
import time
import tkinter as tk
from tkinter import ttk, messagebox, simpledialog
from typing import Callable

from db.repository import AssemblyRepository, TemplateRepository
from engine.models import Assembly, Template


def _fmt_time(ts: int) -> str:
    try:
        return time.strftime("%m-%d %H:%M", time.localtime(ts))
    except Exception:
        return str(ts)


class HistoryPanel(ttk.Frame):
    """历史/收藏/模板 组合面板（置于右栏预览区下方）。"""

    def __init__(
        self,
        parent,
        assembly_repo: AssemblyRepository,
        template_repo: TemplateRepository,
        on_restore: Callable[[str], None] | None = None,
        on_template_apply: Callable[[str], None] | None = None,
    ):
        super().__init__(parent)
        self.assembly_repo = assembly_repo
        self.template_repo = template_repo
        self.on_restore = on_restore
        self.on_template_apply = on_template_apply
        self._build_ui()
        self.refresh()

    def _build_ui(self):
        # 顶部标题 + 刷新
        header = ttk.Frame(self)
        header.pack(fill=tk.X, padx=4, pady=(4, 2))
        ttk.Label(header, text="历史 · 收藏 · 模板", font=("Microsoft YaHei UI", 10, "bold")).pack(side=tk.LEFT)
        ttk.Button(header, text="刷新", width=6, command=self.refresh).pack(side=tk.RIGHT, padx=2)

        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=4, pady=2)

        # Tab1: 历史
        self.tab_history = ttk.Frame(self.notebook)
        self.notebook.add(self.tab_history, text="历史")
        self._build_history_tab(self.tab_history, favorites_only=False)

        # Tab2: 收藏
        self.tab_fav = ttk.Frame(self.notebook)
        self.notebook.add(self.tab_fav, text="收藏 ★")
        self._build_history_tab(self.tab_fav, favorites_only=True)

        # Tab3: 模板
        self.tab_template = ttk.Frame(self.notebook)
        self.notebook.add(self.tab_template, text="模板")
        self._build_template_tab(self.tab_template)

    # ---- 历史/收藏 Tab ----

    def _build_history_tab(self, parent: ttk.Frame, favorites_only: bool):
        # 搜索
        search_frame = ttk.Frame(parent)
        search_frame.pack(fill=tk.X, padx=4, pady=4)
        var = tk.StringVar()
        entry = ttk.Entry(search_frame, textvariable=var)
        entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        entry.bind("<Return>", lambda e: self._do_search(var.get(), favorites_only))
        ttk.Button(search_frame, text="搜索", width=6,
                   command=lambda: self._do_search(var.get(), favorites_only)).pack(side=tk.LEFT, padx=4)
        ttk.Button(search_frame, text="清空搜索", width=8,
                   command=lambda: self._clear_search(var, favorites_only)).pack(side=tk.LEFT, padx=2)

        if favorites_only:
            self.fav_search_var = var
        else:
            self.history_search_var = var

        # Treeview：时间 | 标题 | 预览 | ★（P02：fill 自适应，空状态）
        columns = ("time", "title", "preview", "fav")
        tree = ttk.Treeview(parent, columns=columns, show="headings")
        tree.heading("time", text="时间")
        tree.heading("title", text="标题")
        tree.heading("preview", text="预览")
        tree.heading("fav", text="★")
        tree.column("time", width=110, anchor=tk.CENTER)
        tree.column("title", width=160)
        tree.column("preview", width=170)
        tree.column("fav", width=30, anchor=tk.CENTER)
        ysb = ttk.Scrollbar(parent, orient=tk.VERTICAL, command=tree.yview)
        tree.configure(yscrollcommand=ysb.set)
        tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(4, 0), pady=4)
        ysb.pack(side=tk.RIGHT, fill=tk.Y, pady=4)

        tree.bind("<Double-1>", lambda e: self._on_history_double(e, tree))
        tree.bind("<Button-3>", lambda e: self._on_history_right_click(e, tree, favorites_only))

        if favorites_only:
            self.fav_tree = tree
        else:
            self.history_tree = tree

        # 右键菜单
        menu = tk.Menu(parent, tearoff=0)
        menu.add_command(label="回填到中栏", command=lambda: self._menu_restore(tree))
        menu.add_command(label="收藏/取消收藏", command=lambda: self._menu_toggle_fav(tree))
        menu.add_command(label="重命名", command=lambda: self._menu_rename(tree))
        menu.add_command(label="删除", command=lambda: self._menu_delete(tree))
        if favorites_only:
            self.fav_menu = menu
        else:
            self.history_menu = menu

    def _build_template_tab(self, parent: ttk.Frame):
        top = ttk.Frame(parent)
        top.pack(fill=tk.X, padx=4, pady=4)
        ttk.Button(top, text="+ 新建模板", command=self._on_new_template).pack(side=tk.LEFT, padx=2)
        ttk.Button(top, text="刷新", width=6, command=self.refresh_templates).pack(side=tk.RIGHT, padx=2)

        columns = ("name", "desc", "time")
        tree = ttk.Treeview(parent, columns=columns, show="headings")
        tree.heading("name", text="名称")
        tree.heading("desc", text="描述")
        tree.heading("time", text="创建时间")
        tree.column("name", width=140)
        tree.column("desc", width=180)
        tree.column("time", width=110, anchor=tk.CENTER)
        ysb = ttk.Scrollbar(parent, orient=tk.VERTICAL, command=tree.yview)
        tree.configure(yscrollcommand=ysb.set)
        tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(4, 0), pady=4)
        ysb.pack(side=tk.RIGHT, fill=tk.Y, pady=4)

        tree.bind("<Double-1>", lambda e: self._on_template_double(e))
        tree.bind("<Button-3>", lambda e: self._on_template_right_click(e))

        self.template_tree = tree
        self.template_menu = tk.Menu(parent, tearoff=0)
        self.template_menu.add_command(label="应用模板", command=lambda: self._menu_template_apply())
        self.template_menu.add_command(label="重命名", command=lambda: self._menu_template_rename())
        self.template_menu.add_command(label="删除", command=lambda: self._menu_template_delete())

    # ---- 刷新 ----

    def refresh(self):
        self.refresh_history()
        self.refresh_favorites()
        self.refresh_templates()

    def refresh_history(self, keyword: str | None = None):
        try:
            if keyword:
                items = self.assembly_repo.search(keyword, limit=50)
                # 搜索结果仍按时间倒序（已是）
            else:
                items = self.assembly_repo.list_recent(limit=50)
            self._fill_history_tree(self.history_tree, items)
        except Exception:
            pass

    def refresh_favorites(self, keyword: str | None = None):
        try:
            if keyword:
                items = [a for a in self.assembly_repo.search(keyword, limit=100) if a.is_favorite]
            else:
                items = self.assembly_repo.list_favorites(limit=100)
            self._fill_history_tree(self.fav_tree, items)
        except Exception:
            pass

    def refresh_templates(self):
        try:
            items = self.template_repo.list_all()
            self._fill_template_tree(items)
        except Exception:
            pass

    def _fill_history_tree(self, tree: ttk.Treeview, items: list[Assembly]):
        for iid in tree.get_children():
            tree.delete(iid)
        if not items:
            # 空状态占位
            tree.insert("", tk.END, iid="_empty", values=("", "暂无数据", "", ""))
            return
        for asm in items:
            preview = (asm.final_prompt or "")[:40]
            fav_mark = "★" if asm.is_favorite else ""
            tree.insert("", tk.END, iid=asm.id,
                        values=(_fmt_time(asm.created_at), asm.title or "(无标题)", preview, fav_mark))

    def _fill_template_tree(self, items: list[Template]):
        for iid in self.template_tree.get_children():
            self.template_tree.delete(iid)
        if not items:
            self.template_tree.insert("", tk.END, iid="_empty", values=("暂无模板", "", ""))
            return
        for t in items:
            self.template_tree.insert("", tk.END, iid=t.id,
                                      values=(t.name, (t.description or "")[:30], _fmt_time(t.created_at)))

    # ---- 搜索 ----

    def _do_search(self, keyword: str, favorites_only: bool):
        kw = keyword.strip()
        if not kw:
            if favorites_only:
                self.refresh_favorites()
            else:
                self.refresh_history()
            return
        if favorites_only:
            self.refresh_favorites(keyword=kw)
        else:
            self.refresh_history(keyword=kw)

    def _clear_search(self, var: tk.StringVar, favorites_only: bool):
        var.set("")
        if favorites_only:
            self.refresh_favorites()
        else:
            self.refresh_history()

    # ---- 交互 ----

    def _on_history_double(self, event, tree: ttk.Treeview):
        iid = tree.identify_row(event.y)
        if not iid:
            sel = tree.selection()
            iid = sel[0] if sel else None
        if iid and self.on_restore:
            self.on_restore(iid)

    def _on_history_right_click(self, event, tree: ttk.Treeview, favorites_only: bool):
        iid = tree.identify_row(event.y)
        if not iid:
            return
        tree.selection_set(iid)
        tree.focus(iid)
        menu = self.fav_menu if favorites_only else self.history_menu
        menu.post(event.x_root, event.y_root)

    def _menu_restore(self, tree: ttk.Treeview):
        sel = tree.selection()
        if sel and self.on_restore:
            self.on_restore(sel[0])

    def _menu_toggle_fav(self, tree: ttk.Treeview):
        sel = tree.selection()
        if not sel:
            return
        try:
            self.assembly_repo.toggle_favorite(sel[0])
            self.refresh()
        except Exception as e:
            messagebox.showerror("错误", f"操作失败: {e}")

    def _menu_rename(self, tree: ttk.Treeview):
        sel = tree.selection()
        if not sel:
            return
        asm = self.assembly_repo.get(sel[0])
        if not asm:
            return
        new_name = simpledialog.askstring("重命名", "新标题:", initialvalue=asm.title or "")
        if new_name is None:
            return
        new_name = new_name.strip()
        if not new_name:
            messagebox.showerror("错误", "标题不能为空")
            return
        try:
            self.assembly_repo.rename(sel[0], new_name)
            self.refresh()
        except Exception as e:
            messagebox.showerror("错误", f"重命名失败: {e}")

    def _menu_delete(self, tree: ttk.Treeview):
        sel = tree.selection()
        if not sel:
            return
        if not messagebox.askyesno("确认", "确定删除该方案吗？（软删除）"):
            return
        try:
            self.assembly_repo.soft_delete(sel[0])
            self.refresh()
        except Exception as e:
            messagebox.showerror("错误", f"删除失败: {e}")

    # ---- 模板交互 ----

    def _on_template_double(self, event):
        iid = self.template_tree.identify_row(event.y)
        if not iid:
            sel = self.template_tree.selection()
            iid = sel[0] if sel else None
        if iid and self.on_template_apply:
            self.on_template_apply(iid)

    def _on_template_right_click(self, event):
        iid = self.template_tree.identify_row(event.y)
        if not iid:
            return
        self.template_tree.selection_set(iid)
        self.template_tree.focus(iid)
        self.template_menu.post(event.x_root, event.y_root)

    def _menu_template_apply(self):
        sel = self.template_tree.selection()
        if sel and self.on_template_apply:
            self.on_template_apply(sel[0])

    def _menu_template_rename(self):
        sel = self.template_tree.selection()
        if not sel:
            return
        t = self.template_repo.get(sel[0])
        if not t:
            return
        new_name = simpledialog.askstring("重命名模板", "新名称:", initialvalue=t.name)
        if new_name is None:
            return
        new_name = new_name.strip()
        if not new_name:
            messagebox.showerror("错误", "名称不能为空")
            return
        try:
            self.template_repo.rename(sel[0], new_name)
            self.refresh_templates()
        except Exception as e:
            messagebox.showerror("错误", f"重命名失败: {e}")

    def _menu_template_delete(self):
        sel = self.template_tree.selection()
        if not sel:
            return
        if not messagebox.askyesno("确认", "确定删除该模板吗？"):
            return
        try:
            self.template_repo.soft_delete(sel[0])
            self.refresh_templates()
        except Exception as e:
            messagebox.showerror("错误", f"删除失败: {e}")

    def _on_new_template(self):
        # 简单弹窗：名称/描述
        top = tk.Toplevel(self)
        top.title("新建模板")
        top.transient(self)
        top.grab_set()
        ttk.Label(top, text="模板名称:").pack(anchor=tk.W, padx=10, pady=(10, 2))
        name_var = tk.StringVar()
        ttk.Entry(top, textvariable=name_var, width=36).pack(padx=10, pady=2)
        ttk.Label(top, text="描述（可选）:").pack(anchor=tk.W, padx=10, pady=(10, 2))
        desc_var = tk.StringVar()
        ttk.Entry(top, textvariable=desc_var, width=36).pack(padx=10, pady=2)

        result: dict = {}

        def _ok():
            result["name"] = name_var.get().strip()
            result["desc"] = desc_var.get().strip() or None
            top.destroy()

        def _cancel():
            result.clear()
            top.destroy()

        btn = ttk.Frame(top)
        btn.pack(pady=10)
        ttk.Button(btn, text="确定", command=_ok).pack(side=tk.LEFT, padx=8)
        ttk.Button(btn, text="取消", command=_cancel).pack(side=tk.LEFT, padx=8)
        top.protocol("WM_DELETE_WINDOW", _cancel)
        self.wait_window(top)
        if not result.get("name"):
            if result:
                messagebox.showerror("错误", "模板名称不能为空")
            return
        # 触发回调由 MainWindow 接管：此处仅做事件转发，模板的 config 由 MainWindow 传入
        # 为保持解耦，这里直接通过外部回调创建；若未配置回调则提示
        if hasattr(self, "_on_create_template"):
            try:
                self._on_create_template(result["name"], result["desc"])
            except Exception as e:
                messagebox.showerror("错误", f"创建模板失败: {e}")
        else:
            messagebox.showinfo("提示", "模板创建已就绪，请通过中栏“另存为模板”操作。")

    def set_create_template_handler(self, handler: Callable[[str, str | None], None]):
        self._on_create_template = handler
