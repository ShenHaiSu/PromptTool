"""
主窗口：P02 顶部通栏布局 + 三栏 30:38:32 + 快捷键 + 持久化 + 主题切换。
"""
from __future__ import annotations
import logging
import json
from pathlib import Path
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
from ui.assembly_canvas import AssemblyCanvas
from ui.topbar import TopPreviewBar
from ui.batch_factory import BatchFactory
from ui.history_panel import HistoryPanel
from ui.styles import apply_style, toggle_theme
from config import WINDOW_SIZE, WINDOW_MIN_SIZE, LAYOUT_WEIGHTS, PMF_JSON
from exporter import export_csv

log = logging.getLogger(__name__)


def _load_pmf_json() -> dict:
    try:
        p = Path(PMF_JSON)
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _save_pmf_json(data: dict):
    try:
        p = Path(PMF_JSON)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        log.debug(f"保存 pmf.json 失败: {e}")


class MainWindow(tk.Tk):
    def __init__(self, db_path: str, schema_path: str):
        super().__init__()
        self.title("Prompt Modular Factory — 正式版")
        self.geometry(WINDOW_SIZE)
        self.minsize(*WINDOW_MIN_SIZE)

        self.db = DatabaseConnection(db_path, schema_path)
        conn = self.db.get_connection()

        self.repos = {
            "dimension": DimensionRepository(conn),
            "module": ModuleRepository(conn),
            "rule": RuleRepository(conn),
            "assembly": AssemblyRepository(conn),
            "template": TemplateRepository(conn),
        }

        self.assembly_config = AssemblyConfig()
        self._current_ir: PromptIR | None = None
        self._current_final: str = ""
        self._pmf_data = _load_pmf_json()
        self._theme: str = self._pmf_data.get("theme", "light")

        self._style_info = apply_style(self, theme=self._theme)

        # toast 队列
        self._toast_queue: list[str] = []
        self._toast_showing: bool = False

        self._build_menu()
        self._build_layout()
        self._build_statusbar()
        self._reassemble()
        self._bind_shortcuts()
        self._restore_sash_positions()
        self.protocol("WM_DELETE_WINDOW", self._on_quit)

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

        view_menu = tk.Menu(menubar, tearoff=0)
        view_menu.add_command(label="浅色主题", command=lambda: self._set_theme("light"))
        view_menu.add_command(label="深色主题", command=lambda: self._set_theme("dark"))
        view_menu.add_command(label="切换主题", command=self._toggle_theme)
        menubar.add_cascade(label="视图", menu=view_menu)

        help_menu = tk.Menu(menubar, tearoff=0)
        help_menu.add_command(label="关于", command=self._on_about)
        menubar.add_cascade(label="帮助", menu=help_menu)

        self.config(menu=menubar)

    def _set_theme(self, theme: str):
        if theme == self._theme:
            return
        self._theme = theme
        apply_style(self, theme=self._theme)
        self._save_pmf_state()

    def _toggle_theme(self):
        self._theme = toggle_theme(self, self._theme)
        # 同步 statusbar 按钮文字
        if hasattr(self, "_theme_btn"):
            try:
                self._theme_btn.configure(text="🌙" if self._theme == "light" else "☀")
            except Exception:
                pass
        self._save_pmf_state()

    def _build_layout(self):
        # 顶部通栏
        self.topbar = TopPreviewBar(
            self,
            on_copy=self._on_copy_preview,
            on_export=self._on_export,
            mono_font=self._style_info.get("mono", ("Consolas", 11)),
        )
        self.topbar.pack(fill=tk.X, padx=8, pady=(8, 4))

        self.paned = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        self.paned.pack(fill=tk.BOTH, expand=True, padx=8, pady=4)

        self.dim_panel = DimensionPanel(
            self.paned, on_module_selected=self._on_module_selected, repos=self.repos
        )
        self.canvas = AssemblyCanvas(
            self.paned,
            on_changed=self._on_assembly_changed,
            config=self.assembly_config,
            on_save=self._on_save_assembly,
            on_save_template=self._on_save_template_menu,
        )
        # 兼容旧属性名
        self.assembly_panel = self.canvas

        self.right = ttk.Frame(self.paned)
        self.batch_factory = BatchFactory(
            self.right,
            on_random=self._on_random,
            on_export=self._on_export,
            mono_font=self._style_info.get("mono", ("Consolas", 11)),
            assembly_config_getter=lambda: self.assembly_config,
            on_batch_favorite=self._on_batch_favorite,
            on_batch_restore=self._on_batch_restore,
        )
        # 兼容旧属性：preview_panel 代理到 batch_factory + topbar
        self.preview_panel = self.batch_factory
        # 额外兼容：让旧代码 preview_panel.update_preview / warning_label 不报错
        # TopBar 已有 update_preview；warning 由 badge 承载
        self.preview_panel.warning_label = self.topbar.badge  # type: ignore
        # _show_toast 转发到 MainWindow
        orig_show = self.batch_factory._show_toast  # noqa
        self.preview_panel._show_toast = self._show_toast  # type: ignore
        # get_batch_results 已有

        self.batch_factory.pack(fill=tk.BOTH, expand=True, padx=2, pady=2)
        ttk.Separator(self.right, orient=tk.HORIZONTAL).pack(fill=tk.X, pady=4)
        self.history_panel = HistoryPanel(
            self.right,
            assembly_repo=self.repos["assembly"],
            template_repo=self.repos["template"],
            on_restore=self._on_restore,
            on_template_apply=self._on_template_apply,
        )
        self.history_panel.pack(fill=tk.BOTH, expand=True, padx=2, pady=2)
        self.history_panel.set_create_template_handler(self._on_create_template_from_history)

        self.paned.add(self.dim_panel, weight=LAYOUT_WEIGHTS["left"])
        self.paned.add(self.canvas, weight=LAYOUT_WEIGHTS["center"])
        self.paned.add(self.right, weight=LAYOUT_WEIGHTS["right"])

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
        # 主题切换按钮
        icon = "🌙" if self._theme == "light" else "☀"
        self._theme_btn = ttk.Button(bar, text=icon, width=4, command=self._toggle_theme)
        self._theme_btn.pack(side=tk.RIGHT, padx=8)

    def _update_statusbar(self):
        dims = self.repos["dimension"].get_all()
        modules_grouped = self.repos["module"].get_all_grouped()
        total_modules = sum(len(v) for v in modules_grouped.values())
        selected_count = len(self.canvas.selected_items)
        try:
            hist_count = self.repos["assembly"].count_all()
            fav_count = self.repos["assembly"].count_favorites()
        except Exception:
            hist_count = 0
            fav_count = 0
        self.status_label.config(
            text=f"维度: {len(dims)}  |  条目: {total_modules}  |  已选: {selected_count}  |  历史: {hist_count}  收藏: {fav_count}  |  模型: SD"
        )

    def _bind_shortcuts(self):
        self.bind("<Control-f>", lambda e: (self.dim_panel.focus_search(), "break")[1] if hasattr(self.dim_panel, "focus_search") else None)
        self.bind("<Control-F>", lambda e: (self.dim_panel.focus_search(), "break")[1] if hasattr(self.dim_panel, "focus_search") else None)
        self.bind("<Control-s>", lambda e: self._on_save_assembly(False))
        self.bind("<Control-S>", lambda e: self._on_save_assembly(False))
        self.bind("<Control-c>", lambda e: self._on_copy_preview())
        self.bind("<Control-C>", lambda e: self._on_copy_preview())
        self.bind("<Delete>", lambda e: None)

    def _restore_sash_positions(self):
        sash = self._pmf_data.get("sash")
        if not sash or not isinstance(sash, list):
            return
        try:
            self.update_idletasks()
            total = self.paned.winfo_width() or 1400
            # 存的是比例
            if all(isinstance(v, float) and 0 < v < 1 for v in sash):
                pos0 = int(total * sash[0])
                pos1 = int(total * (sash[0] + sash[1])) if len(sash) > 1 else None
                if pos0 > 0:
                    self.paned.sashpos(0, pos0)
                if pos1 and len(sash) > 1:
                    self.paned.sashpos(1, pos1)
            elif all(isinstance(v, int) for v in sash):
                for i, p in enumerate(sash[:2]):
                    if p > 0:
                        self.paned.sashpos(i, p)
        except Exception:
            pass

    def _save_pmf_state(self):
        try:
            total = self.paned.winfo_width() or 1400
            ratios: list[float] = []
            for i in range(2):
                try:
                    pos = self.paned.sashpos(i)
                    ratios.append(pos / total if total else 0.3)
                except Exception:
                    ratios.append(0.3)
            data = dict(self._pmf_data)
            data["theme"] = self._theme
            data["geometry"] = self.geometry()
            data["sash"] = ratios
            _save_pmf_json(data)
            self._pmf_data = data
        except Exception:
            pass

    def _show_toast(self, msg: str):
        self._toast_queue.append(msg)
        if self._toast_showing:
            return
        self._dequeue_toast()

    def _dequeue_toast(self):
        if not self._toast_queue:
            self._toast_showing = False
            return
        self._toast_showing = True
        msg = self._toast_queue.pop(0)
        try:
            from ui.styles import TOKENS_LIGHT, TOKENS_DARK
            tokens = TOKENS_DARK if self._theme == "dark" else TOKENS_LIGHT
            bg = tokens["success"]
        except Exception:
            bg = "#22C55E"
        toast = ttk.Label(self, text=f"✓ {msg}", background=bg, foreground="white")
        try:
            toast.place(relx=0.5, rely=0.95, anchor=tk.CENTER)
        except Exception:
            self._toast_showing = False
            return

        def _done():
            try:
                toast.destroy()
            except Exception:
                pass
            self._dequeue_toast()

        self.after(1500, _done)

    def _on_copy_preview(self, _text: str | None = None):
        content = _text if _text is not None else self._current_final
        if not content:
            self._show_toast("暂无预览内容")
            return
        try:
            self.clipboard_clear()
            self.clipboard_append(content)
            self._show_toast("已复制到剪贴板")
        except Exception:
            self._show_toast("复制失败")

    def _on_module_selected(self, module: Module):
        self.canvas.add_module(module)
        try:
            self.repos["module"].increment_usage(module.id)
        except Exception as e:
            log.debug(f"使用计数更新失败（可忽略）: {e}")
        self._reassemble()
        self._update_statusbar()

    def _on_assembly_changed(self, items: list[SelectedItem], config: AssemblyConfig):
        self.assembly_config = config
        self._reassemble()
        self._update_statusbar()

    def _reassemble(self):
        items = self.canvas.selected_items
        ir, final_prompt = assemble(items, self.assembly_config)
        self._current_ir = ir
        self._current_final = final_prompt
        # 同时更新 topbar（兼容 preview_panel shim）
        try:
            self.topbar.update(ir, final_prompt, ir.warnings)
        except Exception:
            pass
        # 旧 preview_panel.update_preview 已由 topbar 承载；batch_factory 不需要预览

    # ---- 保存/收藏/模板 ----

    def _on_save_assembly(self, is_favorite: bool):
        if not self._current_ir:
            self._reassemble()
        if not self.canvas.selected_items and not self._current_final:
            messagebox.showinfo("提示", "当前无拼装内容，无法保存。")
            return
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
                items=list(self.canvas.selected_items),
                is_favorite=is_favorite,
            )
            log.info(f"保存方案: {aid} fav={is_favorite}")
            self.history_panel.refresh()
            self._update_statusbar()
            self._show_toast("已收藏并保存" if is_favorite else "已保存到历史")
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
            self._show_toast(f"模板已保存: {name}")
        except Exception as e:
            log.error(f"保存模板失败: {e}")
            messagebox.showerror("错误", f"保存模板失败: {e}")

    def _on_create_template_from_history(self, name: str, desc: str | None):
        self._on_create_template(name, desc)

    def _on_restore(self, assembly_id: str):
        if assembly_id == "_empty":
            return
        # 回填确认：当前有已选时需二次确认
        try:
            if self.canvas.has_items():
                # 预加载以拿到数量用于提示
                tmp_items = self.repos["assembly"].load_selected_items(assembly_id)
                m = len(tmp_items) if tmp_items else 0
                n = len(self.canvas.selected_items)
                if not messagebox.askyesno("回填确认", f"当前已选 {n} 项，将被覆盖为 {m} 项，是否继续？"):
                    return
        except Exception:
            pass
        try:
            items = self.repos["assembly"].load_selected_items(assembly_id)
            if not items:
                messagebox.showinfo("提示", "该方案无可用条目（可能已被删除）。")
                return
            invalid = sum(1 for it in items if it.module.notes and "已失效" in it.module.notes)
            self.canvas.set_items(items)
            self._reassemble()
            self._update_statusbar()
            if invalid:
                self._show_toast(f"已回填 {len(items)} 项（{invalid} 项已失效）")
            else:
                self._show_toast(f"已回填 {len(items)} 项")
        except Exception as e:
            log.error(f"回填失败: {e}")
            messagebox.showerror("错误", f"回填失败: {e}")

    def _on_template_apply(self, template_id: str):
        if template_id == "_empty":
            return
        try:
            config, enabled_keys = self.repos["template"].apply(template_id)
            self.assembly_config = config
            self.canvas.apply_config(config)
            if enabled_keys:
                log.info(f"应用模板 {template_id}: enabled_keys={enabled_keys}")
            self._reassemble()
            self._update_statusbar()
            self._show_toast("已应用模板")
        except Exception as e:
            log.error(f"应用模板失败: {e}")
            messagebox.showerror("错误", f"应用模板失败: {e}")

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
            self._show_toast("已收藏")
        except Exception as e:
            log.error(f"批量收藏失败: {e}")
            self._show_toast(f"收藏失败: {e}")

    def _on_batch_restore(self, ir: PromptIR):
        # 回填确认
        if self.canvas.has_items():
            if not messagebox.askyesno("回填确认", f"当前已选 {len(self.canvas.selected_items)} 项，将被覆盖为 {len(ir.segments)} 段，是否继续？"):
                return
        items: list[SelectedItem] = []
        for seg in ir.segments:
            mod = None
            try:
                mod = self.repos["module"].get_by_id(seg.source_module_id)
            except Exception:
                mod = None
            if mod is None:
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
                if seg.weight != mod.weight:
                    w = seg.weight if seg.weight != 1.0 else None
                items.append(SelectedItem(module=mod, weight_override=w, locked=False))
        self.canvas.set_items(items)
        self._reassemble()
        self._update_statusbar()
        self._show_toast(f"已回填批量结果（{len(items)} 段）")

    def _on_random(self, count: int, allow_nsfw: bool = False, use_partial: bool = True):
        try:
            dimensions = self.repos["dimension"].get_all()
            modules_by_dim = self.repos["module"].get_all_grouped()
            if use_partial:
                anchored = list(self.canvas.selected_items)
                if not anchored:
                    try:
                        self._show_toast("未选择锚点，已按全随机生成")
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
                locked_ids = self.canvas.get_locked_module_ids()
                results = random_assembly(
                    dimensions, modules_by_dim, locked_ids, count,
                    self.assembly_config, allow_nsfw=allow_nsfw,
                )
            self.batch_factory.update_batch(results)
            mode = "可控部分随机" if use_partial else "全随机"
            log.info(f"随机生成 {len(results)} 条（请求 {count}，模式={mode}，NSFW={'开' if allow_nsfw else '关'}）")
        except Exception as e:
            log.error(f"随机生成失败: {e}")
            messagebox.showerror("错误", f"随机生成失败: {e}")

    def _on_export(self):
        results = self.batch_factory.get_batch_results()
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
            "版本: V2.0 TopBar · 2026-08-23"
        )

    def _on_new_module(self):
        self.dim_panel._on_add()

    def _on_quit(self):
        try:
            self._save_pmf_state()
        except Exception:
            pass
        try:
            self.db.close()
        except Exception:
            pass
        self.destroy()
