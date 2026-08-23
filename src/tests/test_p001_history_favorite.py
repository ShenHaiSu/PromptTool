"""P0-01 历史·收藏·一键复用 + 模板 + Card 模型 单测。"""
import json
import time
import sqlite3
from pathlib import Path

from engine.models import (
    AssemblyConfig, PromptIR, IRSegment, Module, SelectedItem,
    Assembly, BatchCardModel,
)
from db.repository import AssemblyRepository, TemplateRepository
from engine.adapters import adapt_to_model

SCHEMA_PATH = Path(__file__).parent.parent / "db" / "schema.sql"


def _conn_with_schema():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    return conn


def _seed_dims_modules(conn):
    ts = int(time.time())
    conn.executescript(
        f"""
        INSERT INTO dimensions (id, key, name_cn, name_en, sort_order, is_multi_select, is_enabled, icon, created_at, updated_at, is_deleted)
        VALUES ('d01','top','上装','Top',5,0,1,NULL,{ts},{ts},0),
               ('d02','bottom','下装','Bottom',6,0,1,NULL,{ts},{ts},0),
               ('d03','shoes','鞋袜','Shoes',8,0,1,NULL,{ts},{ts},0);
        INSERT INTO modules (id, dimension_id, content_en, display_name, weight, is_enabled, is_nsfw, usage_count, notes, created_at, updated_at, is_deleted)
        VALUES ('m01','d01','white shirt','白衬衫',1.0,1,0,0,NULL,{ts},{ts},0),
               ('m02','d02','black skirt','黑裙',1.2,1,0,0,NULL,{ts},{ts},0),
               ('m03','d03','white sneakers','白球鞋',1.0,1,0,0,NULL,{ts},{ts},0);
        """
    )
    conn.commit()


def _make_ir() -> PromptIR:
    return PromptIR(
        segments=[
            IRSegment(dimension_key="top", text="white shirt", weight=1.2, source_module_id="m01"),
            IRSegment(dimension_key="bottom", text="black skirt", weight=1.0, source_module_id="m02"),
        ],
        warnings=[],
    )


