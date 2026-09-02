/**
 * Need01 — 聚合翻译提示词与分片策略
 * 契约：docs/need01/04_聚合提示词与分片策略设计.md 与 06_数据与接口契约.md
 */
import type { Dimension, Module } from '@/engine/models'

export const TRANSLATION_CHUNK_SIZE_DEFAULT = 30
export const TRANSLATION_CHUNK_SIZE_OPTIONS = [30, 50] as const
export const TRANSLATION_LS_CHUNK_SIZE = 'pmf:translate:chunkSize'
export const TRANSLATION_LS_STEP = 'pmf:translate:activeStep'

export type TranslationChunk = {
  chunkId: string
  index: number
  total: number
  modules: Module[]
}

export type BuildTranslationPromptInput = {
  dimension: Dimension
  chunk: TranslationChunk
  totalModules: number
}

export function chunkModules(modules: Module[], size: number): TranslationChunk[] {
  if (size <= 0) throw new Error('chunk size 必须为正数')
  if (modules.length === 0) return []
  const total = Math.ceil(modules.length / size)
  const out: TranslationChunk[] = []
  for (let i = 0; i < modules.length; i += size) {
    const idx = Math.floor(i / size) + 1
    const chunkId = `c${String(idx).padStart(2, '0')}`
    out.push({
      chunkId,
      index: idx,
      total,
      modules: modules.slice(i, i + size),
    })
  }
  return out
}

export function buildTranslationPrompt(input: BuildTranslationPromptInput): string {
  const { dimension, chunk, totalModules } = input
  const key = dimension.key
  const nameCn = dimension.nameCn
  const idx = chunk.index
  const total = chunk.total
  const size = chunk.modules.length
  const perChunk = total > 0 ? Math.ceil(totalModules / total) : size
  const offset = (idx - 1) * perChunk
  const rangeFrom = offset + 1
  const rangeTo = offset + size
  const displayRange = `${rangeFrom}-${Math.min(rangeTo, totalModules)} / ${totalModules}`

  const itemsJson = JSON.stringify(
    chunk.modules.map((m) => ({ id: m.id, contentEn: m.contentEn })),
    null,
    2,
  )

  return [
    '# Role',
    'You are a professional translation assistant for a text-to-image prompt factory.',
    '',
    '# Task',
    'Translate each `contentEn` in the given chunk into concise, natural Chinese',
    '`displayName` values. Return ONLY a JSON object conforming to Output Format.',
    'No explanations, no markdown fences.',
    '',
    '## 1. Context — Dimension',
    `- dimensionKey: ${key}`,
    `- dimensionNameCn: ${nameCn}`,
    `- chunk: c${String(idx).padStart(2, '0')}/${total} (items ${displayRange})`,
    `- Note: This is one of ${total} chunks for this dimension. Translate only the items in this chunk.`,
    '',
    'Rules:',
    '- Keep translations short (2-12 Chinese characters typical); preserve stylistic nuance (e.g. "oversized white shirt" → "宽松白衬衫").',
    '- Do NOT repeat the English. Do NOT add explanations.',
    '',
    '## 2. Output Constraints',
    '- `zh` must be non-empty Chinese, length 1-500 (trimmed). Keep it inside the same semantic field as `contentEn`.',
    '- Preserve `id` verbatim. Unknown ids will be ignored.',
    '- Do NOT change `contentEn`. Translate only.',
    '- If a phrase is ambiguous, choose the most common fashion/prompt sense.',
    '',
    '## 3. Output Format (pmf-translation v1)',
    'Return a single JSON object:',
    '',
    '```json',
    '{',
    '  "format": "pmf-translation",',
    '  "formatVersion": 1,',
    `  "dimensionKey": "${key}",`,
    `  "chunkId": "c${String(idx).padStart(2, '0')}",`,
    `  "totalChunks": ${total},`,
    '  "items": [',
    '    { "id": "<moduleId>", "zh": "<中文显示名>" }',
    '  ]',
    '}',
    '```',
    '',
    `- \`items\` length must equal input item count (${size}).`,
    '- Do NOT wrap the JSON in ```json fences. Do NOT add text before/after.',
    '',
    '## 4. Few-shot Example',
    'Input chunk (dimensionKey=pose, 2 items):',
    '[',
    '  { "id": "m_pose_1", "contentEn": "standing with hands in pockets" },',
    '  { "id": "m_pose_2", "contentEn": "sitting cross-legged on floor" }',
    ']',
    'Output:',
    '{',
    '  "format": "pmf-translation",',
    '  "formatVersion": 1,',
    '  "dimensionKey": "pose",',
    '  "chunkId": "c01",',
    '  "totalChunks": 1,',
    '  "items": [',
    '    { "id": "m_pose_1", "zh": "插兜站立" },',
    '    { "id": "m_pose_2", "zh": "盘腿坐地" }',
    '  ]',
    '}',
    '',
    `## 5. Input — Translate chunk c${String(idx).padStart(2, '0')}/${total} (${size} items):`,
    itemsJson,
    'Return ONLY the JSON object described above.',
  ].join('\n')
}

export function buildAllTranslationPrompts(
  dimension: Dimension,
  modules: Module[],
  chunkSize: number,
): { prompts: string[]; chunks: TranslationChunk[] } {
  const chunks = chunkModules(modules, chunkSize)
  const prompts = chunks.map((chunk) =>
    buildTranslationPrompt({ dimension, chunk, totalModules: modules.length }),
  )
  return { prompts, chunks }
}

export function estimateTranslationTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function buildTranslationExportFilename(dimensionKey: string): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const safeKey = dimensionKey.replace(/[^a-zA-Z0-9_-]/g, '_') || 'dim'
  return `pmf-translate-${safeKey}-${ts}.md`
}

export function buildTranslationExportContent(
  dimension: Dimension,
  modules: Module[],
  chunkSize: number,
  prompts: string[],
): string {
  const total = prompts.length
  const iso = new Date().toISOString()
  const header = `# PMF Translation — dimension ${dimension.key} (${dimension.nameCn}) — ${modules.length} items in ${total} chunks — chunkSize=${chunkSize}\n# Generated at ${iso}\n`
  if (total === 0) return header + '\n（该维度暂无词条）\n'
  const bodies = prompts.map((p, i) => {
    const cId = `c${String(i + 1).padStart(2, '0')}`
    return `--- chunk ${cId}/${total} ---\n\n${p}`
  })
  return `${header}\n${bodies.join('\n\n')}\n`
}
