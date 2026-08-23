"""
预置数据初始化。
首次启动时调用，插入 14 维 + 示例条目 + 3 规则。存量库增量迁移亦幂等。
"""
from __future__ import annotations
import sqlite3
import time
import logging

log = logging.getLogger(__name__)

# 已知 NSFW 条目 ID：11 维旧第 15 条 + 33 条新增 NSFW（gender/height/ethnicity 不含 NSFW）
# 旧 gender_15 已去标（重构后不再为 NSFW）
NSFW_MODULE_IDS = {
    # 旧 11 维各 1 条（第 15 条）
    "mod_body_15",
    "mod_face_15",
    "mod_top_15",
    "mod_bottom_15",
    "mod_outfit_15",
    "mod_shoes_15",
    "mod_accessories_15",
    "mod_pose_15",
    "mod_props_15",
    "mod_background_15",
    "mod_camera_15",
    # 新增 33 条：11 维各 3 条（26/27/28）
    "mod_body_26", "mod_body_27", "mod_body_28",
    "mod_face_26", "mod_face_27", "mod_face_28",
    "mod_top_26", "mod_top_27", "mod_top_28",
    "mod_bottom_26", "mod_bottom_27", "mod_bottom_28",
    "mod_outfit_26", "mod_outfit_27", "mod_outfit_28",
    "mod_shoes_26", "mod_shoes_27", "mod_shoes_28",
    "mod_accessories_26", "mod_accessories_27", "mod_accessories_28",
    "mod_pose_26", "mod_pose_27", "mod_pose_28",
    "mod_props_26", "mod_props_27", "mod_props_28",
    "mod_background_26", "mod_background_27", "mod_background_28",
    "mod_camera_26", "mod_camera_27", "mod_camera_28",
}


def mark_nsfw_modules(conn: sqlite3.Connection):
    """标记已知 NSFW 条目。幂等操作——可重复调用。"""
    conn.executemany(
        "UPDATE modules SET is_nsfw = 1 WHERE id = ?",
        [(mid,) for mid in NSFW_MODULE_IDS],
    )
    # gender_15 重构后不再为 NSFW，显式去标
    conn.execute("UPDATE modules SET is_nsfw = 0 WHERE id = 'mod_gender_15'")
    conn.commit()
    log.info("已标记 %d 条 NSFW 条目。", len(NSFW_MODULE_IDS))


TARGET_ORDER: dict[str, int] = {
    "gender": 1, "ethnicity": 2, "height": 3,
    "body": 4, "face": 5, "top": 6, "bottom": 7, "outfit": 8,
    "shoes": 9, "accessories": 10, "pose": 11, "props": 12,
    "background": 13, "camera": 14,
}

# 需禁用的性别旧条目（重构后仅保留 01~10，11~15 下线）
DISABLED_GENDER_IDS = {
    "mod_gender_11", "mod_gender_12", "mod_gender_13",
    "mod_gender_14", "mod_gender_15",
}


def _all_dimensions() -> list[tuple[str, str, str, str, int, int]]:
    return [
        ("dim_01", "body", "模特身材特点", "Body", TARGET_ORDER["body"], 0),
        ("dim_02", "face", "模特面部特点", "Face", TARGET_ORDER["face"], 0),
        ("dim_03", "top", "模特上装", "Top", TARGET_ORDER["top"], 0),
        ("dim_04", "bottom", "模特下装", "Bottom", TARGET_ORDER["bottom"], 0),
        ("dim_05", "outfit", "模特全身套装", "Outfit", TARGET_ORDER["outfit"], 0),
        ("dim_06", "shoes", "模特鞋袜", "Shoes", TARGET_ORDER["shoes"], 0),
        ("dim_07", "accessories", "模特配饰", "Accessories", TARGET_ORDER["accessories"], 1),
        ("dim_08", "pose", "模特姿势", "Pose", TARGET_ORDER["pose"], 0),
        ("dim_09", "props", "交互物品", "Props", TARGET_ORDER["props"], 0),
        ("dim_10", "background", "背景风格", "Background", TARGET_ORDER["background"], 0),
        ("dim_11", "camera", "相机参数", "Camera", TARGET_ORDER["camera"], 0),
        ("dim_12", "gender", "模特性别", "Gender", TARGET_ORDER["gender"], 0),
        ("dim_13", "ethnicity", "模特人种", "Ethnicity", TARGET_ORDER["ethnicity"], 0),
        ("dim_14", "height", "模特身高", "Height", TARGET_ORDER["height"], 0),
    ]


