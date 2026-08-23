"""
PMF 正式版主入口。
启动 tkinter 主窗口，初始化数据库与引擎。
"""
from __future__ import annotations
import sys
import logging
from pathlib import Path

# 路径适配：将 src/ 加入 sys.path
sys.path.insert(0, str(Path(__file__).parent))

from config import (
    DB_PATH, SCHEMA_PATH, WINDOW_TITLE, WINDOW_SIZE, SAMPLE_PROMPT_DIR,
    WINDOW_MIN_SIZE,
)
from db.connection import DatabaseConnection
from db.seed import seed_data, mark_nsfw_modules, ensure_dimensions, repair_display_names, disable_deprecated_gender_modules
from db.sample_importer import import_sample_prompts
from db.repository import DimensionRepository
from ui.main_window import MainWindow
from ui.styles import apply_style  # noqa: F401 (保留供外部引用)

# 日志文件名已从 pmf_demo.log 更名为 pmf.log；此处做一次旧文件迁移
_legacy_log = Path(__file__).parent / "pmf_demo.log"
_new_log = Path(__file__).parent / "pmf.log"
if _legacy_log.exists() and not _new_log.exists():
    try:
        _legacy_log.rename(_new_log)
    except Exception:
        pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(str(_new_log), encoding="utf-8"),
    ],
)
log = logging.getLogger("app")


def main():
    log.info("启动 PMF 正式版...")

    # 初始化数据库（首次启动自动建表 + 预置数据）
    db = DatabaseConnection(str(DB_PATH), str(SCHEMA_PATH))
    conn = db.get_connection()

    dim_repo = DimensionRepository(conn)
    if len(dim_repo.get_all()) == 0:
        log.info("首次启动，预置种子数据...")
        seed_data(conn, str(SAMPLE_PROMPT_DIR))
        log.info("种子数据预置完成。")
    else:
        # 存量库增量升级：幂等补维度/条目/中文名/NSFW/性别下线
        log.info("存量库增量升级...")
        ensure_dimensions(conn)
        import_sample_prompts(conn, str(SAMPLE_PROMPT_DIR))
        repair_display_names(conn)
        mark_nsfw_modules(conn)
        disable_deprecated_gender_modules(conn)
        log.info("存量库升级完成。")

    conn.close()

    # 启动 UI（P02：768p 屏溢出保护 + 主题由 MainWindow 内部 pmf.json 决定）
    root = MainWindow(str(DB_PATH), str(SCHEMA_PATH))
    root.title(WINDOW_TITLE)
    # 900 高在 768p 溢出时回退 860
    try:
        sh = root.winfo_screenheight()
        if sh and sh < 900:
            root.geometry("1400x860")
        else:
            root.geometry(WINDOW_SIZE)
    except Exception:
        root.geometry(WINDOW_SIZE)
    try:
        root.minsize(*WINDOW_MIN_SIZE)
    except Exception:
        pass

    log.info("窗口已显示，进入主循环。")
    root.mainloop()
    log.info("程序退出。")


if __name__ == "__main__":
    main()
