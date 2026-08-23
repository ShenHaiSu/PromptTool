"""维度扩容与迁移回归测试：14 维、356 条、中文名、NSFW、幂等、排序、随机、存量升级。"""
from __future__ import annotations
import os
import sqlite3
import tempfile
import pathlib
import random

import pytest

from db.connection import DatabaseConnection
from db.seed import seed_data, ensure_dimensions, repair_display_names, mark_nsfw_modules, disable_deprecated_gender_modules, TARGET_ORDER
from db.sample_importer import import_sample_prompts
from db.display_names import DISPLAY_NAMES
from db.repository import DimensionRepository, ModuleRepository
from engine.assembly import sort_by_order
from engine.random_engine import random_assembly
from engine.models import Dimension, Module, SelectedItem, AssemblyConfig
from config import SAMPLE_PROMPT_DIR

SCHEMA_PATH = pathlib.Path(__file__).parent.parent / "db" / "schema.sql"
SAMPLE_DIR = str(SAMPLE_PROMPT_DIR)


def _fresh_db(tmpdir: str):
    db_path = os.path.join(tmpdir, "pmf.db")
    db = DatabaseConnection(db_path, str(SCHEMA_PATH))
    conn = db.get_connection()
    return db, conn


def test_seed_new_dimensions():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        db, conn = _fresh_db(tmpdir)
        seed_data(conn, SAMPLE_DIR)
        dims = DimensionRepository(conn).get_all()
        assert len(dims) == 14
        keys = {d.key for d in dims}
        assert {"gender", "ethnicity", "height"} <= keys
        # 置顶后 sort_order：gender 1, ethnicity 2, height 3
        m = {d.key: d.sort_order for d in dims}
        assert m["gender"] == 1
        assert m["ethnicity"] == 2
        assert m["height"] == 3
        assert m["body"] == 4
        assert m["camera"] == 14
        # ORDER BY sort_order 首三为置顶三维
        assert [d.key for d in dims[:3]] == ["gender", "ethnicity", "height"]
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE);"); conn.execute("PRAGMA journal_mode=DELETE;"); db.close()


def test_import_adds_10_per_dim_and_new_dims():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        db, conn = _fresh_db(tmpdir)
        seed_data(conn, SAMPLE_DIR)
        grouped = ModuleRepository(conn).get_all_grouped()
        # 11 维各 28 条（25 存量 + 3 NSFW 新增）
        for k in ["body", "face", "top", "bottom", "outfit", "shoes", "accessories", "pose", "props", "background", "camera"]:
            assert len(grouped[k]) == 28, f"{k} !=28 got {len(grouped[k])}"
        assert len(grouped["gender"]) == 15
        assert len(grouped["ethnicity"]) == 27
        assert len(grouped["height"]) == 6
        assert sum(len(v) for v in grouped.values()) == 356
        # gender 11~15 已禁用（is_enabled=0 但仍计入总数）
        disabled = [r for r in conn.execute("SELECT id FROM modules WHERE id IN ('mod_gender_11','mod_gender_12','mod_gender_13','mod_gender_14','mod_gender_15') AND is_enabled=0").fetchall()]
        assert len(disabled) == 5
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE);"); conn.execute("PRAGMA journal_mode=DELETE;"); db.close()


def test_display_name_not_equal_content_en():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        db, conn = _fresh_db(tmpdir)
        seed_data(conn, SAMPLE_DIR)
        rows = conn.execute("SELECT id, content_en, display_name FROM modules WHERE is_deleted=0").fetchall()
        for r in rows:
            assert r["display_name"] and r["display_name"].strip() != ""
            assert r["display_name"] != r["content_en"], f"{r['id']} display_name == content_en"
        # 覆盖率 100%
        assert len(rows) == len(DISPLAY_NAMES)
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE);"); conn.execute("PRAGMA journal_mode=DELETE;"); db.close()