def ensure_dimensions(conn: sqlite3.Connection) -> int:
    """幂等插入 14 维（INSERT OR IGNORE）并纠偏排序。返回新增数（近似）。"""
    ts = int(time.time())
    before = conn.execute("SELECT count(*) FROM dimensions WHERE is_deleted=0").fetchone()[0]
    for d_id, key, name_cn, name_en, order, multi in _all_dimensions():
        conn.execute(
            "INSERT OR IGNORE INTO dimensions "
            "(id, key, name_cn, name_en, sort_order, is_multi_select, "
            "is_enabled, icon, created_at, updated_at, is_deleted) "
            "VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, 0)",
            (d_id, key, name_cn, name_en, order, multi, ts, ts),
        )
    # 存量库排序纠偏（幂等）
    for key, order in TARGET_ORDER.items():
        conn.execute(
            "UPDATE dimensions SET sort_order=?, updated_at=? WHERE key=? AND sort_order!=?",
            (order, ts, key, order),
        )
    conn.commit()
    after = conn.execute("SELECT count(*) FROM dimensions WHERE is_deleted=0").fetchone()[0]
    added = after - before
    if added:
        log.info("增量补齐 %d 个维度。", added)
    return added


def disable_deprecated_gender_modules(conn: sqlite3.Connection) -> int:
    """禁用重构后下线的性别条目（11~15）。幂等。"""
    ts = int(time.time())
    placeholders = ",".join("?" for _ in DISABLED_GENDER_IDS)
    cur = conn.execute(
        f"UPDATE modules SET is_enabled=0, updated_at=? WHERE id IN ({placeholders}) AND is_deleted=0 AND is_enabled=1",
        (ts, *sorted(DISABLED_GENDER_IDS)),
    )
    conn.commit()
    if cur.rowcount:
        log.info("已禁用 %d 条性别旧条目。", cur.rowcount)
    return cur.rowcount


def repair_display_names(conn: sqlite3.Connection) -> int:
    """对 display_name == content_en 的行按映射表批量修复。返回修复数。"""
    try:
        from db.display_names import DISPLAY_NAMES
    except ImportError:
        try:
            from src.db.display_names import DISPLAY_NAMES  # type: ignore
        except ImportError:
            log.warning("DISPLAY_NAMES 未找到，跳过中文名修复。")
            return 0
    fixed = 0
    ts = int(time.time())
    for mod_id, cn in DISPLAY_NAMES.items():
        row = conn.execute("SELECT display_name, content_en FROM modules WHERE id=?", (mod_id,)).fetchone()
        if row and row["display_name"] == row["content_en"]:
            conn.execute("UPDATE modules SET display_name=?, updated_at=? WHERE id=?", (cn, ts, mod_id))
            fixed += 1
    if fixed:
        conn.commit()
        log.info("已修复 %d 条中文显示名。", fixed)
    return fixed


def seed_data(conn: sqlite3.Connection, sample_prompt_dir: str | None = None):
    """插入预置数据。幂等操作——已存在的数据跳过。"""
    ts = int(time.time())

    ensure_dimensions(conn)

    # 条目：从 samplePrompt 目录导入（311 条）
    from db.sample_importer import import_sample_prompts
    if sample_prompt_dir:
        import_count = import_sample_prompts(conn, sample_prompt_dir)
        if import_count == 0:
            # 若导入为空且库为空（极少样本缺失），回退内置
            existing = conn.execute("SELECT count(*) FROM modules WHERE is_deleted=0").fetchone()[0]
            if existing == 0:
                log.warning("samplePrompt 导入 0 条，将回退到内置示例条目。")
                _seed_fallback_modules(conn, ts)
    else:
        _seed_fallback_modules(conn, ts)

    # 修复存量中文名（对 INSERT OR IGNORE 已存在行）
    repair_display_names(conn)

    # 3 条预置规则
    rules = [
        ("rule_01", "套装互斥", "mutex",
         "dim_05", None, "dim_03", None,
         "已选全身套装，上装/下装将自动忽略"),
        ("rule_02", "鞋袜与赤脚互斥", "mutex",
         "dim_06", "mod_shoes_15", "dim_06", None,
         "赤脚与鞋袜不可共存"),
        ("rule_03", "室内外背景互斥", "excludes",
         "dim_10", "mod_bg_01", "dim_10", None,
         "室内背景与户外背景冲突"),
    ]
    for r in rules:
        conn.execute(
            "INSERT OR IGNORE INTO rules "
            "(id, name, type, source_dimension_id, source_module_id, "
            "target_dimension_id, target_module_id, message, "
            "is_enabled, created_at, is_deleted) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0)",
            (*r, ts),
        )

    conn.commit()
    mark_nsfw_modules(conn)
    disable_deprecated_gender_modules(conn)
    log.info("种子数据预置完成：14 维度 + 条目 + 3 规则。")


