"""
ttk 主题样式定义。
"""
from __future__ import annotations
import tkinter as tk
from tkinter import ttk


def apply_style(root: tk.Tk):
    style = ttk.Style(root)
    style.theme_use("clam")  # clam 主题跨平台一致性最好

    # 配色（与 V1.1 设计规范一致）
    style.configure("Treeview", font=("Microsoft YaHei UI", 10), rowheight=28)
    style.configure("Treeview.Heading", font=("Microsoft YaHei UI", 10, "bold"))
    style.configure("TButton", font=("Microsoft YaHei UI", 10), padding=4)
    style.configure("TLabel", font=("Microsoft YaHei UI", 10))
    style.configure("TLabelframe.Label", font=("Microsoft YaHei UI", 10, "bold"))

    # 等宽字体用于预览区
    MONO_FONT = ("Consolas", 11)
    return {"mono": MONO_FONT}
