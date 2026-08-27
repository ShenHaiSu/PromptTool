# 02 LLM 解析提示词与前端交互方案

> **关联代码：** `src/lib/db.ts`（`dbGetDimensions`/`dbCreateModule`/`dbUpdateModule`）· `src/lib/segmentParse.ts`（01-§4 解析器）· `src-tauri/src/commands/db.rs`（`db_create_module`/`import_library_into` 去重事务模式）· `src-tauri/src/lib.rs`（`invoke_handler` 注册）· `src/components/LibraryDialog.vue` / `SaveDialog.vue`（弹窗模式参照）· `src/components/DimensionPanel.vue`（`refresh()` 刷新）· `src/App.vue` / `src/components/StatusBar.vue`（入口挂载）· `src/engine/models.ts`（`Dimension`/`Module`）· `src/composables/useToast.ts`
> **目标：** 基于数据库中已有的 `dimensions` 动态生成可直接喂给 LLM 的完整解析提示词（System Prompt），并提供一套前端“向导式”交互界面：`粘贴原始串 → 复制提示词 → 粘贴 LLM 输出 → 预览/纠错 → 批量入库`，全链路无需外部网络与 API Key。

---

## 一、现状分析

### 1.1 当前缺口

| 能力 | 现状 | 缺口 |
|------|------|------|
| 维度数据 | `db_get_dimensions` 已就绪，Need02 支持自定义扩展 | 未接入提示词生成，仅作为面板数据源 |
| 提示词解析 | `TopBar` / `assembly.ts` 为“结构化 → 字符串”正向拼装 | 无“字符串 → 结构化”逆向拆解 |
| 批量导入 | `LibraryDialog` 的 `pmf-library` 整库导入按 `key`/`contentEn` 去重 | 仅支持已分好结构的 JSON，不支持原始连续串 |
| LLM 接入 | 无 | 需补“提示词生成器 + 手动闭环 + 结构化回填” |

### 1.2 约束与取舍

- **首版不直连 LLM API**：避免 `API Key` 管理、计费、网络、代理等强依赖；采用“复制提示词 → 用户在任意 LLM 粘贴 → 复制输出回贴”的手动闭环，兼容 ChatGPT/Claude/本地模型/企业网关。
- **提示词必须随维度表自动更新**：新增/改名/禁用维度后，提示词中维度表、枚举校验、预览分组均同步，无需手改模板。
- **解析与入库解耦**：解析为纯前端（`segmentParse.ts`），入库为 Rust 事务（批量 `INSERT ...`），解析失败不触库。

---

## 二、LLM 解析提示词（Instruction Prompt）生成方案

### 2.1 目标

给定：
- `dimensions: Dimension[]`（`dbGetDimensions()`，按 `sortOrder`）
- `rawPrompts: string[]`（用户粘贴的 1-N 条原始整串）

生成一段可直接复制到 LLM 对话框的 **完整指令提示词**，使 LLM 输出符合 01-§2.2 的 `pmf-segments` JSON。

### 2.2 提示词结构（五节）

```
[1] 角色与任务（Role + Task）
[2] 维度表（Dimensions — 动态注入）
[3] 输出约束（Output Constraints — 固定文案 + 维度相关规则）
[4] 输出格式（Output Format — JSON Schema 摘要 + 禁止事项）
[5] 示例（Few-shot — 固定 2 例，维度表与示例联动）
[6] 待解析原文（Input — 占位符，用户原始串注入）
```

严格顺序，避免 LLM 注意力漂移；每节以 `##` Markdown 标题分隔，便于用户在 LLM 侧折叠阅读。

### 2.3 维度表动态生成

#### 2.3.1 输入

`dbGetDimensions()` 返回的 `Dimension[]`，仅取 `isDeleted=0` 且 `isEnabled` 不过滤（禁用维度仍在提示词中列出并标注“已禁用，仍可归类但导入时将提示”）。

#### 2.3.2 维度说明映射

为每个预置 `key` 提供一句话语义说明（与 01-§3.3 同源），自定义维度回退为 `nameCn / nameEn`：

| key | 说明（注入提示词） |
|-----|-------------------|
| gender | 性别表达：female/male/androgynous 等 |
| ethnicity | 人种/族裔/肤色族属 |
| height | 身高数值或高矮描述 |
| body | 身材、体型、腿/腰/胸等身体特征 |
| face | 脸型、五官、妆容、发型、表情 |
| top | 上装（与 outfit 互斥） |
| bottom | 下装（与 outfit 互斥） |
| outfit | 全身套装/连衣裙/连体裤（与 top/bottom 互斥） |
| shoes | 鞋、袜、赤足 |
| accessories | 饰品、包、帽、眼镜等小件（可多选） |
| pose | 姿态、站/坐/走、肢体朝向 |
| props | 手持/交互物：杯、伞、花、手机等 |
| background | 场景、地点、环境 |
| camera | 镜头、焦段、光圈、灯光、画质词 |
| *自定义* | `{nameCn} / {nameEn}`（例：`饰品风格 / Jewelry`） |

