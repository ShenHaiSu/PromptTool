"""
数据访问层：各表的 CRUD 封装。
所有方法返回 engine.models 中的 dataclass 实例。
"""
from __future__ import annotations
import sqlite3
import uuid
import time
import logging
from typing import Optional
from engine.models import Dimension, Module, Tag

log = logging.getLogger(__name__)


def _now() -> int:
    return int(time.time())


def _uuid() -> str:
    return str(uuid.uuid4())


class DimensionRepository:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def get_all(self) -> list[Dimension]:
        rows = self._conn.execute(
            "SELECT * FROM dimensions WHERE is_deleted = 0 ORDER BY sort_order"
        ).fetchall()
        return [self._row_to_dim(r) for r in rows]

    def get_by_key(self, key: str) -> Dimension | None:
        row = self._conn.execute(
            "SELECT * FROM dimensions WHERE key = ? AND is_deleted = 0", (key,)
        ).fetchone()
        return self._row_to_dim(row) if row else None

    def get_by_id(self, dim_id: str) -> Dimension | None:
        row = self._conn.execute(
            "SELECT * FROM dimensions WHERE id = ? AND is_deleted = 0", (dim_id,)
        ).fetchone()
        return self._row_to_dim(row) if row else None

    def create(self, key: str, name_cn: str, name_en: str,
               sort_order: int, is_multi_select: bool = False) -> Dimension:
        dim_id = _uuid()
        ts = _now()
        self._conn.execute(
            "INSERT INTO dimensions (id, key, name_cn, name_en, sort_order, "
            "is_multi_select, is_enabled, icon, created_at, updated_at, is_deleted) "
            "VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, 0)",
            (dim_id, key, name_cn, name_en, sort_order, int(is_multi_select), ts, ts)
        )
        self._conn.commit()
        return Dimension(id=dim_id, key=key, name_cn=name_cn, name_en=name_en,
                        sort_order=sort_order, is_multi_select=is_multi_select,
                        is_enabled=True)

    @staticmethod
    def _row_to_dim(row: sqlite3.Row) -> Dimension:
        return Dimension(
            id=row["id"], key=row["key"], name_cn=row["name_cn"],
            name_en=row["name_en"] or "", sort_order=row["sort_order"],
            is_multi_select=bool(row["is_multi_select"]),
            is_enabled=bool(row["is_enabled"]),
            icon=row["icon"],
        )


class ModuleRepository:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def get_by_dimension(self, dimension_id: str) -> list[Module]:
        rows = self._conn.execute(
            "SELECT m.*, d.key as dim_key FROM modules m "
            "JOIN dimensions d ON m.dimension_id = d.id "
            "WHERE m.dimension_id = ? AND m.is_deleted = 0 "
            "ORDER BY m.created_at",
            (dimension_id,)
        ).fetchall()
        return [self._row_to_mod(r) for r in rows]

    def get_all_grouped(self) -> dict[str, list[Module]]:
        """返回 {dimension_key: [Module, ...]} 映射。"""
        rows = self._conn.execute(
            "SELECT m.*, d.key as dim_key FROM modules m "
            "JOIN dimensions d ON m.dimension_id = d.id "
            "WHERE m.is_deleted = 0 ORDER BY d.sort_order, m.created_at"
        ).fetchall()
        result: dict[str, list[Module]] = {}
        for r in rows:
            mod = self._row_to_mod(r)
            result.setdefault(mod.dimension_key or "", []).append(mod)
        return result

    def search(self, keyword: str) -> list[Module]:
        """LIKE 模糊搜索。"""
        pattern = f"%{keyword}%"
        rows = self._conn.execute(
            "SELECT m.*, d.key as dim_key FROM modules m "
            "JOIN dimensions d ON m.dimension_id = d.id "
            "WHERE m.is_deleted = 0 AND "
            "(m.content_en LIKE ? OR m.display_name LIKE ? OR m.notes LIKE ?) "
            "ORDER BY m.created_at",
            (pattern, pattern, pattern)
        ).fetchall()
        return [self._row_to_mod(r) for r in rows]

    def get_by_id(self, module_id: str) -> Module | None:
        row = self._conn.execute(
            "SELECT m.*, d.key as dim_key FROM modules m "
            "JOIN dimensions d ON m.dimension_id = d.id "
            "WHERE m.id = ? AND m.is_deleted = 0",
            (module_id,)
        ).fetchone()
        return self._row_to_mod(row) if row else None

    def create(self, dimension_id: str, content_en: str,
               display_name: str, weight: float = 1.0,
               notes: str | None = None, is_nsfw: bool = False) -> Module:
        mod_id = _uuid()
        ts = _now()
        self._conn.execute(
            "INSERT INTO modules (id, dimension_id, content_en, display_name, "
            "weight, is_enabled, is_nsfw, usage_count, notes, created_at, updated_at, is_deleted) "
            "VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, ?, ?, 0)",
            (mod_id, dimension_id, content_en, display_name, weight,
             int(is_nsfw), notes, ts, ts)
        )
        self._conn.commit()
        dim = self._conn.execute(
            "SELECT key FROM dimensions WHERE id = ?", (dimension_id,)
        ).fetchone()
        dim_key = dim["key"] if dim else None
        return Module(id=mod_id, dimension_id=dimension_id,
                      content_en=content_en, display_name=display_name,
                      weight=weight, is_nsfw=is_nsfw, notes=notes,
                      dimension_key=dim_key)

    def update(self, mod: Module):
        ts = _now()
        self._conn.execute(
            "UPDATE modules SET content_en=?, display_name=?, weight=?, "
            "is_enabled=?, is_nsfw=?, notes=?, updated_at=? WHERE id=?",
            (mod.content_en, mod.display_name, mod.weight,
             int(mod.is_enabled), int(mod.is_nsfw), mod.notes, ts, mod.id)
        )
        self._conn.commit()

    def soft_delete(self, module_id: str):
        self._conn.execute(
            "UPDATE modules SET is_deleted=1, updated_at=? WHERE id=?",
            (_now(), module_id)
        )
        self._conn.commit()

    def increment_usage(self, module_id: str):
        self._conn.execute(
            "UPDATE modules SET usage_count = usage_count + 1 WHERE id=?",
            (module_id,)
        )
        self._conn.commit()

    @staticmethod
    def _row_to_mod(row: sqlite3.Row) -> Module:
        return Module(
            id=row["id"], dimension_id=row["dimension_id"],
            content_en=row["content_en"], display_name=row["display_name"] or "",
            weight=row["weight"], is_enabled=bool(row["is_enabled"]),
            is_nsfw=bool(row["is_nsfw"]) if "is_nsfw" in row.keys() else False,
            usage_count=row["usage_count"],
            example_image=row["example_image"],
            notes=row["notes"],
            dimension_key=row["dim_key"] if "dim_key" in row.keys() else None,
        )


class TagRepository:
    """标签表 CRUD。"""

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def get_all(self) -> list[Tag]:
        rows = self._conn.execute(
            "SELECT * FROM tags WHERE is_deleted = 0 ORDER BY name"
        ).fetchall()
        return [Tag(id=r["id"], name=r["name"], color=r["color"]) for r in rows]


class RuleRepository:
    """规则表 CRUD。"""

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def get_all_enabled(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM rules WHERE is_enabled = 1 AND is_deleted = 0"
        ).fetchall()
        return [dict(r) for r in rows]
