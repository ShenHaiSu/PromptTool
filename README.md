# Prompt Modular Factory — 正式版

> 提示词模块化工厂（PMF）· 生产交付

Python + tkinter + sqlite3 构建的文生图提示词规模化管理桌面端，覆盖 11 维条目管理、拼装、规则校验、随机批量与导出全链路，开箱即用。

## 快速开始

```bash
# 安装依赖
pip install -r requirements.txt  # 含 sv-ttk>=2.6 主题（可选，缺失时回退 clam）

# 运行单元测试
python -m pytest -v

# 启动桌面程序
python src/app.py
```

## 交付闭环（V2.0 TopBar）

顶部通栏常驻预览（prompt 全文 + 冲突 badge + IR 折叠）→ 左栏实时搜索 + NSFW 筛选 → 中栏 Chips 画布（拖拽排序 + 点击改权重 + 锁定/删除）→ 右栏批量工厂全高 Card 流 + 资产库（历史/收藏/模板）→ 视图明暗主题一键切换 → 快捷键 Ctrl+F/S/C → 随机批量去重 → 一键复制/导出 CSV。

## 项目结构

```
PromptTool/
├── src/
│   ├── app.py                  # tkinter 主入口
│   ├── config.py               # 全局配置（DB 路径、默认配置、窗口尺寸）
│   ├── exporter.py             # CSV 导出工具
│   ├── ui/                     # 表现层
│   │   ├── main_window.py      # 三栏 PanedWindow 布局 + 事件协调
│   │   ├── dimension_panel.py  # 左栏：维度/条目 Treeview + 搜索 + CRUD
│   │   ├── assembly_panel.py   # 中栏：已选拼装 + 排序 + 权重滑杆
│   │   ├── preview_panel.py    # 右栏：实时预览 + IR + 批量 + 复制/导出
│   │   └── styles.py           # ttk 主题样式
│   ├── engine/                 # 引擎层（纯逻辑，无 UI/DB 依赖）
│   │   ├── models.py           # 领域模型 dataclass
│   │   ├── assembly.py         # 拼装引擎
│   │   ├── random_engine.py    # 随机引擎（加权随机 + 去重）
│   │   ├── rules.py            # 规则引擎（3 条预置规则）
│   │   └── adapters.py         # 语法适配器（SD/MJ/Flux）
│   ├── db/                     # 数据访问层 + 数据层
│   │   ├── schema.sql          # DDL 建表脚本
│   │   ├── connection.py       # 连接管理（WAL、备份、迁移）
│   │   ├── sample_importer.py  # 从 samplePrompt 目录导入 165 条提示词
│   │   ├── seed.py             # 预置 11 维 + 165 条目 + 3 规则
│   │   └── repository.py       # Repository CRUD 封装
│   └── tests/                  # 单元测试 + 集成测试
│       ├── conftest.py
│       ├── test_assembly.py
│       ├── test_random.py
│       ├── test_rules.py
│       ├── test_adapters.py
│       ├── test_repository.py
│       └── test_e2e.py
├── data/                       # 运行时数据（自动创建）
│   ├── pmf.db
│   └── backups/
├── docs/
│   ├── 文生图提示词规模化管理桌面端软件-生产交付标准文档-V1.0.md
│   └── samplePrompt/           # 11 维 × 15 条示例提示词
├── requirements.txt
└── pytest.ini
```

## 技术栈

| 分层 | 选型 | 说明 |
|---|---|---|
| GUI | tkinter | Python 标准库，零依赖 |
| 数据库 | sqlite3 | Python 标准库，WAL 模式 |
| 业务逻辑 | 纯 Python | 拼装 / 随机 / 规则 / 适配器 |
| 数据模型 | dataclasses | `@dataclass` 领域模型 |
| 单元测试 | pytest | 引擎层 + 仓库层 + 端到端 |

生产交付栈即 Python + tkinter + sqlite3，不依赖 Tauri/Vue 等外部框架。

## 核心功能

- **11 维模块管理**：身材 / 面部 / 上装 / 下装 / 套装 / 鞋袜 / 配饰 / 姿势 / 物品 / 背景 / 相机
- **165 条示例提示词**：从 `docs/samplePrompt` 目录自动导入（每维 15 条），首次启动注入数据库
- **拼装工作台**：上移/下移排序，Scale 滑杆调权重（0.5~2.0），锁定，实时预览
- **随机拼装引擎**：`random.choices` 加权随机，支持锁定与批量 N 条去重，支持 NSFW 过滤开关
- **3 条冲突规则**：套装互斥 / 鞋袜赤脚互斥 / 室内外背景互斥
- **语法适配器**：SD 权重 >1 → `(text:1.2)`；<1 → `[text]`；=1 → 原文；MJ/Flux 已预留
- **CSV 导出**：批量结果导出为 CSV（UTF-8-BOM，Excel 兼容）
- **本地数据安全**：SQLite WAL + 写入前备份（保留最近 10 份）+ 存量库迁移

## 测试

```bash
# 全量测试
python -m pytest -v

# 覆盖率报告（引擎层 > 80%）
python -m pytest --cov=src/engine --cov-report=term-missing
```

## 文档依据

本项目依据《文生图提示词规模化管理桌面端软件 — 生产交付标准文档 V1.0》交付。

*Prompt Modular Factory · 正式版 · 2026-08-23*