#### 2.3.3 注入形式

```markdown
## 2. Dimensions (Allowed `dimensionKey` — use exactly these keys)
| dimensionKey | nameCn | nameEn | multi | enabled | description |
|---|---|---|---|---|---|
| gender | 性别 | Gender | single | yes | 性别表达 ... |
| body | 身材 | Body | single | yes | 身材、体型 ... |
| ... | ... | ... | ... | ... | ... |
| custom_jewelry | 饰品风格 | Jewelry | multi | yes | 饰品风格 / Jewelry（自定义维度） |
```

- `dimensionKey` 列为**枚举真源**，提示词中强调“只能使用此表中的 key，大小写敏感，未知 key 将被标为 `unassigned`”。
- `multi` 列来自 `isMultiSelect`，告知 LLM 同维度多片段是否常见（`accessories` 可多段，其余尽量合并）。

### 2.4 完整提示词模板

```markdown
# Role
You are a professional prompt segmentation assistant for a text-to-image prompt factory.

# Task
Segment each of the given raw prompts (comma-separated natural language) into structured segments,
each assigned to exactly one `dimensionKey` from the Dimensions table below.
Return ONLY a JSON object conforming to the Output Format. No explanations, no markdown fences.

## 1. Dimensions (Allowed `dimensionKey`)
{{DIMENSION_TABLE}}

Rules for dimensions:
- `isMultiSelect=multi` dimensions (e.g. accessories) may have multiple segments per prompt; others should be merged into one segment per dimension when possible.
- `outfit` is mutually exclusive with `top`/`bottom` in the same prompt; prefer `outfit` when the raw text describes a dress / jumpsuit / full outfit.
- If a phrase does not fit any dimension, or is a quality booster (masterpiece, 8k, ultra detailed), assign it to `unassigned`.

## 2. Output Constraints
- `contentEn` must be the exact English substring from the raw prompt (trimmed), preserving wording.
- `weight` is optional, default 1.0; only set when emphasis is clearly intended (e.g. `(xxx:1.3)`). Range 0.5-2.0.
- `isNsfw` is optional, default false; set true only when the segment is explicitly NSFW.
- `dimensionKey` must be one of the table keys or `unassigned`; unknown keys will be treated as `unassigned`.
- Comma-separated phrases in the raw prompt are natural split points; keep each segment independently reusable.

## 3. Output Format (pmf-segments v1)
Return a single JSON object:

{
  "format": "pmf-segments",
  "formatVersion": 1,
  "createdAt": 1756000000,
  "generator": "llm",
  "source": { "rawCount": <number of prompts> },
  "counts": { "prompts": <n>, "segments": <m>, "unassigned": <k> },
  "prompts": [
    {
      "id": "p01",
      "raw": "<exact raw prompt string>",
      "segments": [
        { "dimensionKey": "<key>", "contentEn": "<english phrase>", "weight": 1.0, "isNsfw": false }
      ]
    }
  ]
}

- `raw` must equal the input raw prompt verbatim.
- `counts` / `createdAt` may be filled by you; they are not validated strictly.
- Do NOT wrap the JSON in ```json fences. Do NOT add any text before or after the JSON.

## 4. Few-shot Examples

### Example 1
Raw: "slim waist, long legs, oval face with natural makeup, white oversized shirt, high-waisted wide-leg jeans, white sneakers, gold hoop earrings, standing with hands in pockets, holding coffee cup, minimalist white studio backdrop, 85mm lens shallow depth of field soft lighting"
Output:
{{EXAMPLE_1_JSON}}

### Example 2
Raw: "red bodycon dress, knee-length, wavy long hair, standing with one hand on hip, rooftop city skyline at sunset, 50mm lens natural light"
Output:
{{EXAMPLE_2_JSON}}

## 5. Input — Segment the following prompts ({{RAW_COUNT}} in total):
{{RAW_PROMPTS_NUMBERED}}

