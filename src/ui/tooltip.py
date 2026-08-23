"""通用 Tooltip 气泡。"""
from __future__ import annotations
import tkinter as tk


class Tooltip:
    def __init__(self, widget: tk.Widget, text: str, delay: int = 400):
        self.widget = widget
        self.text = text
        self.delay = delay
        self._tip: tk.Toplevel | None = None
        self._after_id: str | None = None
        widget.bind("<Enter>", self._on_enter, add="+")
        widget.bind("<Leave>", self._on_leave, add="+")
        widget.bind("<ButtonPress>", self._on_leave, add="+")

    def _on_enter(self, _event=None):
        self._after_id = self.widget.after(self.delay, self._show)

    def _on_leave(self, _event=None):
        if self._after_id:
            try:
                self.widget.after_cancel(self._after_id)
            except Exception:
                pass
            self._after_id = None
        self._hide()

    def _show(self):
        if self._tip is not None:
            return
        try:
            x = self.widget.winfo_rootx() + 12
            y = self.widget.winfo_rooty() + self.widget.winfo_height() + 6
        except Exception:
            return
        tip = tk.Toplevel(self.widget)
        tip.wm_overrideredirect(True)
        tip.wm_geometry(f"+{x}+{y}")
        tip.attributes("-topmost", True)
        label = tk.Label(
            tip, text=self.text, background="#1E293B", foreground="#F8FAFC",
            font=("Microsoft YaHei UI", 9), padx=8, pady=4, justify="left",
            wraplength=260,
        )
        label.pack()
        self._tip = tip

    def _hide(self):
        if self._tip is not None:
            try:
                self._tip.destroy()
            except Exception:
                pass
            self._tip = None
