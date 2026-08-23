"""
规则引擎：校验已选条目间的冲突与依赖关系。

当前内置 3 条核心规则：
  R01 套装互斥：选了 outfit 维度条目 → top/bottom 维度条目自动剔除
  R02 鞋袜与赤脚互斥：选了 barefoot → 其余 shoes 条目自动剔除（反之亦然）
  R03 室内外背景互斥：选了 studio 背景 → beach/sunset 背景自动剔除

规则消解优先级：保留 locked 条目，剔除非 locked 的冲突项。
"""
from __future__ import annotations
from engine.models import SelectedItem


def apply_rules(
    selected: list[SelectedItem],
) -> tuple[list[SelectedItem], list[str]]:
    """对所有已选条目应用规则引擎。

    Args:
        selected: 用户已选条目列表

    Returns:
        (filtered_items, warnings)
        - filtered_items: 消解冲突后的条目列表
        - warnings: 冲突提示消息列表
    """
    warnings: list[str] = []
    items = list(selected)
    removed_ids: list[int] = []  # 记录被剔除项的 id()，用身份比较避免 dataclass 误判

    # --- R01: 套装互斥 ---
    has_outfit = any(it.module.dimension_key == "outfit" for it in items)
    if has_outfit:
        for it in items:
            if it.module.dimension_key in ("top", "bottom") and not it.locked:
                removed_ids.append(id(it))
        if removed_ids:
            warnings.append("已选全身套装，上装/下装将自动忽略")

    # --- R02: 鞋袜与赤脚互斥 ---
    shoes_items = [it for it in items if it.module.dimension_key == "shoes"]
    has_barefoot = any("barefoot" in it.module.content_en.lower() for it in shoes_items)
    has_shoes = any(
        "barefoot" not in it.module.content_en.lower() for it in shoes_items
    )
    if has_barefoot and has_shoes:
        barefoot_locked = any(
            it.locked and "barefoot" in it.module.content_en.lower() for it in shoes_items
        )
        if barefoot_locked:
            # 锁定了赤脚 → 剔除非赤脚非锁定项
            for it in shoes_items:
                if "barefoot" not in it.module.content_en.lower() and not it.locked:
                    removed_ids.append(id(it))
            if removed_ids:
                warnings.append("赤脚与鞋袜不可共存，已剔除鞋袜项")
        else:
            # 锁定了鞋袜或都未锁定 → 剔除非锁定赤脚项
            for it in shoes_items:
                if "barefoot" in it.module.content_en.lower() and not it.locked:
                    removed_ids.append(id(it))
            if removed_ids:
                warnings.append("赤脚与鞋袜不可共存，已剔除赤脚项")

    # --- R03: 室内外背景互斥 ---
    bg_items = [it for it in items if it.module.dimension_key == "background"]
    has_studio = any("studio" in it.module.content_en.lower() for it in bg_items)
    has_outdoor = any(
        any(kw in it.module.content_en.lower() for kw in ("beach", "sunset", "street", "rooftop"))
        for it in bg_items
    )
    if has_studio and has_outdoor:
        # 保留 locked 项，优先保留 studio（棚拍优先）
        for it in bg_items:
            if "studio" not in it.module.content_en.lower() and not it.locked:
                removed_ids.append(id(it))
        if removed_ids:
            warnings.append("室内背景与户外背景冲突，已保留棚拍")

    # 去重 removed_ids，避免重复 id
    removed_set = set(removed_ids)
    items = [it for it in items if id(it) not in removed_set]
    return items, warnings