Return ONLY the JSON object described above.
```

**占位符：**

| 占位 | 来源 |
|------|------|
| `{{DIMENSION_TABLE}}` | 2.3 生成的 Markdown 表 |
| `{{EXAMPLE_1_JSON}}` / `{{EXAMPLE_2_JSON}}` | 固定常量（见 2.5），维度语义与 01-§4.6 示例一致 |
| `{{RAW_COUNT}}` | `rawPrompts.length` |
| `{{RAW_PROMPTS_NUMBERED}}` | 逐条编号 `1. <raw>` 列表，超长单条截断提示 |

#### Few-shot 常量（示例 1 精简示意）

```json
{
  "format": "pmf-segments",
  "formatVersion": 1,
  "createdAt": 1756000000,
  "generator": "llm",
  "source": { "rawCount": 1 },
  "counts": { "prompts": 1, "segments": 10, "unassigned": 0 },
  "prompts": [
    {
      "id": "p01",
      "raw": "slim waist, long legs, oval face with natural makeup, white oversized shirt, high-waisted wide-leg jeans, white sneakers, gold hoop earrings, standing with hands in pockets, holding coffee cup, minimalist white studio backdrop, 85mm lens shallow depth of field soft lighting",
      "segments": [
        { "dimensionKey": "body", "contentEn": "slim waist, long legs" },
        { "dimensionKey": "face", "contentEn": "oval face with natural makeup" },
        { "dimensionKey": "top", "contentEn": "white oversized shirt" },
        { "dimensionKey": "bottom", "contentEn": "high-waisted wide-leg jeans" },
        { "dimensionKey": "shoes", "contentEn": "white sneakers" },
        { "dimensionKey": "accessories", "contentEn": "gold hoop earrings" },
        { "dimensionKey": "pose", "contentEn": "standing with hands in pockets" },
        { "dimensionKey": "props", "contentEn": "holding coffee cup" },
        { "dimensionKey": "background", "contentEn": "minimalist white studio backdrop" },
        { "dimensionKey": "camera", "contentEn": "85mm lens, shallow depth of field, soft lighting" }
      ]
    }
  ]
}
```

> 示例 2 覆盖 `outfit` 互斥与 `face` 多词合并，供 LLM 学习边界。

### 2.5 生成器实现（TS）

**文件：** `src/lib/segmentPrompt.ts`（新增，纯前端，无 Tauri 依赖）

```ts
// src/lib/segmentPrompt.ts
import type { Dimension } from '@/engine/models'

const DIMENSION_DESCRIPTIONS: Record<string, string> = {
  gender: '性别表达：female/male/androgynous 等',
  ethnicity: '人种/族裔/肤色族属',
  height: '身高数值或高矮描述',
  body: '身材、体型、腿/腰/胸等身体特征',
  face: '脸型、五官、妆容、发型、表情',
  top: '上装（与 outfit 互斥）',
  bottom: '下装（与 outfit 互斥）',
  outfit: '全身套装/连衣裙/连体裤（与 top/bottom 互斥）',
  shoes: '鞋、袜、赤足',
  accessories: '饰品、包、帽、眼镜等小件（可多选）',
  pose: '姿态、站/坐/走、肢体朝向',
  props: '手持/交互物：杯、伞、花、手机等',
  background: '场景、地点、环境',
  camera: '镜头、焦段、光圈、灯光、画质词',
}

const EXAMPLE_1_JSON = `...` // 常量，见 2.4
const EXAMPLE_2_JSON = `...`

export type PromptBuildInput = {
  dimensions: Dimension[]
  rawPrompts: string[] // 1-500 条，单条长度建议 <1000
}

export function buildDimensionTable(dimensions: Dimension[]): string {
  // 按 sortOrder 排序，生成 Markdown 表，含 custom 回退
}

export function buildSegmentInstructionPrompt(input: PromptBuildInput): string {
  // 校验：rawPrompts 非空、长度限制
  // 组装五节模板，注入 DIMENSION_TABLE / EXAMPLE_* / RAW_PROMPTS_NUMBERED
  // 返回完整字符串
}

export function estimatePromptTokens(text: string): number {
  // 粗略估算：按 4 chars ≈ 1 token，用于前端提示“过长”
}
```

**关键细节：**

- `buildDimensionTable` 中禁用维度仍列出，`enabled` 列标 `no`，并在表下方追加一句 `Disabled dimensions are still valid keys but will be flagged on import.`。
- `rawPrompts` 超 50 条时，提示词中追加 `Note: Input is large (N prompts); segment faithfully without omitting any prompt.`。
- 单条 `raw` 含换行/引号时，原样保留，不做转义（用户复制到 LLM 时可见）。
- 提供 `copyInstructionPrompt(text)` 工具：`navigator.clipboard.writeText` + `execCommand` 回退，与 `BatchFactory.onCopyAll` 一致。

---

## 三、前端交互设计

### 3.1 信息架构与链路

```
入口（StatusBar “📥 分段导入” 或 DimensionPanel 工具行）
  │
  ▼
