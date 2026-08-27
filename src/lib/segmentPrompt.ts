/**
 * Segment instruction prompt generator — 基于 DB dimensions 动态生成 LLM 解析指令
 * 契约：docs/need03/02_LLM解析提示词与前端交互方案.md §2
 */
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

const EXAMPLE_1_JSON = `{
  "format": "pmf-segments",
  "formatVersion": 1,
  "createdAt": 1756000000,
  "generator": "llm",
  "source": { "rawCount": 1 },
  "counts": { "prompts": 1, "segments": 10, "unassigned": 0 },
  "prompts": [
    {
      "id": "p01",
      "raw": "slim waist, long legs, oval face with natural makeup, white oversized shirt, high-waisted wide-leg jeans, white sneakers, gold hoop earrings, standing with hands in pockets, holding coffee cup, minimalist white studio backdrop, 85mm lens, shallow depth of field, soft lighting",
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
}`

const EXAMPLE_2_JSON = `{
  "format": "pmf-segments",
  "formatVersion": 1,
  "createdAt": 1756000000,
  "generator": "llm",
  "source": { "rawCount": 1 },
  "counts": { "prompts": 1, "segments": 6, "unassigned": 0 },
  "prompts": [
    {
      "id": "p01",
      "raw": "red bodycon dress, knee-length, wavy long hair, standing with one hand on hip, rooftop city skyline at sunset, 50mm lens natural light",
      "segments": [
        { "dimensionKey": "outfit", "contentEn": "red bodycon dress, knee-length" },
        { "dimensionKey": "face", "contentEn": "wavy long hair" },
        { "dimensionKey": "pose", "contentEn": "standing with one hand on hip" },
        { "dimensionKey": "background", "contentEn": "rooftop city skyline at sunset" },
        { "dimensionKey": "camera", "contentEn": "50mm lens, natural light" }
      ]
    }
  ]
}`

export type PromptBuildInput = {
  dimensions: Dimension[]
  rawPrompts: string[]
}

export function buildDimensionTable(dimensions: Dimension[]): string {
  const sorted = [...dimensions].sort((a, b) => a.sortOrder - b.sortOrder)
  const header = '| dimensionKey | nameCn | nameEn | multi | enabled | description |'
  const sep = '|---|---|---|---|---|---|'
  const rows = sorted.map((d) => {
    const key = d.key
    const desc = DIMENSION_DESCRIPTIONS[key] ?? `${d.nameCn} / ${d.nameEn || key}（自定义维度）`
    const multi = d.isMultiSelect ? 'multi' : 'single'
    const enabled = d.isEnabled ? 'yes' : 'no'
    const nameEn = (d.nameEn || '').replace(/\|/g, '\\|')
    const nameCn = d.nameCn.replace(/\|/g, '\\|')
    return `| ${key} | ${nameCn} | ${nameEn} | ${multi} | ${enabled} | ${desc} |`
  })
  // Add unassigned row as implicit key
  rows.push('| unassigned | 未分配 | Unassigned | single | yes | 无法归入任何维度、或质量词/权重残留 |')
  const table = [header, sep, ...rows].join('\n')
  const hasDisabled = sorted.some(d => !d.isEnabled)
  const note = hasDisabled ? '\n\n> Disabled dimensions are still valid keys but will be flagged on import.' : ''
  return table + note
}

export function buildSegmentInstructionPrompt(input: PromptBuildInput): string {
  const { dimensions, rawPrompts } = input
  if (rawPrompts.length === 0) {
    throw new Error('rawPrompts 不能为空')
  }
  if (rawPrompts.length > 500) {
    throw new Error('rawPrompts 数量不能超过 500')
  }
  const dimensionTable = buildDimensionTable(dimensions)
  const largeNote = rawPrompts.length > 50
    ? '\n> Note: Input is large (' + String(rawPrompts.length) + ' prompts); segment faithfully without omitting any prompt.\n'
    : ''
  const numbered = rawPrompts.map((s, i) => `${String(i + 1)}. ${s}`).join('\n')

  return [
    '# Role',
    'You are a professional prompt segmentation assistant for a text-to-image prompt factory.',
    '',
    '# Task',
    'Segment each of the given raw prompts (comma-separated natural language) into structured segments,',
    'each assigned to exactly one `dimensionKey` from the Dimensions table below.',
    'Return ONLY a JSON object conforming to the Output Format. No explanations, no markdown fences.',
    '',
    '## 1. Dimensions (Allowed `dimensionKey`)',
    dimensionTable,
    '',
    'Rules for dimensions:',
    '- `isMultiSelect=multi` dimensions (e.g. accessories) may have multiple segments per prompt; others should be merged into one segment per dimension when possible.',
    '- `outfit` is mutually exclusive with `top`/`bottom` in the same prompt; prefer `outfit` when the raw text describes a dress / jumpsuit / full outfit.',
    '- If a phrase does not fit any dimension, or is a quality booster (masterpiece, 8k, ultra detailed), assign it to `unassigned`.',
    largeNote,
    '## 2. Output Constraints',
    '- `contentEn` must be the exact English substring from the raw prompt (trimmed), preserving wording.',
    '- `weight` is optional, default 1.0; only set when emphasis is clearly intended (e.g. `(xxx:1.3)`). Range 0.5-2.0.',
    '- `isNsfw` is optional, default false; set true only when the segment is explicitly NSFW.',
    '- `dimensionKey` must be one of the table keys or `unassigned`; unknown keys will be treated as `unassigned`.',
    '- Comma-separated phrases in the raw prompt are natural split points; keep each segment independently reusable.',
    '',
    '## 3. Output Format (pmf-segments v1)',
    'Return a single JSON object:',
    '',
    '```json',
    '{',
    '  "format": "pmf-segments",',
    '  "formatVersion": 1,',
    '  "createdAt": 1756000000,',
    '  "generator": "llm",',
    '  "source": { "rawCount": <number of prompts> },',
    '  "counts": { "prompts": <n>, "segments": <m>, "unassigned": <k> },',
    '  "prompts": [',
    '    {',
    '      "id": "p01",',
    '      "raw": "<exact raw prompt string>",',
    '      "segments": [',
    '        { "dimensionKey": "<key>", "contentEn": "<english phrase>", "weight": 1.0, "isNsfw": false }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    '- `raw` must equal the input raw prompt verbatim.',
    '- `counts` / `createdAt` may be filled by you; they are not validated strictly.',
    '- Do NOT wrap the JSON in ```json fences. Do NOT add any text before or after the JSON.',
    '',
    '## 4. Few-shot Examples',
    '',
    '### Example 1',
    'Raw: "slim waist, long legs, oval face with natural makeup, white oversized shirt, high-waisted wide-leg jeans, white sneakers, gold hoop earrings, standing with hands in pockets, holding coffee cup, minimalist white studio backdrop, 85mm lens shallow depth of field soft lighting"',
    'Output:',
    EXAMPLE_1_JSON,
    '',
    '### Example 2',
    'Raw: "red bodycon dress, knee-length, wavy long hair, standing with one hand on hip, rooftop city skyline at sunset, 50mm lens natural light"',
    'Output:',
    EXAMPLE_2_JSON,
    '',
    `## 5. Input — Segment the following prompts (${String(rawPrompts.length)} in total):`,
    numbered,
    '',
    'Return ONLY the JSON object described above.',
  ].filter(s => s !== '').join('\n')
}

export function estimatePromptTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export async function copyInstructionPrompt(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}
