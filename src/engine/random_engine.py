"""
随机引擎：按权重加权随机生成拼装方案，支持锁定与批量去重。
"""
from __future__ import annotations
import copy
import random
from engine.models import (
    Dimension, Module, SelectedItem, AssemblyConfig, PromptIR
)
from engine.assembly import assemble
from engine.rules import apply_rules


def random_assembly(
    dimensions: list[Dimension],
    modules_by_dim: dict[str, list[Module]],
    locked_module_ids: set[str],
    count: int,
    config: AssemblyConfig,
    allow_nsfw: bool = False,
) -> list[PromptIR]:
    """批量随机生成拼装方案。

    Args:
        dimensions: 参与随机的维度列表
        modules_by_dim: 每维度可用条目映射 {dim_key: [Module, ...]}
        locked_module_ids: 锁定的条目 ID 集合（随机时保留）
        count: 生成数量
        config: 拼装配置
        allow_nsfw: 是否允许 NSFW 条目参与随机（False 时过滤掉）

    Returns:
        去重后的 PromptIR 列表
    """
    results: list[PromptIR] = []
    seen: set[str] = set()
    max_attempts = count * 10
    attempts = 0

    while len(results) < count and attempts < max_attempts:
        attempts += 1
        picked: list[SelectedItem] = []

        for dim in dimensions:
            if not dim.is_enabled:
                continue

            pool = modules_by_dim.get(dim.key, [])
            pool = [m for m in pool if m.is_enabled]
            if not allow_nsfw:
                pool = [m for m in pool if not m.is_nsfw]
            if not pool:
                continue

            # 检查该维度是否有锁定项
            locked_in_dim = [m for m in pool if m.id in locked_module_ids]
            if locked_in_dim:
                picked.extend(
                    SelectedItem(module=m, locked=True) for m in locked_in_dim
                )
                continue

            # 加权随机采样
            if dim.is_multi_select:
                # 多选维度：随机 0~2 个
                n = random.randint(0, min(2, len(pool)))
            else:
                n = 1

            if n == 0:
                continue

            weights = [m.weight for m in pool]
            sampled = random.choices(pool, weights=weights, k=n)
            picked.extend(
                SelectedItem(module=m, locked=False) for m in sampled
            )

        if not picked:
            continue

        ir, _ = assemble(picked, config)
        h = ir.hash()
        if h not in seen:
            seen.add(h)
            results.append(ir)

    return results


def partial_random_assembly(
    dimensions: list[Dimension],
    modules_by_dim: dict[str, list[Module]],
    anchored_items: list[SelectedItem],
    count: int,
    config: AssemblyConfig,
    allow_nsfw: bool = False,
) -> list[PromptIR]:
    """可控部分随机：以中栏已选为锚点，仅对缺口维度随机补充。

    - 锚点全部保留（不区分 locked，已选即锚点）
    - 缺口维度 = is_enabled 且未被锚点覆盖、且未被禁忌的维度
    - 禁忌维度：锚点含 outfit 时，top/bottom 不再补充
    - 候选池预过滤：shoes 裸足互斥、background 室内外互斥
    - 多选维度已锚定时补充上限收敛
    - 锚点为空时退化为全随机
    """
    if not anchored_items:
        return random_assembly(dimensions, modules_by_dim, set(), count, config, allow_nsfw=allow_nsfw)

    # 锚点清洗：规则消解后保留的即为有效锚点
    clean_anchor, _ = apply_rules(list(anchored_items))
    if not clean_anchor:
        return random_assembly(dimensions, modules_by_dim, set(), count, config, allow_nsfw=allow_nsfw)

    anchor_dim_keys = {it.module.dimension_key for it in clean_anchor if it.module.dimension_key}
    forbidden_dims: set[str] = set()
    if "outfit" in anchor_dim_keys:
        forbidden_dims.update({"top", "bottom"})
    if "top" in anchor_dim_keys or "bottom" in anchor_dim_keys:
        forbidden_dims.add("outfit")

    gap_dimensions = [
        d for d in dimensions
        if d.is_enabled
        and d.key not in anchor_dim_keys
        and d.key not in forbidden_dims
        and modules_by_dim.get(d.key)
    ]

    results: list[PromptIR] = []
    seen: set[str] = set()
    max_attempts = count * 10
    attempts = 0

    while len(results) < count and attempts < max_attempts:
        attempts += 1
        picked: list[SelectedItem] = copy.deepcopy(clean_anchor)

        for dim in gap_dimensions:
            pool = modules_by_dim.get(dim.key, [])
            pool = [m for m in pool if m.is_enabled]
            if not allow_nsfw:
                pool = [m for m in pool if not m.is_nsfw]
            if not pool:
                continue

            pool = _filter_pool_by_anchor(pool, clean_anchor, dim.key)
            if not pool:
                continue

            if dim.is_multi_select:
                # 已锚定多选维度的补充上限收敛
                anchored_in_dim = sum(1 for it in clean_anchor if it.module.dimension_key == dim.key)
                if anchored_in_dim > 0:
                    n = random.randint(0, min(1, len(pool)))
                else:
                    n = random.randint(0, min(2, len(pool)))
            else:
                n = 1

            if n == 0:
                continue

            weights = [m.weight for m in pool]
            sampled = random.choices(pool, weights=weights, k=n)
            picked.extend(SelectedItem(module=m, locked=False) for m in sampled)

        if not picked:
            continue

        ir, _ = assemble(picked, config)
        h = ir.hash()
        if h not in seen:
            seen.add(h)
            results.append(ir)

    return results


def _filter_pool_by_anchor(
    pool: list[Module],
    anchored_items: list[SelectedItem],
    dim_key: str,
) -> list[Module]:
    """按锚点预过滤候选池，避免与已选冲突。"""
    if dim_key == "shoes":
        has_barefoot_anchor = any(
            it.module.dimension_key == "shoes" and "barefoot" in it.module.content_en.lower()
            for it in anchored_items
        )
        has_shoes_anchor = any(
            it.module.dimension_key == "shoes" and "barefoot" not in it.module.content_en.lower()
            for it in anchored_items
        )
        if has_barefoot_anchor and not has_shoes_anchor:
            return [m for m in pool if "barefoot" in m.content_en.lower()]
        if has_shoes_anchor and not has_barefoot_anchor:
            return [m for m in pool if "barefoot" not in m.content_en.lower()]

    if dim_key == "background":
        has_studio = any(
            it.module.dimension_key == "background" and "studio" in it.module.content_en.lower()
            for it in anchored_items
        )
        has_outdoor = any(
            it.module.dimension_key == "background" and any(
                kw in it.module.content_en.lower() for kw in ("beach", "sunset", "street", "rooftop")
            )
            for it in anchored_items
        )
        if has_studio:
            return [m for m in pool if not any(
                kw in m.content_en.lower() for kw in ("beach", "sunset", "street", "rooftop")
            )]
        if has_outdoor:
            return [m for m in pool if "studio" not in m.content_en.lower()]

    return pool


def weighted_sample(
    pool: list[Module],
    weights: list[float],
    k: int,
) -> list[Module]:
    """加权随机采样的独立封装（供测试直接调用）。

    Args:
        pool: 可选条目池
        weights: 对应权重列表
        k: 采样数量

    Returns:
        采样结果列表
    """
    return random.choices(pool, weights=weights, k=k)
