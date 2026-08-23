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
from engine.models import (
    Dimension, Module, Tag,
    Assembly, AssemblyItemRow, Template,
    SelectedItem, AssemblyConfig, PromptIR, IRSegment,
)

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


# ------------------------------------------------------------------
# P0-01 历史·收藏·一键复用 仓储
# ------------------------------------------------------------------
class AssemblyRepository:
    """assemblies + assembly_items 原子读写。"""

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    # ---- 写 ----

    def save(
        self,
        title: str | None,
        ir: PromptIR,
        final_prompt: str,
        config: AssemblyConfig,
        items: list[SelectedItem],
        is_favorite: bool = False,
    ) -> str:
        """原子写入 assemblies + assembly_items，返回 assembly_id。"""
        import json as _json

        aid = _uuid()
        ts = _now()
        # title 为空时自动生成
        if not title:
            short = (final_prompt[:30] + "...") if len(final_prompt) > 30 else final_prompt
            ymd = time.strftime("%Y-%m-%d", time.localtime(ts))
            title = f"{ymd} · {short}" if short else f"{ymd} · (空方案)"

        ir_json = _json.dumps(
            {"segments": [
                {"dimension_key": s.dimension_key, "text": s.text,
                 "weight": s.weight, "source_module_id": s.source_module_id}
                for s in ir.segments
            ], "warnings": ir.warnings},
            ensure_ascii=False,
        )

        try:
            self._conn.execute("BEGIN IMMEDIATE")
            self._conn.execute(
                "INSERT INTO assemblies (id, title, prompt_ir, final_prompt, model_profile, created_at, is_favorite, is_deleted) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
                (aid, title, ir_json, final_prompt, config.model_profile, ts, int(is_favorite)),
            )
            for idx, it in enumerate(items):
                w = it.weight_override
                self._conn.execute(
                    "INSERT INTO assembly_items (id, assembly_id, module_id, sort_order, weight_override, is_locked) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (_uuid(), aid, it.module.id, idx, w, int(it.locked)),
                )
            self._conn.commit()
        except Exception:
            try:
                self._conn.rollback()
            except Exception:
                pass
            raise
        return aid

    def save_from_ir(
        self,
        ir: PromptIR,
        final_prompt: str,
        config: AssemblyConfig,
        is_favorite: bool = False,
        title: str | None = None,
    ) -> str:
        """由 BatchCard 直接保存单条（无 SelectedItem 明细时用 ir 快照反推 assembly_items）。"""
        # 反推 items：仅保留 module_id/weight，locked 默认为 False
        # 若 module 已不存在仍可入库（外键仅约束存在时，存量库 foreign_keys 已开启但此处按快照写入）
        # 为避免外键失败，先尝试按 ir.segments 写入，缺失 module 的行跳过并记录警告
        import json as _json

        aid = _uuid()
        ts = _now()
        if not title:
            short = (final_prompt[:30] + "...") if len(final_prompt) > 30 else final_prompt
            ymd = time.strftime("%Y-%m-%d", time.localtime(ts))
            title = f"{ymd} · {short}" if short else f"{ymd} · (空方案)"
        ir_json = _json.dumps(
            {"segments": [
                {"dimension_key": s.dimension_key, "text": s.text,
                 "weight": s.weight, "source_module_id": s.source_module_id}
                for s in ir.segments
            ], "warnings": ir.warnings},
            ensure_ascii=False,
        )
        try:
            self._conn.execute("BEGIN IMMEDIATE")
            self._conn.execute(
                "INSERT INTO assemblies (id, title, prompt_ir, final_prompt, model_profile, created_at, is_favorite, is_deleted) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
                (aid, title, ir_json, final_prompt, config.model_profile, ts, int(is_favorite)),
            )
            for idx, seg in enumerate(ir.segments):
                # 仅当 module 真实存在时写入明细，避免外键失败
                # 放宽：若没有任何可关联 module，此 assembly 仍保留（items 为空）
                exists = self._conn.execute(
                    "SELECT 1 FROM modules WHERE id = ?", (seg.source_module_id,)
                ).fetchone()
                if exists is None:
                    continue
                w = None if seg.weight == 1.0 else seg.weight
                self._conn.execute(
                    "INSERT INTO assembly_items (id, assembly_id, module_id, sort_order, weight_override, is_locked) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (_uuid(), aid, seg.source_module_id, idx, w, 0),
                )
            self._conn.commit()
        except Exception:
            try:
                self._conn.rollback()
            except Exception:
                pass
            raise
        return aid

    def save_batch(
        self,
        rows: list[tuple[str | None, PromptIR, str, AssemblyConfig, list[SelectedItem]]],
    ) -> list[str]:
        """批量随机结果一键入库（可选，复用 save 事务细粒度）。"""
        ids: list[str] = []
        for title, ir, final_prompt, config, items in rows:
            ids.append(self.save(title, ir, final_prompt, config, items))
        return ids

    # ---- 读 ----

    def list_recent(self, limit: int = 20, offset: int = 0) -> list[Assembly]:
        rows = self._conn.execute(
            "SELECT * FROM assemblies WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        return [self._row_to_assembly(r) for r in rows]

    def list_favorites(self, limit: int = 100) -> list[Assembly]:
        rows = self._conn.execute(
            "SELECT * FROM assemblies WHERE is_deleted = 0 AND is_favorite = 1 ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [self._row_to_assembly(r) for r in rows]

    def search(self, keyword: str, limit: int = 50) -> list[Assembly]:
        pattern = f"%{keyword}%"
        rows = self._conn.execute(
            "SELECT * FROM assemblies WHERE is_deleted = 0 AND "
            "(title LIKE ? OR final_prompt LIKE ? OR prompt_ir LIKE ?) "
            "ORDER BY created_at DESC LIMIT ?",
            (pattern, pattern, pattern, limit),
        ).fetchall()
        return [self._row_to_assembly(r) for r in rows]

    def get(self, assembly_id: str) -> Assembly | None:
        row = self._conn.execute(
            "SELECT * FROM assemblies WHERE id = ? AND is_deleted = 0", (assembly_id,)
        ).fetchone()
        return self._row_to_assembly(row) if row else None

    def get_items(self, assembly_id: str) -> list[AssemblyItemRow]:
        rows = self._conn.execute(
            "SELECT * FROM assembly_items WHERE assembly_id = ? ORDER BY sort_order",
            (assembly_id,),
        ).fetchall()
        return [
            AssemblyItemRow(
                id=r["id"], assembly_id=r["assembly_id"], module_id=r["module_id"],
                sort_order=r["sort_order"], weight_override=r["weight_override"],
                is_locked=bool(r["is_locked"]),
            )
            for r in rows
        ]

    def load_selected_items(self, assembly_id: str) -> list[SelectedItem]:
        """JOIN modules/dimensions 还原 SelectedItem；已软删的 module 用快照占位并标记。"""
        import json as _json

        asm = self.get(assembly_id)
        if asm is None:
            return []
        # 快照文本映射 module_id -> text/dim_key
        snapshot_map: dict[str, dict] = {}
        try:
            data = _json.loads(asm.prompt_ir_json) if asm.prompt_ir_json else {}
            for seg in data.get("segments", []):
                snapshot_map[seg.get("source_module_id")] = seg
        except Exception:
            pass

        rows = self._conn.execute(
            "SELECT ai.*, m.content_en, m.display_name, m.weight as mod_weight, "
            "m.is_deleted as mod_deleted, m.dimension_id, d.key as dim_key "
            "FROM assembly_items ai "
            "LEFT JOIN modules m ON m.id = ai.module_id "
            "LEFT JOIN dimensions d ON d.id = m.dimension_id "
            "WHERE ai.assembly_id = ? ORDER BY ai.sort_order",
            (assembly_id,),
        ).fetchall()

        result: list[SelectedItem] = []
        for r in rows:
            mid = r["module_id"]
            snap = snapshot_map.get(mid, {})
            # 若 JOIN 未命中或已软删，用快照占位
            if r["content_en"] is None or r["mod_deleted"] == 1:
                text = snap.get("text") or snap.get("content_en") or f"[已失效:{mid[:8]}]"
                dim_key = snap.get("dimension_key") or snap.get("dim_key") or ""
                mod = Module(
                    id=mid,
                    dimension_id=r["dimension_id"] or snap.get("dimension_id", ""),
                    content_en=text,
                    display_name=f"[已失效] {text[:20]}",
                    weight=snap.get("weight", 1.0),
                    is_enabled=False,
                    dimension_key=dim_key,
                    notes="[原条目已删除，已用快照占位]",
                )
            else:
                mod = Module(
                    id=mid,
                    dimension_id=r["dimension_id"],
                    content_en=r["content_en"],
                    display_name=r["display_name"] or "",
                    weight=r["mod_weight"] if r["mod_weight"] is not None else 1.0,
                    is_enabled=True,
                    dimension_key=r["dim_key"],
                )
            result.append(SelectedItem(
                module=mod,
                weight_override=r["weight_override"],
                locked=bool(r["is_locked"]),
            ))

        # 若 assembly_items 为空但快照有 segments（save_from_ir 场景），用快照兜底
        if not result and snapshot_map:
            try:
                data = _json.loads(asm.prompt_ir_json)
                for seg in data.get("segments", []):
                    mid = seg.get("source_module_id", "")
                    text = seg.get("text", "")
                    dim_key = seg.get("dimension_key", "")
                    mod = Module(
                        id=mid or f"snap_{len(result)}",
                        dimension_id="",
                        content_en=text,
                        display_name=text[:20] or "[快照]",
                        weight=seg.get("weight", 1.0),
                        is_enabled=False,
                        dimension_key=dim_key,
                        notes="[快照还原]",
                    )
                    w = seg.get("weight")
                    result.append(SelectedItem(module=mod, weight_override=None if w == 1.0 else w, locked=False))
            except Exception:
                pass

        return result

    def count_all(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) as c FROM assemblies WHERE is_deleted = 0").fetchone()
        return int(row["c"]) if row else 0

    def count_favorites(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) as c FROM assemblies WHERE is_deleted = 0 AND is_favorite = 1").fetchone()
        return int(row["c"]) if row else 0

    # ---- 改 ----

    def toggle_favorite(self, assembly_id: str) -> bool:
        row = self._conn.execute("SELECT is_favorite FROM assemblies WHERE id = ?", (assembly_id,)).fetchone()
        if row is None:
            return False
        new_val = 0 if row["is_favorite"] else 1
        self._conn.execute("UPDATE assemblies SET is_favorite = ? WHERE id = ?", (new_val, assembly_id))
        self._conn.commit()
        return bool(new_val)

    def rename(self, assembly_id: str, title: str) -> None:
        self._conn.execute("UPDATE assemblies SET title = ? WHERE id = ?", (title, assembly_id))
        self._conn.commit()

    def soft_delete(self, assembly_id: str) -> None:
        self._conn.execute("UPDATE assemblies SET is_deleted = 1 WHERE id = ?", (assembly_id,))
        self._conn.commit()

    def soft_delete_many(self, ids: list[str]) -> int:
        if not ids:
            return 0
        placeholders = ",".join("?" for _ in ids)
        cur = self._conn.execute(
            f"UPDATE assemblies SET is_deleted = 1 WHERE id IN ({placeholders})", ids
        )
        self._conn.commit()
        return cur.rowcount

    @staticmethod
    def _row_to_assembly(row: sqlite3.Row) -> Assembly:
        return Assembly(
            id=row["id"], title=row["title"], prompt_ir_json=row["prompt_ir"] or "",
            final_prompt=row["final_prompt"] or "", model_profile=row["model_profile"] or "sd",
            created_at=row["created_at"], is_favorite=bool(row["is_favorite"]),
            is_deleted=bool(row["is_deleted"]),
        )


class TemplateRepository:
    """templates 表 CRUD。"""

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def save(
        self,
        name: str,
        description: str | None,
        config: AssemblyConfig,
        enabled_keys: list[str],
        cover_prompt: str | None,
    ) -> str:
        import json as _json
        tid = _uuid()
        ts = _now()
        payload = {
            "assembly_config": {
                "separator": config.separator,
                "use_weight_brackets": config.use_weight_brackets,
                "model_profile": config.model_profile,
                "sort_by": config.sort_by,
            },
            "enabled_dimension_keys": enabled_keys,
            "version": 1,
        }
        config_json = _json.dumps(payload, ensure_ascii=False)
        self._conn.execute(
            "INSERT INTO templates (id, name, description, config_json, cover_prompt, created_at, is_deleted) "
            "VALUES (?, ?, ?, ?, ?, ?, 0)",
            (tid, name, description, config_json, cover_prompt, ts),
        )
        self._conn.commit()
        return tid

    def list_all(self) -> list[Template]:
        rows = self._conn.execute(
            "SELECT * FROM templates WHERE is_deleted = 0 ORDER BY created_at DESC"
        ).fetchall()
        return [self._row_to_template(r) for r in rows]

    def get(self, tid: str) -> Template | None:
        row = self._conn.execute(
            "SELECT * FROM templates WHERE id = ? AND is_deleted = 0", (tid,)
        ).fetchone()
        return self._row_to_template(row) if row else None

    def apply(self, tid: str) -> tuple[AssemblyConfig, list[str]]:
        """解析 config_json 返回 (AssemblyConfig, enabled_keys)。"""
        import json as _json
        row = self._conn.execute("SELECT config_json FROM templates WHERE id = ? AND is_deleted = 0", (tid,)).fetchone()
        if row is None or not row["config_json"]:
            return AssemblyConfig(), []
        try:
            data = _json.loads(row["config_json"])
            cfg = data.get("assembly_config", {})
            enabled = data.get("enabled_dimension_keys", [])
            ac = AssemblyConfig(
                separator=cfg.get("separator", ", "),
                use_weight_brackets=bool(cfg.get("use_weight_brackets", True)),
                model_profile=cfg.get("model_profile", "sd"),
                sort_by=cfg.get("sort_by", "dimensionOrder"),
            )
            return ac, list(enabled)
        except Exception:
            return AssemblyConfig(), []

    def rename(self, tid: str, name: str) -> None:
        self._conn.execute("UPDATE templates SET name = ? WHERE id = ?", (name, tid))
        self._conn.commit()

    def soft_delete(self, tid: str) -> None:
        self._conn.execute("UPDATE templates SET is_deleted = 1 WHERE id = ?", (tid,))
        self._conn.commit()

    @staticmethod
    def _row_to_template(row: sqlite3.Row) -> Template:
        return Template(
            id=row["id"], name=row["name"], description=row["description"],
            config_json=row["config_json"] or "", cover_prompt=row["cover_prompt"],
            created_at=row["created_at"], is_deleted=bool(row["is_deleted"]),
        )
