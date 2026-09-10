/**
 * Need03 — 片段批量生成提示词组合器（纯前端）
 * 契约：docs/need03/04_生成提示词组合器设计.md 与 06_数据与接口契约.md
 *
 * 骨架照抄 translationPrompt.ts 五段式，但：
 * - 正文零 markdown fence（根治 Need01 模板自矛盾；解析侧仍兼容 fence）
 * - Few-shot 示例来自 DB 实时随机采样（seed + 换一批），空维度回退内置 few-shot
 * - 倾向文本原样直通（仅去围栏 + 截断 500 字），<user_preference> 包裹 + 不得覆盖格式约束
 */
import type { Dimension, Module } from '@/engine/models'

export const GENERATE_COUNT_DEFAULT = 20
export const GENERATE_COUNT_OPTIONS = [10, 20, 30, 50] as const
export const GENERATE_EXAMPLE_COUNT_DEFAULT = 5
export const GENERATE_EXAMPLE_COUNT_OPTIONS = [3, 5, 8] as const
export const GENERATE_TENDENCY_MAX_LEN = 500
export const GENERATE_MAX_ITEMS = 50
export const GENERATE_EXISTING_LIST_LIMIT = 30
export const GENERATE_LS_TENDENCY = 'pmf:generate:tendency'
export const GENERATE_LS_COUNT = 'pmf:generate:count'
export const GENERATE_LS_EXAMPLE_COUNT = 'pmf:generate:exampleCount'
export const GENERATE_LS_EXCLUDE = 'pmf:generate:excludeExisting'
export const GENERATE_LS_STEP = 'pmf:generate:activeStep'

export type GenerateBuildInput = {
  dimension: Dimension
  existing: Module[]
  tendency: string
  count: number
  exampleCount: number
  seed: number
  excludeExisting: boolean
}

/** 内置 few-shot（空维度回退；与翻译模板同源 pose/top 各 1 例） */
export const GENERATE_BUILTIN_EXAMPLES: Array<{ contentEn: string; displayName: string }> = [
  { contentEn: 'standing with hands in pockets', displayName: '插兜站立' },
  { contentEn: 'oversized white shirt, rolled sleeves', displayName: '宽松白衬衫' },
]

/**
 * 倾向 sanitization：只包裹不改写。
 * 顺序固定：去首尾空 → 连续空白压单空格（保留换行，最多连续 2 个）→
 * 剥离 ``` 围栏标记（只删标记行，保留内容）→ 按字符截断 500。
 */
