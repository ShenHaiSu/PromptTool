# 踩坑记录 01：Tauri v2 命令参数名默认转 camelCase，前端 invoke 键名不匹配导致保存失败

- **日期**：2026-08-25
- **影响模块**：`src/lib/db.ts`（全部 invoke 封装）、保存方案 / 收藏并保存 / 另存为模板 / 批量 Card 收藏
- **严重程度**：高（所有带复合词参数的 Rust command 全部失效）
- **状态**：已修复（方案 B：前端 key 改为 camelCase）

---

## 一、现象

测试人员在测试时点击以下任一按钮均报错：

- 「保存方案」
- 「★ 收藏并保存」
- 「另存为模板」
- 批量工厂 Card 的收藏按钮

报错 Toast 内容（来自 Tauri 的 `InvalidArgs` 错误）：

```
保存失败 : invalid args irdson for command db save asembly':
  command db save assembly missing required key irdson
```

（`irdson`/`asembly` 为 Toast 显示/转述过程中出现的形式化差异；实际错误为
`invalid args \`irJson\` for command \`db_save_assembly\`: command db_save_assembly missing required key \`irJson\``）

## 二、根因

### 2.1 Tauri v2 的默认命名转换

Tauri v2（本项目锁定 `tauri 2.11.5` / `tauri-macros 2.6.3`）的 `#[tauri::command]`
宏默认将 **Rust 函数形参名转换为 camelCase** 作为 IPC 参数 key：

- `tauri-macros/src/command/wrapper.rs:51` — 默认 `argument_case: ArgumentCase::Camel`
- `wrapper.rs:505-508` — 用 `heck::ToLowerCamelCase` 将形参名转小驼峰

因此：

| Rust 形参 | Tauri 期望的 JS key |
|-----------|---------------------|
| `ir_json` | `irJson` |
| `final_prompt` | `finalPrompt` |
| `is_favorite` | `isFavorite` |
| `dim_id` | `dimId` |
| `enabled_keys` | `enabledKeys` |
| `results_json` | `resultsJson` |
| `legacy_path` | `legacyPath` |
| `assembly_id` | `assemblyId` |

### 2.2 前端发送了 snake_case 键

`src/lib/db.ts` 的 invoke 调用原本按「形参名 snake_case」发送：

```ts
invoke('db_save_assembly', {
  ir_json: irJson,          // ❌ 应为 irJson
  final_prompt: finalPrompt, // ❌ 应为 finalPrompt
  is_favorite: isFavorite,   // ❌ 应为 isFavorite
})
```

### 2.3 错误链路

1. 前端 `invoke('db_save_assembly', { ir_json, ... })`
2. Tauri 在 `tauri/src/ipc/command.rs` 的 `CommandItem::deserialize_json()` 中按
   `irJson` 从 payload 取参，找不到 → `serde_json::Error::custom(...)`：
   `command db_save_assembly missing required key irJson`
3. 包装为 `Error::InvalidArgs` → 前端 rejection 文本即用户看到的报错

### 2.4 影响范围（实测编译产物 tauri-app.exe 中可提取验证）

| 命令 | 受影响参数 | 前端调用点 |
|------|-----------|-----------|
| `db_get_modules_by_dimension` | `dim_id` | `dbGetModulesByDimension` |
| `db_create_module` | `dim_id` / `content_en` / `display_name` | `dbCreateModule` |
| `db_save_assembly` | `ir_json` / `final_prompt` / `is_favorite` | `dbSaveAssembly` |
| `db_save_assembly_from_ir` | 同上 | `dbSaveAssemblyFromIr` |
| `db_get_assembly_items` | `assembly_id` | `dbGetAssemblyItems` |
| `db_load_selected_items` | `assembly_id` | `dbLoadSelectedItems` |
| `db_save_template` | `enabled_keys` | `dbSaveTemplate` |
| `db_export_csv` | `results_json` | `dbExportCsv` |
| `db_import_legacy_db` | `legacy_path` | `dbImportLegacyDb` |

> 注意：DTO 字段是 **camelCase**（Rust 侧 `#[serde(rename_all = "camelCase")]`），
> 这部分前后端本已一致，无需改动。只有「命令顶层参数 key」受影响。

## 三、修复（采用方案 B：前端改为 camelCase key）

修改 `src/lib/db.ts` 全部受影响 invoke 键名，与 Tauri 默认转换对齐：

```ts
// 改后示例（db_save_assembly）
invoke('db_save_assembly', {
  title,
  irJson,          // 原 ir_json: irJson
  finalPrompt,     // 原 final_prompt: finalPrompt
  config: toConfigDto(config),
  items: items.map(...),
  isFavorite,      // 原 is_favorite: isFavorite
})
```

同步更新：

- `src/lib/db.ts` 顶部注释（说明 Tauri v2 默认 camelCase 规则）
- `src/lib/db.integration.test.ts` 断言 `ir_json/final_prompt/is_favorite`
  → `irJson/finalPrompt/isFavorite`

### 备选方案 A（未采用，供参考）

Rust 侧给所有 `#[tauri::command]` 增加 `rename_all = "snake_case"`，保持前端 snake_case
不动。优点：不动前端、改动集中在 Rust；缺点：与 Tauri v2 社区默认约定相反。
最终选择 URL：不改 Rust，遵循 Tauri 默认约定，前端显式 camelCase。

## 四、验证方法

```bash
# 1. 前端单测（invoke 映射断言）
bun test src/lib/db.integration.test.ts

# 2. 端到端手工回归（需重新构建 exe 后测试）
#  - 保存方案 → Toast「已保存方案」
#  - ★ 收藏并保存 → Toast「已收藏并保存」
#  - 另存为模板 → Toast「已另存为模板」
#  - 批量 Card ★ → Toast「已收藏」
#  - 导入词库按维度加载词条（dimId）/ 新建词条（dimId/contentEn/displayName）
#  - CSV 导出（resultsJson）
#  - 旧版库导入（legacyPath）
```

## 五、经验教训 / 后续防范

1. **Tauri v2 命令参数默认 camelCase**，与 v1 及多数教程里常见的「参数名与形参一致」
   直觉不同。写新 command 时先决定统一约定：
   - 前端 camelCase + Rust 默认（本方案，推荐，符合官方默认）
   - 前端 snake_case + Rust `rename_all = "snake_case"`（一致性由 Rust 宏兜底）
2. **行了单个词参数（如 `keyword`、`id`、`limit`）不会暴露此问题**，因为 camelCase 与
   snake_case 相同；复合词参数（`ir_json`、`final_prompt`…）才触发。回归测试应覆盖
   带复合词参数的命令。
3. 检查新 command 是否踩坑的最快方式：在编译产物（exe / dll）中 `strings` 搜索
   命令名附近的 key 集合，与前端 `invoke` 的键名逐一比对。
4. 单测（`db.integration.test.ts`）应断言 payload 的**具体键名**（如 `toHaveProperty('irJson')`），
   防止命名漂移。