SegmentImportDialog（向导，三步）
  ┌─────────────────────────────────────────┐
  │ Step 1 · 输入原始串                     │  粘贴多条原文，自动按行/空行切分
  │  - 多行 textarea / 文件拖拽             │  ├─ 生成并复制 LLM 指令
  │  - 每行一条 Prompt，或 CSV/JSON 导入    │
  │  [生成解析指令] [复制指令]               │
  ├─────────────────────────────────────────┤
  │ Step 2 · 粘贴 LLM 输出                  │  粘贴 JSON / tagged 文本
  │  - 大 textarea + 文件读取               │  ├─ 实时解析与校验
  │  - 支持 .json/.txt 拖拽                 │  ├─ 探测格式、归一、维度校验
  │  [解析] [转为 JSON]                     │
  ├─────────────────────────────────────────┤
  │ Step 3 · 预览与导入                     │  分 Prompt 分组预览
  │  - 按维度分组、着色                     │  ├─ 逐条勾选、重映射、忽略
  │  - 统计条、告警/错误筛选                │  ├─ 去重预览（命中现有词条标“已存在”）
  │  [导入勾选项] [仅校验]                  │
  └─────────────────────────────────────────┘
  │
  ▼
Toast + 导入报告（新增/跳过/错误）→ DimensionPanel.refresh()
```

> 向导采用**单对话框内分段/标签页**而非多弹窗跳转，减少上下文丢失；三步可自由回退，状态保留在对话框内（关闭则重置）。

### 3.2 向导分步详情

#### Step 1 — 输入原始提示词

```
┌─────────────────────────────────────────────────┐
│ ① 输入原始提示词                           [? 说明] │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐ │
│ │ slim waist, long legs, ... soft lighting  │ │  textarea，placeholder：
│ │ red bodycon dress, knee-length, ...       │ │  “每行一条完整 Prompt，也可粘贴多行”
│ │ ...                                       │ │  支持 .txt/.csv 拖拽读取
│ └─────────────────────────────────────────────┘ │
│ 文件： [选择 .txt/.csv]  已读 3 条  [清空]     │
│ 维度 14 · 自定义 1 · 已启用 13（自动拉取）      │
│                                                 │
│ [生成解析指令]  [复制指令]  [下载指令 .md]       │
│                                                 │
│ ┌─ 指令预览（可折叠/复制） ─────────────────┐   │
│ │ # Role ...                                │   │  预览 buildSegmentInstructionPrompt 结果
│ │ ## 1. Dimensions ...                      │   │  显示预估 token 与维度表摘要
│ │ ...                                       │   │
│ └───────────────────────────────────────────┘   │
│ 提示：复制指令后粘贴到任意 LLM，令其“只输出 JSON” │
└─────────────────────────────────────────────────┘
```

交互：

- `textarea` 每行一条，空行忽略；支持从 `.txt`（每行一条）/`.csv`（首列为 prompt）/`.json`（`string[]` 或 `{ prompts: string[] }`）批量导入；拖拽即读。
- `已读 N 条` 与 `维度 N` 实时统计；维度表拉取失败时红字提示“无法读取维度，请重试”。
- `[生成解析指令]`：调用 `buildSegmentInstructionPrompt({ dimensions, rawPrompts })` 生成完整指令，展示在可折叠预览区，并自动写入剪贴板（失败则 Toast 指引手动复制）。
- `[复制指令]` / `[下载指令 .md]`：二次复制与落盘（`pmf-segment-instruction-*.md`）。
- 快捷键：`Ctrl+Enter` 生成并复制。

#### Step 2 — 粘贴 LLM 输出

```
┌─────────────────────────────────────────────────┐
│ ② 粘贴 LLM 输出（pmf-segments JSON 或 Tagged）  │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐ │
│ │ { "format": "pmf-segments", ... }         │ │  textarea，placeholder：
│ │                                           │ │  “粘贴 LLM 返回的 JSON，或 [body] ... 形式的 Tagged 文本”
│ └─────────────────────────────────────────────┘ │
│ 文件： [选择 .json/.txt]  [转为 JSON]  [清空]   │
│ 探测： JSON ✓  格式 v1  2 prompts · 18 segments │
│ 错误： 0  警告： 1（body 多段，已标为待复核）     │
│                                                 │
│ [解析并预览 →]                                  │
└─────────────────────────────────────────────────┘
```

交互：

- 粘贴后自动调用 `parseAndValidate(text, dimensions)`，实时显示 `探测：JSON/tagged/unknown`、`错误/警告` 计数与首条错误摘要。
- `[转为 JSON]`：当输入为 tagged 文本时，一键 `toSegmentsJson(batch)` 填充回 textarea，便于用户检查。
- 支持 `.json` / `.txt` 文件读取与拖拽；内容直接填入 textarea 并触发解析。
- 校验未通过的 entry 标红，允许“仍进入预览”以便逐条纠正。

#### Step 3 — 预览与导入

```
┌─────────────────────────────────────────────────┐
│ ③ 预览与导入                              [筛选 ▼] │
├─────────────────────────────────────────────────┤
│ 统计： 2 prompts · 18 segments · 1 unassigned   │
│       1 待复核 · 0 错误 · 预估新增 15 · 已存在 3 │
│ 筛选： [全部] [待复核] [未分配] [已存在]         │
│                                                 │
│ ┌─ Prompt p01 ──────────────────────────────┐  │
│ │ raw: slim waist, long legs, ...           │  │
│ │ ☑ [body] slim waist, long legs        w1.0│  │
│ │ ☑ [face] oval face with natural makeup    │  │
│ │ ☑ [top] white oversized shirt             │  │
│ │ ☐ [unassigned] ultra detailed, 8k  ⚠ 未分配│  │  默认不勾选
│ │ 维度未知：0  权重异常：0                    │  │
│ └───────────────────────────────────────────┘  │
│ ┌─ Prompt p02 ──────────────────────────────┐  │
│ │ ...                                       │  │
│ └───────────────────────────────────────────┘  │
│ 分页： < 1 / 2 >  每页 10 prompts               │
│                                                 │
│ 未分配处理： ( ) 忽略  ( ) 归入 camera  ( ) 提示新建维度 │
│ 去重命中“已存在”的词条： ( ) 跳过  (x) 覆盖更新          │
│                                                 │
│ [仅校验]  [导入勾选项 18 条]                     │
│                                                 │
│ ┌─ 导入报告（导入后展开） ──────────────────┐   │
│ │ 词条：新增 15 · 更新 0 · 跳过 3              │   │
│ │ 错误：0  警告：1 条（可展开）                 │   │
│ └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

