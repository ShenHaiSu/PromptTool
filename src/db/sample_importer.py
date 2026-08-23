"""
从 samplePrompt 目录导入示例提示词到数据库。

目录结构约定：
  samplePrompt/
    body/body_01.txt          → 内容即英文提示词片段
    top/top_01.txt
    shoes/shoes_15.txt        → 含 "barefoot" 关键词
    background/background_01.txt → 含 "studio" 关键词
    ...

文件名规则：{dim_key}_{NN}.txt → 模块 ID 为 mod_{dim_key}_{NN}
display_name 优先取 display_names.DISPLAY_NAMES，无则回退 content。
已存在行：不覆盖用户已调的 weight/is_enabled/notes，仅在 display_name == content_en 时修复为中文。
"""
from __future__ import annotations
import sqlite3
import time
import logging
from pathlib import Path

log = logging.getLogger(__name__)

try:
    from db.display_names import DISPLAY_NAMES
except ImportError:
    try:
        from src.db.display_names import DISPLAY_NAMES  # type: ignore
    except ImportError:
        DISPLAY_NAMES: dict[str, str] = {}


def import_sample_prompts(conn: sqlite3.Connection, sample_dir) -> int:
    """从 sample_dir 读取提示词文件并导入 modules 表。

    幂等：INSERT OR IGNORE + 可选 UPDATE 修复中文名，避免覆盖用户权重/启禁用。
    """
    sample_path = Path(sample_dir)
    if not sample_path.exists():
        log.warning("示例提示词目录不存在: %s，跳过导入。", sample_dir)
        return 0

    rows = conn.execute(
        "SELECT id, key FROM dimensions WHERE is_deleted = 0"
    ).fetchall()
    dim_id_map = {r["key"]: r["id"] for r in rows}

    if not dim_id_map:
        log.warning("dimensions 表为空，请先预置维度数据。")
        return 0

    ts = int(time.time())
    count = 0

    for dim_key, dimension_id in sorted(dim_id_map.items(), key=lambda x: x[0]):
        dim_dir = sample_path / dim_key
        if not dim_dir.is_dir():
            log.debug("维度目录不存在，跳过: %s", dim_dir)
            continue

        for txt_file in sorted(dim_dir.glob("*.txt")):
            content = txt_file.read_text(encoding="utf-8").strip()
            if not content:
                continue

            stem = txt_file.stem
            num = stem.split("_")[-1]
            # 归一为两位：01
            num_2 = num.zfill(2) if len(num) < 2 else num[-2:]
            if len(num) == 1:
                num_2 = f"0{num}"
            else:
                # 保留原始两位数
                try:
                    num_2 = f"{int(num):02d}"
                except ValueError:
                    num_2 = num
            module_id = f"mod_{dim_key}_{num_2}"

            # 中文名：DISPLAY_NAMES 优先
            display_name = DISPLAY_NAMES.get(module_id, content)

            # 检查是否已存在
            existing = conn.execute(
                "SELECT display_name, content_en FROM modules WHERE id=?", (module_id,)
            ).fetchone()
            if existing is not None:
                # 已存在：仅在 display_name == content_en 时修复为中文（幂等修复）
                if existing["display_name"] == existing["content_en"] and display_name != content:
                    conn.execute(
                        "UPDATE modules SET display_name=?, content_en=?, updated_at=? WHERE id=?",
                        (display_name, content, ts, module_id),
                    )
                elif existing["content_en"] != content:
                    # content_en 变更时同步更新，但保留 display_name（除非仍为旧英文）
                    if existing["display_name"] == existing["content_en"]:
                        conn.execute(
                            "UPDATE modules SET content_en=?, display_name=?, updated_at=? WHERE id=?",
                            (content, display_name, ts, module_id),
                        )
                    else:
                        conn.execute(
                            "UPDATE modules SET content_en=?, updated_at=? WHERE id=?",
                            (content, ts, module_id),
                        )
                continue

            conn.execute(
                "INSERT OR IGNORE INTO modules "
                "(id, dimension_id, content_en, display_name, weight, "
                "is_enabled, usage_count, example_image, notes, "
                "created_at, updated_at, is_deleted) "
                "VALUES (?, ?, ?, ?, 1.0, 1, 0, NULL, NULL, ?, ?, 0)",
                (module_id, dimension_id, content, display_name, ts, ts),
            )
            count += 1

    conn.commit()
    log.info("从 samplePrompt 导入 %d 条新提示词（增量）。", count)
    return count
