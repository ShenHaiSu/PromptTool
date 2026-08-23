"""数据访问层（Repository）单测：CRUD 基本读写验证。"""
import time
import uuid
from db.repository import DimensionRepository, ModuleRepository, RuleRepository


def _now():
    return int(time.time())


def _seed_minimal(conn):
    """插入最小维度+条目+规则数据供 CRUD 测试。"""
    ts = _now()
    conn.executescript(
        f"""INSERT OR IGNORE INTO dimensions
        (id, key, name_cn, name_en, sort_order, is_multi_select,
         is_enabled, icon, created_at, updated_at, is_deleted)
        VALUES
        ('d01','top','上装','Top',3,0,1,NULL,{ts},{ts},0),
        ('d02','bottom','下装','Bottom',4,0,1,NULL,{ts},{ts},0);

        INSERT OR IGNORE INTO modules
        (id, dimension_id, content_en, display_name, weight,
         is_enabled, usage_count, example_image, notes,
         created_at, updated_at, is_deleted)
        VALUES
        ('m01','d01','white shirt','白衬衫',1.0,1,0,NULL,NULL,{ts},{ts},0);

        INSERT OR IGNORE INTO rules
        (id, name, type, source_dimension_id, source_module_id,
         target_dimension_id, target_module_id, message,
         is_enabled, created_at, is_deleted)
        VALUES
        ('r01','测试规则','mutex','d01',NULL,'d02',NULL,'测试',1,{ts},0);
        """
    )
    conn.commit()


class TestDimensionRepository:
    def test_get_all_returns_seeded(self, in_memory_db):
        _seed_minimal(in_memory_db)
        repo = DimensionRepository(in_memory_db)
        dims = repo.get_all()
        assert len(dims) == 2
        assert dims[0].key == "top"
        assert dims[0].name_cn == "上装"

    def test_get_by_key(self, in_memory_db):
        _seed_minimal(in_memory_db)
        repo = DimensionRepository(in_memory_db)
        dim = repo.get_by_key("top")
        assert dim is not None
        assert dim.id == "d01"

    def test_create(self, in_memory_db):
        repo = DimensionRepository(in_memory_db)
        dim = repo.create("camera", "相机", "Camera", 11)
        assert dim.key == "camera"
        assert repo.get_by_key("camera") is not None


class TestModuleRepository:
    def test_get_by_dimension(self, in_memory_db):
        _seed_minimal(in_memory_db)
        repo = ModuleRepository(in_memory_db)
        mods = repo.get_by_dimension("d01")
        assert len(mods) == 1
        assert mods[0].content_en == "white shirt"
        assert mods[0].dimension_key == "top"

    def test_get_all_grouped(self, in_memory_db):
        _seed_minimal(in_memory_db)
        repo = ModuleRepository(in_memory_db)
        grouped = repo.get_all_grouped()
        assert "top" in grouped
        assert len(grouped["top"]) == 1

    def test_search(self, in_memory_db):
        _seed_minimal(in_memory_db)
        repo = ModuleRepository(in_memory_db)
        results = repo.search("shirt")
        assert len(results) == 1
        results = repo.search("nonexistent")
        assert len(results) == 0

    def test_create_update_soft_delete(self, in_memory_db):
        _seed_minimal(in_memory_db)
        repo = ModuleRepository(in_memory_db)
        mod = repo.create("d01", "black tee", "黑色T恤", 1.2)
        assert mod.display_name == "黑色T恤"

        mod.display_name = "黑色短袖"
        mod.weight = 1.5
        repo.update(mod)
        fetched = repo.get_by_id(mod.id)
        assert fetched.display_name == "黑色短袖"
        assert fetched.weight == 1.5

        repo.increment_usage(mod.id)
        fetched = repo.get_by_id(mod.id)
        assert fetched.usage_count == 1

        repo.soft_delete(mod.id)
        assert repo.get_by_id(mod.id) is None

    def test_create_with_is_nsfw(self, in_memory_db):
        _seed_minimal(in_memory_db)
        repo = ModuleRepository(in_memory_db)
        mod = repo.create("d01", "lingerie set", "内衣", 1.0, is_nsfw=True)
        fetched = repo.get_by_id(mod.id)
        assert fetched.is_nsfw is True

    def test_update_is_nsfw(self, in_memory_db):
        _seed_minimal(in_memory_db)
        repo = ModuleRepository(in_memory_db)
        mod = repo.get_by_id("m01")
        assert mod.is_nsfw is False
        mod.is_nsfw = True
        repo.update(mod)
        fetched = repo.get_by_id("m01")
        assert fetched.is_nsfw is True


class TestRuleRepository:
    def test_get_all_enabled(self, in_memory_db):
        _seed_minimal(in_memory_db)
        repo = RuleRepository(in_memory_db)
        rules = repo.get_all_enabled()
        assert len(rules) == 1
        assert rules[0]["name"] == "测试规则"