交互：

- 每条 Prompt 独立卡片，raw 可折叠；每段一行：`[dimensionKey]` 色块 + `contentEn` + `weight` + `isNsfw` 红点 + 勾选框。
- `已存在` 判定：前端调用 `find_module_hit` 的轻量版（`dimensionKey + contentEn` 精确匹配）对每段做本地去重预检，命中则行尾标“已存在 · 将跳过/覆盖”。
- `未分配` / `未知维度` 行高亮黄底，默认不勾选，提供“重映射”下拉（列出全部 `dimensions` + `unassigned`）。
- 筛选与分页：顶栏筛选仅影响显示，不影响勾选状态；分页每页 10 prompts，虚拟化非必需（单页段数有限）。
- 底部全局选项：`未分配处理` 与 `去重模式（跳过/覆盖）`，与 `import_library` 的 `mode` 语义一致。
- `[仅校验]`：不入库，仅刷新报告，用于用户自检。
- `[导入勾选项]`：收集勾选段 → 组装 `RawBatch`（仅勾选段）→ 调用 Rust 批量入库（§4）→ Toast + 报告 → `DimensionPanel.refresh()`。

### 3.3 组件结构与状态

**文件：** `src/components/SegmentImportDialog.vue`（新增）

```vue
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/composables/useToast'
import { dbGetDimensions } from '@/lib/db'
import { parseAndValidate, toSegmentsJson, toTaggedText } from '@/lib/segmentParse'
import { buildSegmentInstructionPrompt } from '@/lib/segmentPrompt'
import type { Dimension } from '@/engine/models'
import type { ParsedBatch, ParsedPrompt } from '@/lib/segmentParse'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'imported'): void }>()

// Step 1
const rawText = ref('') // 多行原始串
const rawPrompts = computed(() => rawText.value.split('\n').map(s => s.trim()).filter(Boolean))
const dimensions = ref<Dimension[]>([])
const instructionText = ref('')
const instructionCopied = ref(false)

// Step 2
const llmOutput = ref('')
const parsed = ref<ParsedBatch | null>(null)

// Step 3
const filter = ref<'all' | 'needs_review' | 'unassigned' | 'existing'>('all')
const unassignedStrategy = ref<'ignore' | 'to_camera' | 'prompt_new'>('ignore')
const importMode = ref<'skip' | 'overwrite'>('skip')
const selectedKeys = ref<Set<string>>(new Set()) // segmentKey = `${promptId}::${index}`
const importing = ref(false)
const report = ref<ImportReport | null>(null)

function onClose(): void { emit('update:open', false) }
async function onGenerateInstruction(): Promise<void> { /* ... */ }
async function onParse(): Promise<void> { /* ... */ }
async function onImport(): Promise<void> { /* ... */ }
</script>
```

**Props / Emits：**

| Prop | 类型 | 说明 |
|------|------|------|
| `open` | boolean | `v-model:open` |

