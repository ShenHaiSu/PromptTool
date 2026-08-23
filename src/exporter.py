"""
CSV 导出工具函数。
"""
from __future__ import annotations
import csv
from engine.models import PromptIR


def export_csv(filepath: str, results: list[PromptIR]):
    """将批量拼装结果导出为 CSV。

    列：序号, 提示词, 维度构成, 冲突警告
    """
    with open(filepath, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["序号", "提示词", "维度构成", "冲突警告"])
        for i, ir in enumerate(results, 1):
            prompt = ", ".join(s.text for s in ir.segments)
            dims = " > ".join(s.dimension_key for s in ir.segments)
            warnings = " | ".join(ir.warnings) if ir.warnings else ""
            writer.writerow([i, prompt, dims, warnings])