class TestAssemblyRepository:
    def test_save_and_get(self):
        conn = _conn_with_schema()
        _seed_dims_modules(conn)
        repo = AssemblyRepository(conn)
        config = AssemblyConfig(separator=", ", use_weight_brackets=True, model_profile="sd", sort_by="dimensionOrder")
        ir = _make_ir()
        final = adapt_to_model(ir, "sd", config)
        mods = [
            Module(id="m01", dimension_id="d01", content_en="white shirt", display_name="白衬衫", weight=1.0, dimension_key="top"),
            Module(id="m02", dimension_id="d02", content_en="black skirt", display_name="黑裙", weight=1.2, dimension_key="bottom"),
        ]
        items = [SelectedItem(module=mods[0], weight_override=1.2), SelectedItem(module=mods[1])]
        aid = repo.save("测试", ir, final, config, items)
        assert aid
        got = repo.get(aid)
        assert got is not None
        assert got.title == "测试"
        assert got.final_prompt == final
        # items
        rows = repo.get_items(aid)
        assert len(rows) == 2
        assert rows[0].module_id == "m01"

    def test_save_auto_title(self):
        conn = _conn_with_schema()
        _seed_dims_modules(conn)
        repo = AssemblyRepository(conn)
        config = AssemblyConfig()
        ir = _make_ir()
        final = adapt_to_model(ir, "sd", config)
        mods = [Module(id="m01", dimension_id="d01", content_en="white shirt", display_name="白衬衫", dimension_key="top")]
        aid = repo.save(None, ir, final, config, [SelectedItem(module=mods[0])])
        got = repo.get(aid)
        assert got.title is not None and "·" in got.title

    def test_list_search_favorite_soft_delete(self):
        conn = _conn_with_schema()
        _seed_dims_modules(conn)
        repo = AssemblyRepository(conn)
        config = AssemblyConfig()
        ir = _make_ir()
        final = adapt_to_model(ir, "sd", config)
        mod = Module(id="m01", dimension_id="d01", content_en="white shirt", display_name="白衬衫", dimension_key="top")
        a1 = repo.save("alpha", ir, final, config, [SelectedItem(module=mod)])
        a2 = repo.save("beta", ir, final + " extra", config, [SelectedItem(module=mod)])
        assert len(repo.list_recent(limit=10)) == 2
        assert len(repo.search("alpha")) == 1
        # favorite
        repo.toggle_favorite(a1)
        favs = repo.list_favorites(limit=10)
        assert len(favs) == 1 and favs[0].id == a1
        repo.toggle_favorite(a1)
        assert len(repo.list_favorites(limit=10)) == 0
        # rename
        repo.rename(a2, "beta2")
        assert repo.get(a2).title == "beta2"
        # soft delete
        repo.soft_delete(a1)
        assert repo.get(a1) is None
        assert len(repo.list_recent(limit=10)) == 1
        assert repo.count_all() == 1

    def test_save_from_ir_and_batch(self):
        conn = _conn_with_schema()
        _seed_dims_modules(conn)
        repo = AssemblyRepository(conn)
        config = AssemblyConfig()
        ir = _make_ir()
        final = adapt_to_model(ir, "sd", config)
        aid = repo.save_from_ir(ir, final, config, is_favorite=True, title="card1")
        assert repo.get(aid).is_favorite is True
        # batch
        ids = repo.save_batch([
            ("t1", ir, final, config, []),
            ("t2", ir, final, config, []),
        ])
        assert len(ids) == 2
        assert repo.count_all() == 3

    def test_load_selected_items_and_deleted_module_snapshot(self):
        conn = _conn_with_schema()
        _seed_dims_modules(conn)
        repo = AssemblyRepository(conn)
        config = AssemblyConfig()
        ir = _make_ir()
        final = adapt_to_model(ir, "sd", config)
        mod1 = Module(id="m01", dimension_id="d01", content_en="white shirt", display_name="白衬衫", dimension_key="top")
        mod2 = Module(id="m02", dimension_id="d02", content_en="black skirt", display_name="黑裙", dimension_key="bottom")
        aid = repo.save("snap", ir, final, config, [SelectedItem(module=mod1), SelectedItem(module=mod2)])
        # 软删一个 module
        conn.execute("UPDATE modules SET is_deleted=1 WHERE id='m02'")
        conn.commit()
        items = repo.load_selected_items(aid)
        # 注意：LEFT JOIN 仍能查到已软删的 module 行（未过滤 is_deleted），
        # 因此 load_selected_items 通过 mod_deleted 标记识别失效并用 notes 标记
        assert len(items) == 2
        invalid = [it for it in items if it.module.notes and "已失效" in it.module.notes]
        # 若 LEFT JOIN 仍返回 content_en，则 invalid 标记依赖 mod_deleted
        # 断言：第二项应为失效占位或 m02 的 display_name 含已失效标记
        assert len(invalid) == 1 or "[已失效]" in items[1].module.display_name

    def test_load_selected_items_from_ir_snapshot_when_items_empty(self):
        conn = _conn_with_schema()
        _seed_dims_modules(conn)
        repo = AssemblyRepository(conn)
        config = AssemblyConfig()
        # ir 指向不存在的 module
        ir = PromptIR(segments=[IRSegment(dimension_key="top", text="ghost prompt", weight=1.0, source_module_id="ghost")], warnings=[])
        aid = repo.save_from_ir(ir, "ghost prompt", config, title="ghost")
        items = repo.load_selected_items(aid)
        # assembly_items 为空时应由快照兜底出一条
        assert len(items) >= 1
        assert items[0].module.content_en == "ghost prompt"


class TestTemplateRepository:
    def test_save_list_apply_rename_delete(self):
        conn = _conn_with_schema()
        repo = TemplateRepository(conn)
        cfg = AssemblyConfig(separator=" BREAK ", use_weight_brackets=False, model_profile="sd", sort_by="customDragOrder")
        tid = repo.save("My Template", "desc", cfg, ["top", "bottom"], "cover prompt")
        assert tid
        assert len(repo.list_all()) == 1
        ac, keys = repo.apply(tid)
        assert ac.separator == " BREAK "
        assert ac.use_weight_brackets is False
        assert ac.sort_by == "customDragOrder"
        assert keys == ["top", "bottom"]
        repo.rename(tid, "Renamed")
        assert repo.get(tid).name == "Renamed"
        repo.soft_delete(tid)
        assert repo.get(tid) is None
        assert len(repo.list_all()) == 0


class TestBatchCardModelAndAdapter:
    def test_batch_card_model_fields(self):
        ir = _make_ir()
        config = AssemblyConfig()
        final = adapt_to_model(ir, "sd", config)
        m = BatchCardModel(index=1, ir=ir, final_prompt=final, warnings=[], dim_keys=["top", "bottom"], hash=ir.hash())
        assert m.index == 1
        assert m.final_prompt == final
        assert m.hash == ir.hash()

    def test_index_migration_idempotent(self):
        conn = _conn_with_schema()
        # DatabaseConnection._migrate 幂等索引
        from db.connection import DatabaseConnection
        import tempfile, os
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            db_path = os.path.join(tmpdir, "pmf.db")
            db = DatabaseConnection(db_path, str(SCHEMA_PATH))
            # 再次初始化同一库
            db2 = DatabaseConnection(db_path, str(SCHEMA_PATH))
            assert db2.get_connection().execute("SELECT 1").fetchone() is not None
            db.close()
            db2.close()