| Emit | 说明 |
|------|------|
| `update:open` | 关闭 |
| `imported` | 导入成功，父组件刷新维度/统计 |

**关键 `data-testid`：**

```
segment-import-dialog, segment-import-overlay
segment-raw-textarea, segment-raw-file-input, segment-raw-count
segment-generate-btn, segment-copy-instruction-btn, segment-download-instruction-btn
segment-instruction-preview
segment-llm-textarea, segment-llm-file-input, segment-detect-badge
segment-parse-btn, segment-to-json-btn
segment-preview, segment-stats, segment-filter
segment-prompt-card-*, segment-row-*, segment-row-checkbox-*
segment-unassigned-strategy, segment-import-mode
segment-import-btn, segment-validate-btn
segment-report, segment-report-errors
```

### 3.4 入口与刷新

| 入口 | 位置 | 说明 |
|------|------|------|
| 主入口 | `StatusBar` 新增 `📥 分段导入` 按钮（与 `📚 词库` 并列） | 点击 `showSegmentImport = true`，挂载 `SegmentImportDialog` |
| 次入口（可选） | `DimensionPanel` 工具行 `⋯` 菜单 | 文案“从原始串批量导入” |

```vue
<!-- App.vue -->
<SegmentImportDialog v-model:open="showSegmentImport" @imported="refreshStats" />
```

- `refreshStats` 复用 `App.vue:77` 的 `refreshStats()`，导入后 `await dimensionPanelRef.value?.refresh()`。
- 无需新增 `localStorage` 持久化；对话框状态随关闭重置。

### 3.5 视觉与一致性

- 覆盖层：`fixed inset-0 z-40 bg-black/40`，与 `LibraryDialog` 一致。
- 容器：`max-w-2xl max-h-[85vh] flex flex-col rounded-lg border bg-background shadow-xl`。
- 三步以 `Tabs` 或分段标题 + 折叠区呈现，当前步高亮。
- 色块：`dimensionKey` 按 `sortOrder` 映射轻量色（`bg-*-100`），`unassigned` 为 `bg-amber-100`，`error` 为 `bg-red-50`。
- 空状态与错误：`text-xs text-muted-foreground` + `text-red-500`，与现有 `Toast` 体系一致。

---

## 四、解析与入库衔接

### 4.1 批量入库命令设计

**文件：** `src-tauri/src/commands/segment.rs`（新增）或复用 `db.rs` 追加

```rust
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentImportItem {
  pub dimension_key: String,   // 必须为库内 key 或 unassigned
  pub dimension_id: Option<String>, // 可选，优先用 key 解析
  pub content_en: String,
  pub display_name: Option<String>,
  pub weight: Option<f64>,
  pub is_nsfw: Option<bool>,
  pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentImportPayload {
  pub format: String,          // "pmf-segments"
  pub format_version: i64,     // 1
  pub prompts: Vec<SegmentPrompt>, // 前端已筛选后的 prompts
  pub unassigned_strategy: String, // "ignore" | "to_camera" | "prompt_new"
  pub mode: String,            // "skip" | "overwrite"
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentImportReport {
  pub prompts: i64,
  pub segments_total: i64,
  pub segments_imported: i64,
  pub segments_skipped: i64,
  pub segments_ignored_unassigned: i64,
  pub modules_created: i64,
  pub modules_updated: i64,
  pub modules_skipped: i64,
  pub errors: Vec<String>,
  pub warnings: Vec<String>,
}

#[tauri::command]
pub fn db_import_segments(
  app: AppHandle,
  payload: SegmentImportPayload,
) -> Result<SegmentImportReport, String> { /* ... */ }

#[tauri::command]
pub fn db_import_segments_text(
  app: AppHandle,
  text: String,               // 原始 pmf-segments JSON 文本
  unassigned_strategy: String,
  mode: String,
) -> Result<SegmentImportReport, String> { /* ... */ }
```

**`invoke` 键名：** `payload` / `text` / `unassignedStrategy` / `mode`（camelCase）。

### 4.2 去重与事务

- 复用 `db.rs: find_module_hit` / `resolve_module_dimension` / `id_is_free` 逻辑：
  - 去重键：`(dimensionKey, contentEn)` 精确匹配 + `id` 命中（若 LLM 误填 `dimensionId`）。
  - `dimensionKey` 大小写不敏感，`trim` 后匹配；`unassigned` 按 `unassignedStrategy` 处置：
    - `ignore`：丢弃，不入库，计 `ignored_unassigned`
    - `to_camera`：重映射到 `camera` 维度
    - `prompt_new`：返回错误“存在未分配片段，请新建维度或重映射”（前端需先处理，此策略仅作校验）