def test_nsfw_mark_count():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        db, conn = _fresh_db(tmpdir)
        seed_data(conn, SAMPLE_DIR)
        grouped = ModuleRepository(conn).get_all_grouped()
        nsfw = [m for mods in grouped.values() for m in mods if m.is_nsfw]
        # 11 维各 4 条（15 + 26/27/28），gender/ethnicity/height 0 条
        assert len(nsfw) == 44
        for k in ["body", "face", "top", "bottom", "outfit", "shoes", "accessories", "pose", "props", "background", "camera"]:
            nsfw_in_dim = [m for m in grouped[k] if m.is_nsfw]
            assert len(nsfw_in_dim) == 4, f"{k} nsfw !=4 got {len(nsfw_in_dim)}"
            ids = {m.id for m in nsfw_in_dim}
            assert f"mod_{k}_15" in ids
            assert f"mod_{k}_26" in ids
            assert f"mod_{k}_27" in ids
            assert f"mod_{k}_28" in ids
        # gender/ethnicity/height 无 NSFW
        for k in ["gender", "ethnicity", "height"]:
            assert not any(m.is_nsfw for m in grouped[k]), f"{k} should have 0 NSFW"
        # 16~25 均为普通
        for k in ["body", "face", "top", "bottom", "outfit", "shoes", "accessories", "pose", "props", "background", "camera"]:
            for m in grouped[k]:
                if m.id.endswith("_16") or m.id.endswith("_17") or m.id.endswith("_18") or m.id.endswith("_19") or m.id.endswith("_20") or m.id.endswith("_21") or m.id.endswith("_22") or m.id.endswith("_23") or m.id.endswith("_24") or m.id.endswith("_25"):
                    assert not m.is_nsfw, f"{m.id} should not be NSFW"
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE);"); conn.execute("PRAGMA journal_mode=DELETE;"); db.close()


def test_import_idempotent_and_preserves_weight():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        db, conn = _fresh_db(tmpdir)
        seed_data(conn, SAMPLE_DIR)
        # 改权重
        conn.execute("UPDATE modules SET weight=1.8 WHERE id='mod_body_01'")
        conn.commit()
        # 二次导入
        import_sample_prompts(conn, SAMPLE_DIR)
        w = conn.execute("SELECT weight FROM modules WHERE id='mod_body_01'").fetchone()[0]
        assert abs(w - 1.8) < 1e-6
        total = conn.execute("SELECT count(*) FROM modules WHERE is_deleted=0").fetchone()[0]
        assert total == 356
        # 三次导入亦无重复
        import_sample_prompts(conn, SAMPLE_DIR)
        total2 = conn.execute("SELECT count(*) FROM modules WHERE is_deleted=0").fetchone()[0]
        assert total2 == 356
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE);"); conn.execute("PRAGMA journal_mode=DELETE;"); db.close()


def test_repair_display_names():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        db, conn = _fresh_db(tmpdir)
        seed_data(conn, SAMPLE_DIR)
        # 故意破坏一条
        conn.execute("UPDATE modules SET display_name=content_en WHERE id='mod_body_01'")
        conn.commit()
        fixed = repair_display_names(conn)
        assert fixed >= 1
        row = conn.execute("SELECT display_name, content_en FROM modules WHERE id='mod_body_01'").fetchone()
        assert row["display_name"] != row["content_en"]
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE);"); conn.execute("PRAGMA journal_mode=DELETE;"); db.close()


def test_sort_by_order_with_new_dims():
    mods = [
        Module(id="m_h", dimension_id="d14", dimension_key="height", content_en="height 170cm", display_name="170cm", weight=1.0),
        Module(id="m_g", dimension_id="d12", dimension_key="gender", content_en="female model", display_name="女性", weight=1.0),
        Module(id="m_b", dimension_id="d01", dimension_key="body", content_en="slim waist", display_name="纤细", weight=1.0),
        Module(id="m_c", dimension_id="d11", dimension_key="camera", content_en="85mm", display_name="85mm", weight=1.0),
    ]
    items = [SelectedItem(module=m) for m in mods]
    ordered = sort_by_order(items, "dimensionOrder")
    keys = [it.module.dimension_key for it in ordered]
    # 置顶后：gender(0) → height(2) → body(3) → camera(13)
    assert keys == ["gender", "height", "body", "camera"]
    # customDragOrder 保持原序
    assert [it.module.dimension_key for it in sort_by_order(items, "customDragOrder")] == [m.dimension_key for m in mods]


