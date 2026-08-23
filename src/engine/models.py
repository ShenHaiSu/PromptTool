"""
领域模型定义。
引擎层、UI 层、数据访问层共享这些 dataclass。
所有模型均为纯数据容器，不含业务逻辑方法。
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Dimension:
    """维度"""
    id: str
    key: str                    # 'top', 'bottom', 'outfit', ...
    name_cn: str                # '上装'
    name_en: str                # 'Top'
    sort_order: int             # 排列顺序
    is_multi_select: bool       # 是否多选
    is_enabled: bool            # 是否启用
    icon: Optional[str] = None


@dataclass
class Module:
    """提示词条目"""
    id: str
    dimension_id: str
    content_en: str             # 英文提示词片段
    display_name: str           # 中文显示名
    weight: float = 1.0         # 默认权重 0.5~2.0
    is_enabled: bool = True
    is_nsfw: bool = False        # 是否 NSFW（随机引擎可过滤）
    usage_count: int = 0
    example_image: Optional[str] = None
    notes: Optional[str] = None
    # 运行时补充字段（不在数据库中，由 Repository JOIN 填充）
    dimension_key: Optional[str] = None  # 所属维度的 key


@dataclass
class Tag:
    """标签"""
    id: str
    name: str
    color: Optional[str] = None


@dataclass
class SelectedItem:
    """用户已选的拼装条目（中栏数据）"""
    module: Module
    weight_override: Optional[float] = None  # None 表示用条目默认权重
    locked: bool = False                      # 是否锁定（随机时保留）


@dataclass
class IRSegment:
    """IR 中的一个片段"""
    dimension_key: str          # 所属维度 key
    text: str                   # 提示词文本
    weight: float               # 最终权重
    source_module_id: str       # 来源条目 ID


@dataclass
class PromptIR:
    """拼装中间表示——引擎核心数据结构"""
    segments: list[IRSegment] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def hash(self) -> str:
        """生成 IR 的哈希值，用于批量去重。"""
        import hashlib
        parts = [(s.dimension_key, s.text, round(s.weight, 1)) for s in self.segments]
        raw = "|".join(f"{d}:{t}:{w}" for d, t, w in parts)
        return hashlib.md5(raw.encode()).hexdigest()


@dataclass
class AssemblyConfig:
    """拼装全局配置"""
    separator: str = ", "                        # 分隔符：", " / " BREAK " / "\n"
    use_weight_brackets: bool = True             # 是否自动添加权重括号
    model_profile: str = "sd"                    # 模型配置：sd / mj / flux
    sort_by: str = "dimensionOrder"               # 排序方式：dimensionOrder / customDragOrder


# ------------------------------------------------------------------
# P0-01 历史/收藏/模板 领域模型（零破坏增量）
# ------------------------------------------------------------------
@dataclass
class Assembly:
    """拼装方案快照（对应 assemblies 表）"""
    id: str
    title: str | None
    prompt_ir_json: str          # JSON 快照
    final_prompt: str
    model_profile: str
    created_at: int
    is_favorite: bool = False
    is_deleted: bool = False


@dataclass
class AssemblyItemRow:
    """拼装明细行（对应 assembly_items 表）"""
    id: str
    assembly_id: str
    module_id: str
    sort_order: int
    weight_override: float | None
    is_locked: bool


@dataclass
class Template:
    """模板（对应 templates 表）"""
    id: str
    name: str
    description: str | None
    config_json: str             # AssemblyConfig + enabled_dimension_keys JSON
    cover_prompt: str | None
    created_at: int
    is_deleted: bool = False


@dataclass
class BatchCardModel:
    """批量结果 Card 轻量模型（不入库，仅 UI 层）"""
    index: int                   # 1-based
    ir: PromptIR
    final_prompt: str            # adapt_to_model 后的最终字符串
    warnings: list[str]
    dim_keys: list[str]          # 用于 chips
    hash: str                    # ir.hash()