- 事务：`BEGIN IMMEDIATE`，逐段 `INSERT` / `UPDATE`，任一失败 `ROLLBACK`，成功 `COMMIT`（与 `import_library_into` 同模式）。
- `displayName` 缺省时落库前补 `contentEn.chars().take(20).collect()`。
- `weight` clamp 至 0.5-2.0，`isNsfw` 默认为 false。
- 大批量（>100 段）分批提交：前端按每 100 段一片调用 `db_import_segments`，报告累加。

### 4.3 TS 封装

**文件：** `src/lib/db.ts` 追加

```ts
export type SegmentImportPayload = {
  format: string; formatVersion: number;
  prompts: { id: string; raw: string; segments: SegmentImportItem[] }[];
  unassignedStrategy: 'ignore' | 'to_camera' | 'prompt_new';
  mode: ImportMode;
}
export type SegmentImportReport = {
  prompts: number; segmentsTotal: number; segmentsImported: number;
  segmentsSkipped: number; segmentsIgnoredUnassigned: number;
  modulesCreated: number; modulesUpdated: number; modulesSkipped: number;
  errors: string[]; warnings: string[];
}

export async function dbImportSegments(payload: SegmentImportPayload): Promise<SegmentImportReport> {
  return invoke<SegmentImportReport>('db_import_segments', { payload })
}
export async function dbImportSegmentsText(
  text: string,
  unassignedStrategy: 'ignore' | 'to_camera' | 'prompt_new',
  mode: ImportMode,
): Promise<SegmentImportReport> {
  return invoke<SegmentImportReport>('db_import_segments_text', { text, unassignedStrategy, mode })
}
```

---

## 五、完整改动清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/lib/segmentParse.ts` | **新增**（01-§6） | 格式探测、两分支解析与校验（约 250-350 行） |
| `src/lib/segmentPrompt.ts` | **新增** | 维度表生成、指令模板、few-shot 常量与 `buildSegmentInstructionPrompt`（约 180-260 行） |
| `src/components/SegmentImportDialog.vue` | **新增** | 三步向导对话框（约 350-500 行，含文件读取与预览） |
| `src/lib/db.ts` | **修改** | 追加 `dbImportSegments` / `dbImportSegmentsText` 及类型 |
| `src-tauri/src/commands/segment.rs` | **新增** | `db_import_segments` / `db_import_segments_text` + 报告类型 |
| `src-tauri/src/commands/mod.rs` | **修改** | 导出 segment 模块 |
| `src-tauri/src/lib.rs` | **修改** | `invoke_handler` 注册 2 个新命令 |
| `src/App.vue` | **修改** | 导入并挂载 `SegmentImportDialog`，`StatusBar` 入口联动 |
| `src/components/StatusBar.vue` | **修改** | 新增 `📥 分段导入` 按钮 + `@toggle-segment-import` emit |
| `src/components/__tests__/SegmentImport.test.ts` | **新增** | 组件与流程测试 |
| `src/lib/segmentPrompt.test.ts` | **新增** | 指令生成单测 |
| `src/lib/segmentParse.test.ts` | **新增** | 解析器单测（01-§7.1） |

> 无需改动 `schema.sql`；`modules` 表已承载 `weight`/`isNsfw`/`notes`，`dimensions` 表已支持自定义。

---

## 六、测试方案

### 6.1 Rust 单测（`segment.rs` `#[cfg(test)]`）

| 用例 | 验证点 |
|------|--------|
| 单 prompt 单段导入 | `modules_created == 1`，`contentEn`/`dimensionKey` 正确 |
| 批量 3 prompts 18 段 | 计数正确，事务原子性 |
| 去重：同 `dimensionKey+contentEn` 二次导入 `skip` | 第二次 `modules_skipped == N`，`modules_created == 0` |
| 去重：`overwrite` 更新 weight/isNsfw | 更新生效，`modules_updated == N` |
| 未分配 `ignore` | `unassigned` 段不入库，`ignored_unassigned` 计数 |
| 未分配 `to_camera` | `unassigned` 重映射到 `camera` 维度入库 |
| 未知 dimensionKey | 计入 `errors`，该段跳过，其余成功 |
| 非法 payload（format/version 错误） | 整体拒绝，无任何写入 |

### 6.2 前端单测（vitest + @vue/test-utils）