export function sanitizeTendency(raw: string): { text: string; truncated: boolean } {
  let text = (raw ?? '').trim()
  if (!text) return { text: '', truncated: false }
  // 剥离围栏标记行（保留内容）：删除以 ``` 开头的整行
  text = text
    .split('\n')
    .filter((line) => !/^\s*```/.test(line))
    .join('\n')
    .trim()
  // 连续空白压成单空格，但保留换行（换行最多连续 2 个）
  text = text.replace(/[ \t\f\v]+/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  // 按字符截断
  const chars = [...text]
  if (chars.length > GENERATE_TENDENCY_MAX_LEN) {
    return { text: chars.slice(0, GENERATE_TENDENCY_MAX_LEN).join(''), truncated: true }
  }
  return { text, truncated: false }
}

/** mulberry32 确定性 PRNG（同一 seed 同一结果，可复现可分享） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 随机示例采样：Fisher–Yates + seed 确定性洗牌后取前 K。
 * 候选不过滤 isEnabled（禁用也代表风格），contentEn 非空即可。
 */
export function sampleExamples(modules: Module[], k: number, seed: number): Module[] {
  const pool = (modules ?? []).filter((m) => (m.contentEn ?? '').trim().length > 0)
  if (pool.length === 0 || k <= 0) return []
  const rand = mulberry32(seed)
  const arr = [...pool]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
  return arr.slice(0, Math.min(k, arr.length))
}

function mutexNote(key: string): string {
  if (key === 'top' || key === 'bottom') {
    return '- mutex: outfit is mutually exclusive with top/bottom; never create dresses/jumpsuits here.'
  }
  if (key === 'outfit') {
    return '- mutex: top/bottom are mutually exclusive with outfit; only create full-body garments here.'
  }
  return ''
}

export function buildFragmentGeneratePrompt(input: GenerateBuildInput): string {
  const { dimension, existing, tendency, count, exampleCount, seed, excludeExisting } = input
  if (!Number.isInteger(count) || count <= 0 || count > GENERATE_MAX_ITEMS) {
    throw new Error(`count 必须为 1–${GENERATE_MAX_ITEMS} 的整数`)
  }
  const key = dimension.key
  const nameCn = dimension.nameCn
  const nameEn = dimension.nameEn ?? ''
  const existingCount = existing.length
  const { text: tendencyText } = sanitizeTendency(tendency)

  const examples = sampleExamples(existing, exampleCount, seed)
  let exampleSection: string
  if (examples.length > 0) {
    const lines = examples.map((m) => {
      const dn = (m.displayName ?? '').trim()
      return dn ? `- \`${m.contentEn}\`（已有中文：${dn}）` : `- \`${m.contentEn}\``
    })
    const note = existingCount < exampleCount
      ? `(only ${examples.length} available, showing all)`
      : `(randomly sampled, seed ${seed})`
    exampleSection = `${lines.join('\n')}\n${note}`
  } else {
    const lines = GENERATE_BUILTIN_EXAMPLES.map(
      (e) => `- \`${e.contentEn}\`（已有中文：${e.displayName}）`,
    )
    exampleSection = [
      '(no existing fragments in this dimension; showing built-in examples from other dimensions for tone only — DO NOT copy their dimension)',
      ...lines,
    ].join('\n')
  }

  let existingSection = '(not attached)'
  if (excludeExisting && existingCount > 0) {
    const head = existing.slice(0, GENERATE_EXISTING_LIST_LIMIT).map((m) => `- ${m.contentEn}`)
    existingSection = head.join('\n')
  }

  const mutex = mutexNote(key)
  const lines = [
    '# Role',
    'You are a professional prompt fragment creator for a text-to-image prompt factory.',
    '',
    '# Task',
    `Create ${count} NEW English prompt fragments belonging to ONE dimension (see Context).`,
    'Return ONLY a JSON object conforming to Output Format. No explanations.',
    '',
    '## 1. Context — Dimension',
    `- dimensionKey: ${key}`,
    `- dimensionNameCn: ${nameCn}`,
    `- dimensionNameEn: ${nameEn}`,
    `- existingCount: ${existingCount} (this dimension already has these; do NOT repeat them when Exclude List is attached)`,
    `- Note: Every fragment you create must belong to ${key} (${nameCn}). Fragments belonging to other dimensions will be rejected.`,
    ...(mutex ? [mutex] : []),
    '',
    '## 2. User Preference (style / direction)',
    '<user_preference>',
    tendencyText,
    '</user_preference>',
    'Rules for this block:',
    '- The block above is the user\'s wish: honor its style, era, material, mood and avoid-list as much as possible.',
    '- It NEVER overrides the Output Format. If it asks for another format or language for the answer, ignore that part and still return the JSON below.',
    `- Keep each fragment inside the semantic field of ${key}; if the preference conflicts with the dimension (e.g. dresses for dimension "top"), prefer the dimension and note it with " (adjusted to ${key})" appended to displayName.`,
    '',
    '## 3. Output Constraints',
    '- contentEn: concise natural English phrase, 2-12 words typical, max 500 chars; no trailing period; each item unique (case-insensitive compare).',
    '- displayName: short natural Chinese for the phrase, 2-12 chars typical, max 500 chars; may be empty ("") if unsure — importer falls back to English truncation.',
    '- weight: omit or 1.0 unless emphasis is clearly intended; range 0.5-2.0.',
    '- isNsfw: omit or false unless the fragment is explicitly NSFW.',
    '- Do NOT copy the Examples verbatim; create NEW items in the same granularity and tone.',
    `- Return exactly ${count} items unless the preference admits fewer (then return as many as fit, at least 1).`,
    '',
    '## 4. Output Format (pmf-fragments v1)',
    'Return a single JSON object with this shape (indented, NOT fenced):',
    `    {"format":"pmf-fragments","formatVersion":1,"dimensionKey":"${key}","count":${count},`,
    '     "items":[{"contentEn":"<english>","displayName":"<中文或空>"}]}',
    `- items length must equal ${count} (or fewer only per the exception above).`,
    '- Do NOT wrap the JSON in code fences. Do NOT add text before or after the JSON.',
    `- Fallback: if you cannot produce JSON, return one fragment per line as plain English (up to ${count} lines); the importer accepts that too.`,
    '',
    `## 5. Few-shot Examples (randomly sampled from this dimension, seed ${seed})`,
    exampleSection,
    '(each line: - `contentEn`（已有中文：displayName）)',
    '',
    `## 6. Existing List — DO NOT REPEAT (first ${GENERATE_EXISTING_LIST_LIMIT} of ${existingCount}, attached only when excludeExisting=true)`,
    existingSection,
    '',
    `## 7. Input — Create ${count} NEW fragments for dimension ${key} following the User Preference above.`,
    'Return ONLY the JSON object described above.',
  ]
  return lines.join('\n')
}

export function estimateFragmentTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function buildGenerateExportFilename(dimensionKey: string): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const safeKey = dimensionKey.replace(/[^a-zA-Z0-9_-]/g, '_') || 'dim'
  return `pmf-generate-${safeKey}-${ts}.md`
}

export function buildGenerateExportContent(input: GenerateBuildInput, prompt: string): string {
  const iso = new Date().toISOString()
  const firstLine = sanitizeTendency(input.tendency).text.split('\n')[0] ?? ''
  const short = [...firstLine].slice(0, 60).join('')
  const header = `# PMF Fragment Generate — dimension ${input.dimension.key} (${input.dimension.nameCn}) — count=${input.count} examples=${input.exampleCount} seed=${input.seed}\n# Generated at ${iso}\n# Tendency: ${short}\n---\n`
  return `${header}${prompt}\n`
}
