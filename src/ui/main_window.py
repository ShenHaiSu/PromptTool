"""
主窗口：三栏布局与事件协调（含 P0-01 历史/收藏/模板 + 批量 Card 联动）。
"""
from __future__ import annotations
import logging
import json
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog

from engine.models import SelectedItem, Module, AssemblyConfig, PromptIR, IRSegment
from engine.assembly import assemble
from engine.adapters import adapt_to_model
from engine.random_engine import random_assembly, partial_random_assembly
from db.connection import DatabaseConnection
from db.repository import (
    DimensionRepository, ModuleRepository, RuleRepository,
    AssemblyRepository, TemplateRepository,
)
from ui.dimension_panel import DimensionPanel
from ui.assembly_panel import AssemblyPanel
from ui.preview_panel import PreviewPanel
from ui.history_panel import HistoryPanel
from ui.styles import apply_style
from exporter import export_csv

log = logging.getLogger(__name__)


class MainWindow(tk.Tk):
    """主窗口：三栏 PanedWindow 布局 + 事件协调。"""

    def __init__(self, db_path: str, schema_path: str):
        super().__init__()
        self.title("Prompt Modular Factory — 正式版")
        self.geometry("1400x860")
        self.minsize(1100, 650)

        # 初始化数据库
        self.db = DatabaseConnection(db_path, schema_path)
        conn = self.db.get_connection()

        # 初始化仓库
        self.repos = {
            "dimension": DimensionRepository(conn),
            "module": ModuleRepository(conn),
            "rule": RuleRepository(conn),
            "assembly": AssemblyRepository(conn),
            "template": TemplateRepository(conn),
        }

        # 拼装配置
        self.assembly_config = AssemblyConfig()
        self._current_ir: PromptIR | None = None
        self._current_final: str = ""

        # 样式
        self._style_info = apply_style(self)

        # 构建界面
        self._build_menu()
        self._build_layout()
        self._build_statusbar()
        self._reassemble()

    def _build_menu(self):
        menubar = tk.Menu(self, tearoff=0)
        file_menu = tk.Menu(menubar, tearoff=0)
        file_menu.add_command(label="导出 CSV...", command=self._on_export)
        file_menu.add_command(label="另存为模板...", command=self._on_save_template_menu)
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
        """三栏 PanedWindow 布局：左/中/右（右栏内垂直分割为预览与历史）。"""
        paned = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        paned.pack(fill=tk.BOTH, expand=True)

        self.dim_panel = DimensionPanel(
            paned, on_module_selected=self._on_module_selected, repos=self.repos
        )
        self.assembly_panel = AssemblyPanel(
            paned,
            on_changed=self._on_assembly_changed,
            config=self.assembly_config,
            on_save=self._on_save_assembly,
            on_save_template=self._on_save_template_menu,
        )

        # 右栏：预览 + 历史/模板 垂直分割
        right_container = ttk.Frame(paned)
        self.preview_panel = PreviewPanel(
            right_container,
            on_random=self._on_random,
            on_export=self._on_export,
            mono_font=self._style_info.get("mono", ("Consolas", 11)),
            assembly_config_getter=lambda: self.assembly_config,
            on_batch_favorite=self._on_batch_favorite,
            on_batch_restore=self._on_batch_restore,
        )
        self.preview_panel.pack(fill=tk.BOTH, expand=True, padx=2, pady=2)

        # 分隔线
        ttk.Separator(right_container, orient=tk.HORIZONTAL).pack(fill=tk.X, pady=4)

        self.history_panel = HistoryPanel(
            right_container,
            assembly_repo=self.repos["assembly"],
            template_repo=self.repos["template"],
            on_restore=self._on_restore,
            on_template_apply=self._on_template_apply,
        )
        self.history_panel.pack(fill=tk.BOTH, expand=True, padx=2, pady=2)
        self.history_panel.set_create_template_handler(self._on_create_template_from_history)

        paned.add(self.dim_panel, weight=32)
        paned.add(self.assembly_panel, weight=28)
        paned.add(right_container, weight=40)

    def _build_statusbar(self):
        bar = ttk.Frame(self)
        bar.pack(fill=tk.X, side=tk.BOTTOM)
        dims = self.repos["dimension"].get_all()
        modules_grouped = self.repos["module"].get_all_grouped()
        total_modules = sum(len(v) for v in modules_grouped.values())
        try:
            hist_count = self.repos["assembly"].count_all()
            fav_count = self.repos["assembly"].count_favorites()
        except Exception:
            hist_count = 0
            fav_count = 0
        self.status_label = ttk.Label(
            bar,
            text=f"维度: {len(dims)}  |  条目: {total_modules}  |  已选: 0  |  历史: {hist_count}  收藏: {fav_count}  |  模型: SD"
        )
        self.status_label.pack(side=tk.LEFT, padx=8, pady=2)

    def _update_statusbar(self):
        dims = self.repos["dimension"].get_all()
        modules_grouped = self.repos["module"].get_all_grouped()
        total_modules = sum(len(v) for v in modules_grouped.values())
        selected_count = len(self.assembly_panel.selected_items)
        try:
            hist_count = self.repos["assembly"].count_all()
            fav_count = self.repos["assembly"].count_favorites()
        except Exception:
            hist_count = 0
            fav_count = 0
        self.status_label.config(
            text=f"维度: {len(dims)}  |  条目: {total_modules}  |  已选: {selected_count}  |  历史: {hist_count}  收藏: {fav_count}  |  模型: SD"
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
        self._current_ir = ir
        self._current_final = final_prompt
        self.preview_panel.update_preview(ir, final_prompt, ir.warnings)

    # ---- P0-01：保存/收藏/模板 ----

    def _on_save_assembly(self, is_favorite: bool):
        if not self._current_ir:
            self._reassemble()
        if not self.assembly_panel.selected_items and not self._current_final:
            messagebox.showinfo("提示", "当前无拼装内容，无法保存。")
            return
        # 标题弹窗（可选）
        title = simpledialog.askstring(
            "保存方案",
            "方案标题（留空自动生成）:",
            initialvalue="",
            parent=self,
        )
        if title is None:
            return
        title = title.strip() or None
        ir = self._current_ir or PromptIR(segments=[], warnings=[])
        try:
            aid = self.repos["assembly"].save(
                title=title,
                ir=ir,
                final_prompt=self._current_final,
                config=self.assembly_config,
                items=list(self.assembly_panel.selected_items),
                is_favorite=is_favorite,
            )
            log.info(f"保存方案: {aid} fav={is_favorite}")
            self.history_panel.refresh()
            self._update_statusbar()
            self.preview_panel._show_toast("已收藏并保存" if is_favorite else "已保存到历史")
            # 选中新行（若当前在历史 Tab）
            try:
                self.history_panel.history_tree.selection_set(aid)
                self.history_panel.history_tree.focus(aid)
                self.history_panel.history_tree.see(aid)
            except Exception:
                pass
        except Exception as e:
            log.error(f"保存方案失败: {e}")
            messagebox.showerror("错误", f"保存失败: {e}")

    def _on_save_template_menu(self):
        # 弹窗输入名称/描述
        top = tk.Toplevel(self)
        top.title("另存为模板")
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
        self._on_create_template(result["name"], result["desc"])

    def _on_create_template(self, name: str, desc: str | None):
        # 收集当前配置与维度开关
        dims = self.repos["dimension"].get_all()
        enabled_keys = [d.key for d in dims if d.is_enabled]
        cover = self._current_final[:200] if self._current_final else None
        try:
            tid = self.repos["template"].save(
                name=name,
                description=desc,
                config=self.assembly_config,
                enabled_keys=enabled_keys,
                cover_prompt=cover,
            )
            log.info(f"保存模板: {tid} {name}")
            self.history_panel.refresh_templates()
            self.preview_panel._show_toast(f"模板已保存: {name}")
        except Exception as e:
            log.error(f"保存模板失败: {e}")
            messagebox.showerror("错误", f"保存模板失败: {e}")

    def _on_create_template_from_history(self, name: str, desc: str | None):
        self._on_create_template(name, desc)

    def _on_restore(self, assembly_id: str):
        """历史双击一键回填中栏。"""
        try:
            items = self.repos["assembly"].load_selected_items(assembly_id)
            if not items:
                messagebox.showinfo("提示", "该方案无可用条目（可能已被删除）。")
                return
            # 检测失效占位
            invalid = sum(1 for it in items if it.module.notes and "已失效" in it.module.notes)
            self.assembly_panel.set_items(items)
            self._reassemble()
            self._update_statusbar()
            if invalid:
                self.preview_panel.warning_label.config(
                    text=f"⚠ {invalid} 项原条目已删除，已用快照占位",
                    bg="#FFF2CC",
                )
                self.preview_panel._show_toast(f"已回填 {len(items)} 项（{invalid} 项已失效）")
            else:
                self.preview_panel._show_toast(f"已回填 {len(items)} 项")
        except Exception as e:
            log.error(f"回填失败: {e}")
            messagebox.showerror("错误", f"回填失败: {e}")

    def _on_template_apply(self, template_id: str):
        try:
            config, enabled_keys = self.repos["template"].apply(template_id)
            # 回写中栏配置
            self.assembly_config = config
            self.assembly_panel.apply_config(config)
            # 可选：若模板记录了 enabled_keys，可同步更新维度开关（本期仅配置，不改 DB 维度启用状态，避免副作用）
            # 保留 enabled_keys 仅作提示
            if enabled_keys:
                log.info(f"应用模板 {template_id}: enabled_keys={enabled_keys}")
            self._reassemble()
            self._update_statusbar()
            self.preview_panel._show_toast("已应用模板")
        except Exception as e:
            log.error(f"应用模板失败: {e}")
            messagebox.showerror("错误", f"应用模板失败: {e}")

    # ---- 批量 Card 回调 ----

    def _on_batch_favorite(self, ir: PromptIR, final_prompt: str):
        try:
            self.repos["assembly"].save_from_ir(
                ir=ir,
                final_prompt=final_prompt,
                config=self.assembly_config,
                is_favorite=True,
            )
            self.history_panel.refresh()
            self._update_statusbar()
            self.preview_panel._show_toast("已收藏")
        except Exception as e:
            log.error(f"批量收藏失败: {e}")
            self.preview_panel._show_toast(f"收藏失败: {e}")

    def _on_batch_restore(self, ir: PromptIR):
        """将单条 IR 回填到中栏：按 ir.segments 反推 Module（尽量关联真实 module）。"""
        items: list[SelectedItem] = []
        for seg in ir.segments:
            mod = None
            try:
                mod = self.repos["module"].get_by_id(seg.source_module_id)
            except Exception:
                mod = None
            if mod is None:
                # 快照占位
                mod = Module(
                    id=seg.source_module_id,
                    dimension_id="",
                    content_en=seg.text,
                    display_name=seg.text[:20] or "[快照]",
                    weight=seg.weight,
                    is_enabled=False,
                    dimension_key=seg.dimension_key,
                    notes="[来自批量结果快照]",
                )
                w = None if seg.weight == 1.0 else seg.weight
                items.append(SelectedItem(module=mod, weight_override=w, locked=False))
            else:
                w = None if seg.weight == mod.weight else seg.weight
                # 若 weight 与 ir 不一致则用 ir 权重覆盖
                if seg.weight != mod.weight:
                    w = seg.weight if seg.weight != 1.0 else None
                items.append(SelectedItem(module=mod, weight_override=w, locked=False))
        self.assembly_panel.set_items(items)
        self._reassemble()
        self._update_statusbar()
        self.preview_panel._show_toast(f"已回填批量结果（{len(items)} 段）")

    def _on_random(self, count: int, allow_nsfw: bool = False, use_partial: bool = True):
        """随机生成。"""
        try:
            dimensions = self.repos["dimension"].get_all()
            modules_by_dim = self.repos["module"].get_all_grouped()
            if use_partial:
                anchored = list(self.assembly_panel.selected_items)
                if not anchored:
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
            "含 P0-01 历史/收藏/一键复用 + 批量 Card 流\n"
            "版本: V1.2 · 2026-08-23"
        )

    def _on_new_module(self):
        """菜单：新建条目 → 委托给左栏面板。"""
        self.dim_panel._on_add()

    def _on_quit(self):
        self.db.close()
        self.destroy()