def test_random_includes_new_dims():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        db, conn = _fresh_db(tmpdir)
        seed_data(conn, SAMPLE_DIR)
        dims = DimensionRepository(conn).get_all()
        grouped = ModuleRepository(conn).get_all_grouped()
        random.seed(42)
        results = random_assembly(dims, grouped, set(), 80, AssemblyConfig(), allow_nsfw=False)
        assert len(results) > 0
        # 至少出现过 gender/ethnicity/height 中的一种
        all_keys = {s.dimension_key for r in results for s in r.segments}
        assert all_keys & {"gender", "ethnicity", "height"}
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE);"); conn.execute("PRAGMA journal_mode=DELETE;"); db.close()


def test_migration_from_11_to_14(tmp_path=None):
    """模拟存量 11 维旧库增量升级到 14 维。"""
    import tempfile, os
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        db_path = os.path.join(tmpdir, "pmf.db")
        # 手动建旧库：仅 11 维 + 各 15 条英文 display_name
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON;")
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        ts = 1000000
        old_dims = [
            ("dim_01", "body", "模特身材特点", "Body", 1, 0),
            ("dim_02", "face", "模特面部特点", "Face", 2, 0),
            ("dim_03", "top", "模特上装", "Top", 3, 0),
            ("dim_04", "bottom", "模特下装", "Bottom", 4, 0),
            ("dim_05", "outfit", "模特全身套装", "Outfit", 5, 0),
            ("dim_06", "shoes", "模特鞋袜", "Shoes", 6, 0),
            ("dim_07", "accessories", "模特配饰", "Accessories", 7, 1),
            ("dim_08", "pose", "模特姿势", "Pose", 8, 0),
            ("dim_09", "props", "交互物品", "Props", 9, 0),
            ("dim_10", "background", "背景风格", "Background", 10, 0),
            ("dim_11", "camera", "相机参数", "Camera", 11, 0),
        ]
        for d in old_dims:
            conn.execute("INSERT INTO dimensions (id,key,name_cn,name_en,sort_order,is_multi_select,is_enabled,icon,created_at,updated_at,is_deleted) VALUES (?,?,?,?,?,?,1,NULL,?,?,0)", (*d, ts, ts))
        # 每维写入 15 条，display_name == content_en（模拟旧缺陷）
        for dim_key in ["body","face","top","bottom","outfit","shoes","accessories","pose","props","background","camera"]:
            dim_id = next(x[0] for x in old_dims if x[1]==dim_key)
            for i in range(1, 16):
                mid = f"mod_{dim_key}_{i:02d}"
                en = f"old content {dim_key} {i}"
                conn.execute("INSERT INTO modules (id,dimension_id,content_en,display_name,weight,is_enabled,is_nsfw,usage_count,created_at,updated_at,is_deleted) VALUES (?,?,?,?,1,1,0,0,?, ?,0)", (mid, dim_id, en, en, ts, ts))
        conn.commit(); conn.close()

        # 用新代码增量升级
        db = DatabaseConnection(db_path, str(SCHEMA_PATH))
        c2 = db.get_connection()
        ensure_dimensions(c2)
        import_sample_prompts(c2, SAMPLE_DIR)
        repair_display_names(c2)
        mark_nsfw_modules(c2)
        disable_deprecated_gender_modules(c2)
        dims = DimensionRepository(c2).get_all()
        assert len(dims) == 14
        # 置顶排序已纠偏
        m = {d.key: d.sort_order for d in dims}
        assert m["gender"] == 1 and m["ethnicity"] == 2 and m["height"] == 3
        grouped = ModuleRepository(c2).get_all_grouped()
        assert sum(len(v) for v in grouped.values()) == 356
        # 旧条目中文已修复
        row = c2.execute("SELECT display_name, content_en FROM modules WHERE id='mod_body_01'").fetchone()
        assert row["display_name"] != row["content_en"]
        c2.execute("PRAGMA wal_checkpoint(TRUNCATE);"); c2.execute("PRAGMA journal_mode=DELETE;"); db.close()
