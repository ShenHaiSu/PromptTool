"""
数据库连接管理：单例模式，WAL 模式，写入前自动备份。
"""
from __future__ import annotations
import sqlite3
import shutil
import time
import logging
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)


class DatabaseConnection:
    """SQLite 连接管理器。

    职责：
    - 初始化数据库（执行 schema.sql）
    - 开启 WAL 模式与外键约束
    - 写入前自动备份（保留最近 10 份）
    - 提供 get_connection() 供 Repository 使用
    """

    MAX_BACKUPS = 10

    def __init__(self, db_path: str, schema_path: Optional[str] = None):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.schema_path = schema_path
        self._conn: Optional[sqlite3.Connection] = None
        self._initialize()

    def _initialize(self):
        """初始化数据库：不存在则建表，已存在则执行迁移。"""
        is_new = not self.db_path.exists()
        self._conn = sqlite3.connect(str(self.db_path))
        self._conn.row_factory = sqlite3.Row  # 行以字典方式访问
        self._conn.execute("PRAGMA journal_mode = WAL;")
        self._conn.execute("PRAGMA foreign_keys = ON;")
        if is_new and self.schema_path:
            schema = Path(self.schema_path).read_text(encoding="utf-8")
            self._conn.executescript(schema)
            self._conn.commit()
            log.info("数据库初始化完成，已执行建表脚本。")

        # 存量库迁移（新建库已包含最新列，跳过）
        self._migrate()

    def _migrate(self):
        """存量库迁移：为 modules 表补充 is_nsfw 列。"""
        cols = [r[1] for r in self._conn.execute("PRAGMA table_info(modules)").fetchall()]
        if "is_nsfw" not in cols:
            self._conn.execute(
                "ALTER TABLE modules ADD COLUMN is_nsfw INTEGER NOT NULL DEFAULT 0"
            )
            self._conn.commit()
            log.info("迁移：modules 表新增 is_nsfw 列。")

    def get_connection(self) -> sqlite3.Connection:
        return self._conn  # type: ignore[return-value]

    def backup_before_write(self):
        """写入前备份到 backups/ 目录，保留最近 MAX_BACKUPS 份。"""
        backup_dir = self.db_path.parent / "backups"
        backup_dir.mkdir(exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        dest = backup_dir / f"pmf_{ts}.db"
        shutil.copy2(self.db_path, dest)
        # 清理过期备份
        backups = sorted(backup_dir.glob("pmf_*.db"))
        for old in backups[:-self.MAX_BACKUPS]:
            old.unlink()

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None