| 用例 | 验证点 |
|------|--------|
| `buildSegmentInstructionPrompt` 含全部维度 key | 14 维 + 自定义维度均出现在维度表中 |
| 指令生成：自定义维度回退 | `custom_jewelry` 的 `nameCn/nameEn` 正确注入 |
| 指令生成：禁用维度标注 | `enabled=no` 行与下方说明存在 |
| 指令生成：rawPrompts 注入 | `## 5. Input` 中编号列表与输入一致 |
| `SegmentImportDialog` 挂载 | 三步标题与关键 `data-testid` 存在 |
| Step1 生成指令并复制 | `navigator.clipboard.writeText` 被调用，内容含 `pmf-segments` |
| Step2 粘贴 JSON → 解析 | `parsed.prompts.length` 正确，`stats` 正确 |
| Step2 tagged → 转 JSON | `toSegmentsJson` 可再解析 |
| Step3 预览筛选与勾选 | 筛选后显示条数正确，勾选状态切换生效 |
| 导入成功 → emit `imported` | `wrapper.emitted('imported')` 存在 |

### 6.3 手工验收

| # | 步骤 | 期望 |
|---|------|------|
| H1 | 启动后点击 `📥 分段导入` | 对话框打开，显示 Step1，维度计数正确 |
| H2 | 粘贴 2 条真实长 Prompt → [生成解析指令] | 指令预览出现，含 14 维表与 2 条编号原文 |
| H3 | [复制指令] → 粘贴到任意 LLM → 复制 LLM 返回的 JSON 回 Step2 | 探测 `JSON ✓`，统计正确 |
| H4 | [解析并预览] | 预览卡片按维度分组，`unassigned` 黄底，未知维度标错 |
| H5 | 取消勾选 1 条 `unassigned` → [导入勾选项] | Toast “已导入 N 条”，`StatusBar` 计数更新，`DimensionPanel` 出现新增词条 |
| H6 | 同一 JSON 再次导入（`skip`） | 报告 `modules_skipped == N`，`modules_created == 0` |
| H7 | 粘贴 tagged 文本 → [转为 JSON] → 导入 | 同样成功入库 |
| H8 | 新增自定义维度后重新生成指令 | 新维度出现在维度表中，无需刷新页面 |
| H9 | `cargo check` + `bun run build` + `vitest` | 全部通过 |

---

## 七、风险与应对

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| LLM 输出含多余解释/markdown fences | 高 | 解析失败 | 提示词强制“只输出 JSON”；解析器做 `extractJsonBlock`（截取首个 `{...}`）+ tagged 兜底 |
| 用户原始串含换行/引号导致指令注入歧义 | 中 | LLM 误切 | 指令中 `## 5. Input` 用编号列表包裹，每条原文保持原样，提示词中声明“`raw` 需原样回填” |
| 维度重命名后 LLM 仍用旧 key | 低 | 未知维度告警 | 导入前维度校验标 `unknownDimension`，前端提供下拉重映射；提示词每次生成均为最新维度表 |
| 批量过大（>100 prompts） | 中 | 预览/入库压力 | 预览分页（10 prompts/页），入库分片（100 段/次） |
| 自定义维度 key 含特殊字符 | 低 | 去重失败 | 后端 `key` 匹配大小写不敏感，`trim` 后精确匹配，不做正则放宽 |

---

## 八、验收标准

| 编号 | 验收项 |
|------|--------|
| [P1] | `src/lib/segmentPrompt.ts` 可基于任意 `dimensions` 生成完整 LLM 指令，维度表、约束、示例、原文占位齐全 |
| [P2] | 自定义/禁用维度自动反映在指令中，无需手改模板 |
| [P3] | `SegmentImportDialog` 三步向导可用：输入原文 → 生成/复制指令 → 粘贴 LLM 输出 → 预览校验 → 批量入库 |
| [P4] | 预览支持按维度分组、未分配/待复核高亮、筛选/分页、逐段勾选与重映射 |
| [P5] | Rust 批量入库按 `dimensionKey+contentEn` 去重，支持 `skip`/`overwrite` 与 `unassigned` 三策略，事务原子，幂等 |
| [P6] | 导入后前端计数与维度面板自动刷新，报告准确 |
| [P7] | Rust 单测 + 前端单测覆盖 §6，`cargo check` / `bun run build` / `vitest` 全绿 |

---

## 九、扩展点（非首版必做）

- **直连 LLM API 适配器**：在 `segmentPrompt.ts` 旁新增 `src/lib/llmAdapter.ts`（`provider: 'openai' | 'anthropic' | 'custom'`），复用同一指令模板直接请求，落点仍为 `pmf-segments` JSON 解析链路。
- **一键生成 Assembly 预览**：在 Step3 追加“将当前 prompts 预览为 Assembly”按钮，调 `assemble()` 生成 `finalPrompt` 供用户在批量入库前先验证拼装效果。

---

*施工顺序：`segmentParse.ts`（01）→ `segmentPrompt.ts` → `segment.rs` + `db.ts` 封装 → `SegmentImportDialog.vue` → 入口联动与测试。*
