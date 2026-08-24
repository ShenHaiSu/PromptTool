-- ============================================================
-- Prompt Modular Factory — 正式版 Schema
-- SQLite 3.x · WAL 模式 · 外键约束开启
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- dimensions — 维度表
-- 11 个一级维度，用户可自定义扩展
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dimensions (
    id                TEXT PRIMARY KEY,
    key               TEXT UNIQUE NOT NULL,         -- 如 'top', 'bottom', 'outfit'
    name_cn           TEXT NOT NULL,                -- '上装'
    name_en           TEXT,                         -- 'Top'
    sort_order        INTEGER NOT NULL DEFAULT 0,   -- 维度排列顺序
    is_multi_select   INTEGER NOT NULL DEFAULT 0,   -- 0=单选, 1=多选（如配饰）
    is_enabled        INTEGER NOT NULL DEFAULT 1,   -- 0=禁用, 1=启用
    icon              TEXT,                         -- 图标标识（可留空）
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    is_deleted        INTEGER NOT NULL DEFAULT 0    -- 软删除标记
);

-- ------------------------------------------------------------
-- modules — 提示词条目表
-- 每个维度下的可选条目
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS modules (
    id                TEXT PRIMARY KEY,
    dimension_id      TEXT NOT NULL,                -- 所属维度
    content_en        TEXT NOT NULL,                -- 英文提示词片段，如 'oversized white shirt'
    display_name      TEXT,                         -- 中文显示名，如 '宽松白衬衫'
    weight            REAL NOT NULL DEFAULT 1.0,    -- 默认权重 0.5~2.0，供随机引擎使用
    is_enabled        INTEGER NOT NULL DEFAULT 1,   -- 0=禁用, 1=启用
    is_nsfw           INTEGER NOT NULL DEFAULT 0,   -- 0=普通, 1=NSFW（随机引擎可过滤）
    usage_count       INTEGER NOT NULL DEFAULT 0,   -- 使用计数，统计用
    example_image     TEXT,                         -- 示例图路径（可留空）
    notes             TEXT,                         -- 备注
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    is_deleted        INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (dimension_id) REFERENCES dimensions(id)
);

-- ------------------------------------------------------------
-- tags — 标签表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL UNIQUE,         -- 标签名，如 '韩系'
    color             TEXT,                         -- 标签颜色（hex 或命名）
    created_at        INTEGER NOT NULL,
    is_deleted        INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------
-- module_tags — 模块-标签多对多关联表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS module_tags (
    module_id         TEXT NOT NULL,
    tag_id            TEXT NOT NULL,
    PRIMARY KEY (module_id, tag_id),
    FOREIGN KEY (module_id) REFERENCES modules(id),
    FOREIGN KEY (tag_id) REFERENCES tags(id)
);

-- ------------------------------------------------------------
-- assemblies — 拼装方案表
-- 一次拼装的结果快照
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assemblies (
    id                TEXT PRIMARY KEY,
    title             TEXT,                         -- 拼装标题（可选）
    prompt_ir         TEXT,                         -- IR JSON 字符串
    final_prompt      TEXT,                         -- 最终提示词字符串
    model_profile     TEXT NOT NULL DEFAULT 'sd',   -- 使用的模型配置：sd/mj/flux
    created_at        INTEGER NOT NULL,
    is_favorite       INTEGER NOT NULL DEFAULT 0,   -- 0=普通, 1=收藏
    is_deleted        INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------
-- assembly_items — 拼装明细表
-- 记录每个拼装方案包含的条目、排序与权重覆盖
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assembly_items (
    id                TEXT PRIMARY KEY,
    assembly_id       TEXT NOT NULL,                -- 所属拼装方案
    module_id         TEXT NOT NULL,                -- 引用的条目
    sort_order        INTEGER NOT NULL DEFAULT 0,   -- 在拼装中的排序
    weight_override   REAL,                          -- 权重覆盖（NULL 表示用条目默认权重）
    is_locked         INTEGER NOT NULL DEFAULT 0,   -- 0=未锁定, 1=锁定（随机时保留）
    FOREIGN KEY (assembly_id) REFERENCES assemblies(id),
    FOREIGN KEY (module_id) REFERENCES modules(id)
);

-- ------------------------------------------------------------
-- templates — 模板表（预留）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    description       TEXT,
    config_json       TEXT,                         -- 维度开关+权重+规则快照 JSON
    cover_prompt      TEXT,
    created_at        INTEGER NOT NULL,
    is_deleted        INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------
-- rules — 冲突/依赖规则表
-- 预置 3 条核心规则
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rules (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,           -- 规则名
    type                    TEXT NOT NULL,           -- mutex | requires | excludes | limit | isolated
    source_dimension_id     TEXT,                    -- 源维度
    source_module_id        TEXT,                    -- 源条目（可为 NULL 表示该维度全部）
    target_dimension_id     TEXT,                    -- 目标维度
    target_module_id        TEXT,                    -- 目标条目
    message                 TEXT,                    -- 冲突提示语
    is_enabled              INTEGER NOT NULL DEFAULT 1,
    created_at              INTEGER NOT NULL,
    is_deleted              INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (source_dimension_id) REFERENCES dimensions(id),
    FOREIGN KEY (target_dimension_id) REFERENCES dimensions(id)
);

-- ------------------------------------------------------------
-- 索引
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_modules_dimension
    ON modules(dimension_id) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_modules_enabled
    ON modules(is_enabled) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_modules_nsfw
    ON modules(is_nsfw) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_assembly_items_assembly
    ON assembly_items(assembly_id);

CREATE INDEX IF NOT EXISTS idx_rules_source_dim
    ON rules(source_dimension_id) WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_rules_target_dim
    ON rules(target_dimension_id) WHERE is_deleted = 0;
