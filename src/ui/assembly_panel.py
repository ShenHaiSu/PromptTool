"""
兼容 shim：旧 AssemblyPanel 代理至 AssemblyCanvas。
保留 1 个版本后可删除。
"""
from ui.assembly_canvas import AssemblyCanvas as AssemblyPanel

__all__ = ["AssemblyPanel"]
