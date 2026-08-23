"""端到端集成测试：seed → assemble → random → export 全流程。"""
import os
import csv
import random
import tempfile

from config import SAMPLE_PROMPT_DIR
from db.connection import DatabaseConnection
from db.seed import seed_data
from db.repository import DimensionRepository, ModuleRepository
from engine.assembly import assemble
from engine.random_engine import random_assembly
from engine.models import SelectedItem, AssemblyConfig
from exporter import export_csv


SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "..", "db", "schema.sql")
SAMPLE_DIR = str(SAMPLE_PROMPT_DIR)


class TestEndToEnd:
    """模拟验收闭环：seed → 选词 → 拼装 → 随机 → 导出 CSV。"""

    def test_full_acceptance_flow(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            db_path = os.path.join(tmpdir, "pmf.db")
            db = DatabaseConnection(db_path, SCHEMA_PATH)
            conn = db.get_connection()

            # 首次启动 → seed
            seed_data(conn, SAMPLE_DIR)
            dim_repo = DimensionRepository(conn)
            mod_repo = ModuleRepository(conn)

            dims = dim_repo.get_all()
            assert len(dims) == 14  # A1: 新增 gender/ethnicity/height 后为 14 维

            grouped = mod_repo.get_all_grouped()
            assert sum(len(v) for v in grouped.values()) == 356  # 14 维：356 条（28*11 + 15 + 27 + 6）

            # 选词 → 拼装
            config = AssemblyConfig()
            selected = [
                SelectedItem(module=grouped["top"][0]),
                SelectedItem(module=grouped["bottom"][0]),
            ]
            ir, final = assemble(selected, config)
            assert len(ir.segments) == 2  # A3
            assert "oversized white shirt" in final  # A9

            # 权重 > 1 → 括号语法
            selected_w = [SelectedItem(module=grouped["top"][0], weight_override=1.5)]
            ir2, final2 = assemble(selected_w, config)
            assert "(oversized white shirt" in final2 and ":1.5)" in final2  # A4

            # 排序：dimensionOrder 下 top 排在 bottom 前
            selected_rev = [
                SelectedItem(module=grouped["bottom"][0]),
                SelectedItem(module=grouped["top"][0]),
            ]
            ir3, final3 = assemble(selected_rev, config)
            assert final3.index("oversized") < final3.index("high-waisted")  # A5

            # 随机 50 条去重
            random.seed(123)
            results = random_assembly(dims, grouped, set(), 50, config)
            hashes = [r.hash() for r in results]
            assert len(hashes) == len(set(hashes))  # A7

            # 锁定后随机 → 始终出现
            locked = {grouped["top"][0].id}
            results_locked = random_assembly(dims, grouped, locked, 10, config)
            for r in results_locked:
                assert any(s.dimension_key == "top" for s in r.segments)  # A8

            # NSFW 标记验证：11 维各 4 条 = 44 条（gender/ethnicity/height 0 条）
            nsfw_count = sum(
                1 for mods in grouped.values() for m in mods if m.is_nsfw
            )
            assert nsfw_count == 44

            # 默认随机（allow_nsfw=False）→ 结果中无 NSFW 条目
            nsfw_ids = {m.id for mods in grouped.values() for m in mods if m.is_nsfw}
            results_safe = random_assembly(dims, grouped, set(), 50, config)
            for ir in results_safe:
                seg_ids = {s.source_module_id for s in ir.segments}
                assert not (seg_ids & nsfw_ids)

            # 允许 NSFW → 结果中可出现 NSFW 条目
            results_nsfw = random_assembly(
                dims, grouped, set(), 50, config, allow_nsfw=True
            )
            nsfw_found = any(
                m.is_nsfw
                for ir in results_nsfw
                for s in ir.segments
                for mods in grouped.values()
                for m in mods
                if m.content_en == s.text
            )
            assert nsfw_found

            # CSV 导出
            csv_path = os.path.join(tmpdir, "export.csv")
            export_csv(csv_path, results)
            assert os.path.exists(csv_path)  # A10
            with open(csv_path, encoding="utf-8-sig") as f:
                reader = csv.reader(f)
                header = next(reader)
                assert header == ["序号", "提示词", "维度构成", "冲突警告"]
                rows = list(reader)
                assert len(rows) == len(results)

            # 关闭前将 WAL 合并回主库，避免 Windows 下临时文件锁定
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            conn.execute("PRAGMA journal_mode = DELETE;")
            db.close()

    def test_outfit_mutex_rule_integration(self):
        """验收 A6：选 outfit 后 top/bottom 自动忽略。"""
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            db_path = os.path.join(tmpdir, "pmf.db")
            db = DatabaseConnection(db_path, SCHEMA_PATH)
            conn = db.get_connection()
            seed_data(conn, SAMPLE_DIR)
            grouped = ModuleRepository(conn).get_all_grouped()

            selected = [
                SelectedItem(module=grouped["outfit"][0]),
                SelectedItem(module=grouped["top"][0]),
                SelectedItem(module=grouped["bottom"][0]),
            ]
            ir, _ = assemble(selected, AssemblyConfig())
            dim_keys = {s.dimension_key for s in ir.segments}
            assert "outfit" in dim_keys
            assert "top" not in dim_keys
            assert "bottom" not in dim_keys
            assert any("全身套装" in w for w in ir.warnings)

            conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            conn.execute("PRAGMA journal_mode = DELETE;")
            db.close()
