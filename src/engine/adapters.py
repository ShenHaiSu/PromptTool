"""
语法适配器：将 PromptIR 转换为目标模型的最终提示词字符串。

当前已实现 SD (Stable Diffusion) 适配器，MJ / Flux 适配器已预留接口。
"""
from __future__ import annotations
from engine.models import PromptIR, AssemblyConfig


def adapt_to_model(
    ir: PromptIR,
    profile: str,
    config: AssemblyConfig,
) -> str:
    """将 IR 适配为最终提示词字符串。

    Args:
        ir: 拼装中间表示
        profile: 模型配置（"sd" / "mj" / "flux"）
        config: 全局配置

    Returns:
        最终提示词字符串
    """
    if profile == "sd":
        parts = [_adapt_segment_sd(seg, config) for seg in ir.segments]
    elif profile == "mj":
        parts = [_adapt_segment_mj(seg, config) for seg in ir.segments]
    elif profile == "flux":
        parts = [_adapt_segment_flux(seg, config) for seg in ir.segments]
    else:
        # 默认按 SD 处理
        parts = [_adapt_segment_sd(seg, config) for seg in ir.segments]

    return config.separator.join(parts)


def _adapt_segment_sd(segment, config: AssemblyConfig) -> str:
    """SD 适配单段。

    规则：
    - 权重 = 1.0 或未启用括号 → 原文输出
    - 权重 > 1.0 → (text:weight)，如 (oversized white shirt:1.2)
    - 权重 < 1.0 → [text]，弱化
    """
    if not config.use_weight_brackets or segment.weight == 1.0:
        return segment.text
    if segment.weight > 1.0:
        return f"({segment.text}:{segment.weight:.1f})"
    return f"[{segment.text}]"


def _adapt_segment_mj(segment, config: AssemblyConfig) -> str:
    """MJ 适配单段。

    规则：
    - 权重 ≠ 1.0 → text::weight
    - 权重 = 1.0 → 原文
    """
    if segment.weight == 1.0:
        return segment.text
    return f"{segment.text}::{segment.weight}"


def _adapt_segment_flux(segment, config: AssemblyConfig) -> str:
    """Flux 适配单段（自然语言模式，无权重语法）。"""
    return segment.text
