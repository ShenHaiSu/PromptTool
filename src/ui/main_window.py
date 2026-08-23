"""
主窗口：三栏布局与事件协调。

持有引擎和仓库引用，协调左/中/右三栏面板间的事件流转。
"""
from __future__ import annotations
import logging
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

from engine.models import SelectedItem, Module, AssemblyConfig
from engine.assembly import assemble
from engine.random_engine import random_assembly, partial_random_assembly
from db.connection import DatabaseConnection
from db.repository import DimensionRepository, ModuleRepository, RuleRepository
from ui.dimension_panel import DimensionPanel
from ui.assembly_panel import AssemblyPanel
from ui.preview_panel import PreviewPanel
from ui.styles import apply_style
from exporter import export_csv

log = logging.getLogger(__name__)


class MainWindow(tk.Tk):
    """主窗口：三栏 PanedWindow 布局 + 事件协调。"""

    def __init__(self, db_path: str, schema_path: str):
        super().__init__()
        self.title("Prompt Modular Factory — 正式版")
        self.geometry("1400x800")
        self.minsize(1000, 600)

        # 初始化数据库
        self.db = DatabaseConnection(db_path, schema_path)
        conn = self.db.get_connection()

        # 初始化仓库
        self.repos = {
            "dimension": DimensionRepository(conn),
            "module": ModuleRepository(conn),
            "rule": RuleRepository(conn),
        }

        # 拼装配置（避免覆盖 tkinter 的 config() 方法）
        self.assembly_config = AssemblyConfig()

        # 样式
        self._style_info = apply_style(self)

        # 构建界面
        self._build_menu()
        self._build_layout()
        self._build_statusbar()

    def _build_menu(self):
        menubar = tk.Menu(self, tearoff=0)
        file_menu = tk.Menu(menubar, tearoff=0)
        file_menu.add_command(label="导出 CSV...", command=self._on_export)
        file_menu.add_separator()
        file_menu.add_command(label="退出", command=self._on_quit)
        menubar.add_cascade(label="文件", menu=file_menu)

        edit_menu = tk.Menu(menubar, tearoff=0)
        edit_menu.add_command(label="新建条目", command=self._on_new_module)
        menubar.add_cascade(label="编辑", menu=edit_menu)

        help_menu = tk.Menu(menubar, tearoff=0)
        help_menu.add_command(label="关于", command=self._on_about)
        menubar.add_cascade(label="帮助", menu=help_menu)

        self.config(menu=menubar)

    def _build_layout(self):
        """三栏 PanedWindow 布局。"""
        paned = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        paned.pack(fill=tk.BOTH, expand=True)

        self.dim_panel = DimensionPanel(
            paned, on_module_selected=self._on_module_selected, repos=self.repos
        )
        self.assembly_panel = AssemblyPanel(
            paned, on_changed=self._on_assembly_changed, config=self.assembly_config
        )
        self.preview_panel = PreviewPanel(
            paned, on_random=self._on_random, on_export=self._on_export,
            mono_font=self._style_info.get("mono", ("Consolas", 11))
        )

        paned.add(self.dim_panel, weight=34)
        paned.add(self.assembly_panel, weight=30)
        paned.add(self.preview_panel, weight=36)

    def _build_statusbar(self):
        bar = ttk.Frame(self)
        bar.pack(fill=tk.X, side=tk.BOTTOM)
        dims = self.repos["dimension"].get_all()
        modules_grouped = self.repos["module"].get_all_grouped()
        total_modules = sum(len(v) for v in modules_grouped.values())
        self.status_label = ttk.Label(
            bar, text=f"维度: {len(dims)}  |  条目: {total_modules}  |  已选: 0  |  模型: SD"
        )
        self.status_label.pack(side=tk.LEFT, padx=8, pady=2)

    def _update_statusbar(self):
        dims = self.repos["dimension"].get_all()
        modules_grouped = self.repos["module"].get_all_grouped()
        total_modules = sum(len(v) for v in modules_grouped.values())
        selected_count = len(self.assembly_panel.selected_items)
        self.status_label.config(
            text=f"维度: {len(dims)}  |  条目: {total_modules}  |  已选: {selected_count}  |  模型: SD"
        )

    def _on_module_selected(self, module: Module):
        """左栏双击 → 中栏添加 → 重新拼装。"""
        self.assembly_panel.add_module(module)
        try:
            self.repos["module"].increment_usage(module.id)
        except Exception as e:
            log.debug(f"使用计数更新失败（可忽略）: {e}")
        self._reassemble()
        self._update_statusbar()

    def _on_assembly_changed(self, items: list[SelectedItem], config: AssemblyConfig):
        """中栏变化 → 重新拼装。"""
        self.assembly_config = config
        self._reassemble()
        self._update_statusbar()

    def _reassemble(self):
        """调用拼装引擎，更新右栏预览。"""
        items = self.assembly_panel.selected_items
        ir, final_prompt = assemble(items, self.assembly_config)
        self.preview_panel.update_preview(ir, final_prompt, ir.warnings)

    def _on_random(self, count: int, allow_nsfw: bool = False, use_partial: bool = True):
        """随机生成。"""
        try:
            dimensions = self.repos["dimension"].get_all()
            modules_by_dim = self.repos["module"].get_all_grouped()
            if use_partial:
                anchored = list(self.assembly_panel.selected_items)
                if not anchored:
                    # 空锚点退化为全随机
                    try:
                        self.preview_panel._show_toast("未选择锚点，已按全随机生成")
                    except Exception:
                        pass
                    results = random_assembly(
                        dimensions, modules_by_dim, set(), count,
                        self.assembly_config, allow_nsfw=allow_nsfw,
                    )
                else:
                    results = partial_random_assembly(
                        dimensions, modules_by_dim, anchored, count,
                        self.assembly_config, allow_nsfw=allow_nsfw,
                    )
            else:
                locked_ids = self.assembly_panel.get_locked_module_ids()
                results = random_assembly(
                    dimensions, modules_by_dim, locked_ids, count,
                    self.assembly_config, allow_nsfw=allow_nsfw,
                )
            self.preview_panel.update_batch(results)
            mode = "可控部分随机" if use_partial else "全随机"
            log.info(f"随机生成 {len(results)} 条（请求 {count}，模式={mode}，NSFW={'开' if allow_nsfw else '关'}）")
        except Exception as e:
            log.error(f"随机生成失败: {e}")
            messagebox.showerror("错误", f"随机生成失败: {e}")

    def _on_export(self):
        """导出 CSV。"""
        results = self.preview_panel.get_batch_results()
        if not results:
            messagebox.showinfo("提示", "批量结果为空，请先随机生成。")
            return
        filepath = filedialog.asksaveasfilename(
            defaultextension=".csv",
            filetypes=[("CSV", "*.csv")],
            initialfile="pmf_prompts.csv",
        )
        if filepath:
            try:
                export_csv(filepath, results)
                log.info(f"CSV 导出成功: {filepath}")
                messagebox.showinfo("成功", f"已导出 {len(results)} 条到:\n{filepath}")
            except Exception as e:
                log.error(f"CSV 导出失败: {e}")
                messagebox.showerror("错误", f"导出失败: {e}")

    def _on_about(self):
        messagebox.showinfo(
            "关于",
            "Prompt Modular Factory — 正式版\n"
            "提示词模块化工厂\n"
            "技术栈: Python + tkinter + sqlite3\n"
            "版本: V1.0 · 2026-08-23"
        )

    def _on_new_module(self):
        """菜单：新建条目 → 委托给左栏面板。"""
        self.dim_panel._on_add()

    def _on_quit(self):
        self.db.close()
        self.destroy()
