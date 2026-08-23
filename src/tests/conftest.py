"""
pytest 公共 fixtures。
使用内存 SQLite 数据库，测试互不干扰。
"""
from __future__ import annotations
import sqlite3
import pathlib
import pytest

from engine.models import (
    Dimension, Module, SelectedItem, AssemblyConfig
)

# schema.sql 的绝对路径（src/db/schema.sql）
SCHEMA_PATH = pathlib.Path(__file__).parent.parent / "db" / "schema.sql"


@pytest.fixture
def in_memory_db():
    """内存数据库，每个测试独立。"""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    if SCHEMA_PATH.exists():
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    yield conn
    conn.close()


@pytest.fixture
def sample_dimensions():
    """11 维预置数据。"""
    return [
        Dimension(id="d01", key="body", name_cn="身材", name_en="Body",
                  sort_order=1, is_multi_select=False, is_enabled=True),
        Dimension(id="d03", key="top", name_cn="上装", name_en="Top",
                  sort_order=3, is_multi_select=False, is_enabled=True),
        Dimension(id="d04", key="bottom", name_cn="下装", name_en="Bottom",
                  sort_order=4, is_multi_select=False, is_enabled=True),
        Dimension(id="d05", key="outfit", name_cn="全身套装", name_en="Outfit",
                  sort_order=5, is_multi_select=False, is_enabled=True),
        Dimension(id="d06", key="shoes", name_cn="鞋袜", name_en="Shoes",
                  sort_order=6, is_multi_select=False, is_enabled=True),
        Dimension(id="d10", key="background", name_cn="背景", name_en="Background",
                  sort_order=10, is_multi_select=False, is_enabled=True),
    ]


@pytest.fixture
def sample_modules():
    """示例条目。"""
    return {
        "top": Module(id="m_top_01", dimension_id="d03", dimension_key="top",
                      content_en="oversized white shirt", display_name="宽松白衬衫",
                      weight=1.0),
        "bottom": Module(id="m_bot_01", dimension_id="d04", dimension_key="bottom",
                        content_en="high-waisted pleated skirt", display_name="高腰百褶裙",
                        weight=1.0),
        "outfit": Module(id="m_out_01", dimension_id="d05", dimension_key="outfit",
                        content_en="red bodycon dress", display_name="红色紧身连衣裙",
                        weight=1.0),
        "shoes_bare": Module(id="m_sh_03", dimension_id="d06", dimension_key="shoes",
                             content_en="barefoot", display_name="赤脚", weight=0.8),
        "shoes_sneaker": Module(id="m_sh_01", dimension_id="d06", dimension_key="shoes",
                                content_en="white sneakers", display_name="白色运动鞋",
                                weight=1.0),
        "bg_studio": Module(id="m_bg_01", dimension_id="d10", dimension_key="background",
                           content_en="minimalist studio, white backdrop",
                           display_name="极简棚拍白底", weight=1.0),
        "bg_beach": Module(id="m_bg_02", dimension_id="d10", dimension_key="background",
                          content_en="cherry blossom street, soft sunlight",
                          display_name="樱花街道柔光", weight=1.2),
        "top_nsfw": Module(id="m_top_15", dimension_id="d03", dimension_key="top",
                           content_en="no bra, bare cleavage visible",
                           display_name="裸露上装", weight=1.0, is_nsfw=True),
    }


@pytest.fixture
def default_config():
    return AssemblyConfig()