def _seed_fallback_modules(conn: sqlite3.Connection, ts: int):
    """当 samplePrompt 目录不可用时，回退到内置 33 条示例条目。"""
    modules = [
        ("mod_body_01", "dim_01", "slim waist, long legs, hourglass figure", "纤细沙漏型", 1.0),
        ("mod_body_02", "dim_01", "petite, small frame", "娇小玲珑型", 0.9),
        ("mod_body_03", "dim_01", "tall, athletic build, toned legs", "高挑运动型", 1.1),
        ("mod_face_01", "dim_02", "oval face, almond eyes, natural makeup", "鹅蛋脸自然妆", 1.0),
        ("mod_face_02", "dim_02", "round face, big eyes, soft smile", "圆脸大眼", 1.0),
        ("mod_face_03", "dim_02", "sharp jawline, fox eyes, red lips", "锐利轮廓狐眼", 1.2),
        ("mod_top_01", "dim_03", "oversized white shirt, rolled sleeves", "宽松白衬衫卷袖", 1.0),
        ("mod_top_02", "dim_03", "cropped knit cardigan, beige", "短款针织开衫米色", 1.0),
        ("mod_top_03", "dim_03", "black turtleneck sweater", "黑色高领毛衣", 0.9),
        ("mod_bottom_01", "dim_04", "high-waisted pleated skirt, navy", "高腰百褶裙海军蓝", 1.0),
        ("mod_bottom_02", "dim_04", "wide-leg jeans, light wash", "宽腿牛仔裤浅色", 1.0),
        ("mod_bottom_03", "dim_04", "black leather mini skirt", "黑色皮短裙", 1.1),
        ("mod_outfit_01", "dim_05", "red bodycon dress", "红色紧身连衣裙", 1.0),
        ("mod_outfit_02", "dim_05", "denim jumpsuit", "牛仔连体裤", 1.0),
        ("mod_outfit_03", "dim_05", "white summer sundress", "白色夏季连衣裙", 1.0),
        ("mod_shoes_01", "dim_06", "white sneakers", "白色运动鞋", 1.0),
        ("mod_shoes_02", "dim_06", "black over-knee socks", "黑色过膝袜", 1.0),
        ("mod_shoes_15", "dim_06", "barefoot", "赤脚", 0.8),
        ("mod_acc_01", "dim_07", "gold hoop earrings", "金色圈耳环", 1.0),
        ("mod_acc_02", "dim_07", "mini shoulder bag, cream", "迷你单肩包米色", 1.0),
        ("mod_acc_03", "dim_07", "silver pendant necklace", "银色吊坠项链", 1.0),
        ("mod_pose_01", "dim_08", "standing with hands in pockets", "站立手插口袋", 1.0),
        ("mod_pose_02", "dim_08", "sitting sideways, legs crossed", "侧坐翘腿", 1.0),
        ("mod_pose_03", "dim_08", "leaning against wall, arms folded", "靠墙抱臂", 1.1),
        ("mod_props_01", "dim_09", "holding coffee cup", "手持咖啡杯", 1.0),
        ("mod_props_02", "dim_09", "leaning on railing", "倚靠栏杆", 1.0),
        ("mod_props_03", "dim_09", "holding bouquet of flowers", "手持花束", 1.0),
        ("mod_bg_01", "dim_10", "minimalist studio, white backdrop", "极简棚拍白底", 1.0),
        ("mod_bg_02", "dim_10", "cherry blossom street, soft sunlight", "樱花街道柔光", 1.2),
        ("mod_bg_03", "dim_10", "urban rooftop at sunset", "城市天台日落", 1.0),
        ("mod_cam_01", "dim_11", "85mm lens, shallow depth of field, soft lighting", "85mm人像浅景深柔光", 1.0),
        ("mod_cam_02", "dim_11", "35mm wide angle, natural light", "35mm广角自然光", 1.0),
        ("mod_cam_03", "dim_11", "fisheye lens, dramatic perspective", "鱼眼戏剧透视", 0.8),
    ]
    for m_id, dim_id, content, name, weight in modules:
        conn.execute(
            "INSERT OR REPLACE INTO modules "
            "(id, dimension_id, content_en, display_name, weight, "
            "is_enabled, usage_count, example_image, notes, "
            "created_at, updated_at, is_deleted) "
            "VALUES (?, ?, ?, ?, ?, 1, 0, NULL, NULL, ?, ?, 0)",
            (m_id, dim_id, content, name, weight, ts, ts),
        )
    log.info("回退到内置 %d 条示例条目。", len(modules))
