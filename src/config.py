"""
全局配置：数据库路径、默认拼装配置、窗口尺寸、备份策略。
"""
from pathlib import Path
import sys

# 项目根目录
PROJECT_ROOT = Path(__file__).parent.parent
SRC_ROOT = PROJECT_ROOT / "src"
DATA_DIR = PROJECT_ROOT / "data"
DB_PATH = DATA_DIR / "pmf.db"
SCHEMA_PATH = SRC_ROOT / "db" / "schema.sql"

# 示例提示词目录
SAMPLE_PROMPT_DIR = PROJECT_ROOT / "docs" / "samplePrompt"
BACKUP_DIR = DATA_DIR / "backups"

# 窗口配置（P02）
WINDOW_TITLE = "Prompt Modular Factory — 正式版"
WINDOW_SIZE = "1600x1080"
WINDOW_MIN_SIZE = (1280, 720)
TOPBAR_HEIGHT_COLLAPSED = 88
TOPBAR_HEIGHT_EXPANDED = 168
LAYOUT_WEIGHTS = {"left": 30, "center": 38, "right": 32}
SIDEBAR_WIDTH = {"min": 260, "default": 320, "max": 420}
THEME_DEFAULT = "light"
PMF_JSON = DATA_DIR / "pmf.json"

# 默认拼装配置
DEFAULT_SEPARATOR = ", "
DEFAULT_USE_WEIGHT_BRACKETS = True
DEFAULT_MODEL_PROFILE = "sd"
DEFAULT_SORT_BY = "dimensionOrder"

# 备份策略
MAX_BACKUPS = 10

# 随机引擎
MAX_BATCH_SIZE = 500
MAX_RANDOM_ATTEMPTS_MULTIPLIER = 10  # count * 10

# 权重范围
WEIGHT_MIN = 0.5
WEIGHT_MAX = 2.0
WEIGHT_STEP = 0.1


def get_resource_path(relative_path: str) -> str:
    """兼容 PyInstaller 打包后的资源路径。"""
    if hasattr(sys, '_MEIPASS'):
        return str(Path(sys._MEIPASS) / relative_path)
    return str(SRC_ROOT / relative_path)
