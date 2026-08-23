"""
拼装引擎：将用户已选条目列表 + 全局配置 → PromptIR + 最终字符串。

处理流程：
1. 规则校验与消解（调用 rules.apply_rules）
2. 排序（按维度 sort_order 或用户自定义顺序）
3. 生成 PromptIR
4. 适配为最终字符串（调用 adapters.adapt_to_model）
"""
from __future__ import annotations
from engine.models import (
    SelectedItem, AssemblyConfig, PromptIR, IRSegment, Module
)
from engine.rules import apply_rules
from engine.adapters import adapt_to_model


def assemble(
    selected: list[SelectedItem],
    config: AssemblyConfig,
) -> tuple[PromptIR, str]:
    """拼装主函数。

    Args:
        selected: 用户已选条目列表
        config: 拼装全局配置

    Returns:
        (ir, final_prompt) — 中间表示与最终字符串
    """
    # 1. 规则校验与消解
    filtered, warnings = apply_rules(selected)

    # 2. 排序
    ordered = sort_by_order(filtered, config.sort_by)

    # 3. 生成 IR
    ir = PromptIR(
        segments=[
            IRSegment(
                dimension_key=it.module.dimension_key or "",
                text=it.module.content_en,
                weight=it.weight_override if it.weight_override is not None else it.module.weight,
                source_module_id=it.module.id,
            )
            for it in ordered
        ],
        warnings=warnings,
    )

    # 4. 适配为最终字符串
    final_prompt = adapt_to_model(ir, config.model_profile, config)
    return ir, final_prompt


def sort_by_order(
    items: list[SelectedItem],
    mode: str,
) -> list[SelectedItem]:
    """排序已选条目。

    Args:
        items: 待排序条目列表
        mode: 排序模式
            - "dimensionOrder": 按维度 sort_order 排列
            - "customDragOrder": 用户自定义顺序（保持原列表顺序，用上移/下移控制）

    Returns:
        排序后的条目列表
    """
    if mode == "customDragOrder":
        # 列表顺序即用户排列顺序，直接返回
        return list(items)

    # dimensionOrder：按置顶后顺序（gender→ethnicity→height→body...→camera）
    dim_order = {
        "gender": 0, "ethnicity": 1, "height": 2,
        "body": 3, "face": 4, "top": 5, "bottom": 6, "outfit": 7,
        "shoes": 8, "accessories": 9, "pose": 10, "props": 11,
        "background": 12, "camera": 13,
    }
    return sorted(
        items,
        key=lambda it: dim_order.get(it.module.dimension_key or "", 99),
    )
