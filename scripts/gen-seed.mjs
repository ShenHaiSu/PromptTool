// 从 docs/samplePrompt 生成 src/lib/seed-data.ts（阶段二种子数据）。
// 口径对标 src-tauri/src/commands/migration.rs：
// - 14 维定义（ensure_dimensions）+ TARGET_ORDER
// - 词条 id = mod_{key}_{num:02}（num 取自文件名 stem 最后一个 _ 后数字）
// - 空文件跳过；displayName 回落取 content 全文；weight 1.0（Rust import_sample_prompts）
// - NSFW_MODULE_IDS / DISABLED_GENDER_IDS 同 migration.rs
// 用法：node scripts/gen-seed.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const sampleDir = join(root, 'docs', 'samplePrompt')
const outFile = join(root, 'src', 'lib', 'seed-data.ts')

const DIMS = [
  ['dim_01', 'body', '模特身材特点', 'Body', 4, 0],
  ['dim_02', 'face', '模特面部特点', 'Face', 5, 0],
  ['dim_03', 'top', '模特上装', 'Top', 6, 0],
  ['dim_04', 'bottom', '模特下装', 'Bottom', 7, 0],
  ['dim_05', 'outfit', '模特全身套装', 'Outfit', 8, 0],
  ['dim_06', 'shoes', '模特鞋袜', 'Shoes', 9, 0],
  ['dim_07', 'accessories', '模特配饰', 'Accessories', 10, 1],
  ['dim_08', 'pose', '模特姿势', 'Pose', 11, 0],
  ['dim_09', 'props', '交互物品', 'Props', 12, 0],
  ['dim_10', 'background', '背景风格', 'Background', 13, 0],
  ['dim_11', 'camera', '相机参数', 'Camera', 14, 0],
  ['dim_12', 'gender', '模特性别', 'Gender', 1, 0],
  ['dim_13', 'ethnicity', '模特人种', 'Ethnicity', 2, 0],
  ['dim_14', 'height', '模特身高', 'Height', 3, 0],
]

const NSFW = new Set([
  'mod_body_15', 'mod_face_15', 'mod_top_15', 'mod_bottom_15', 'mod_outfit_15',
  'mod_shoes_15', 'mod_accessories_15', 'mod_pose_15', 'mod_props_15',
  'mod_background_15', 'mod_camera_15',
  ...['body', 'face', 'top', 'bottom', 'outfit', 'shoes', 'accessories', 'pose', 'props', 'background', 'camera']
    .flatMap((k) => [`mod_${k}_26`, `mod_${k}_27`, `mod_${k}_28`]),
])
const DISABLED_GENDER = new Set([
  'mod_gender_11', 'mod_gender_12', 'mod_gender_13', 'mod_gender_14', 'mod_gender_15',
])

const esc = (s) => JSON.stringify(s)

const dimLines = DIMS.map(
  ([id, key, cn, en, order, multi]) =>
    `  { id: '${id}', key: '${key}', nameCn: ${esc(cn)}, nameEn: '${en}', sortOrder: ${order}, isMultiSelect: ${multi === 1} },`,
)

const modLines = []
let skipped = 0
for (const [, key] of DIMS) {
  const dir = join(sampleDir, key)
  let files
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()
  } catch {
    continue
  }
  for (const f of files) {
    const content = readFileSync(join(dir, f), 'utf8').trim()
    if (!content) {
      skipped += 1
      continue
    }
    const stem = f.slice(0, -4)
    const numStr = stem.split('_').pop() || '01'
    const num = Number.parseInt(numStr, 10) || 1
    const id = `mod_${key}_${String(num).padStart(2, '0')}`
    const isNsfw = NSFW.has(id) && id !== 'mod_gender_15'
    const isEnabled = !DISABLED_GENDER.has(id)
    modLines.push(
      `  { id: '${id}', dimKey: '${key}', contentEn: ${esc(content)}, displayName: ${esc(content)}, isNsfw: ${isNsfw}, isEnabled: ${isEnabled} },`,
    )
  }
}

const header = `// 由 scripts/gen-seed.mjs 从 docs/samplePrompt + migration.rs 常量生成，请勿手改。
// 重新生成：node scripts/gen-seed.mjs
export type SeedDimension = {
  id: string
  key: string
  nameCn: string
  nameEn: string
  sortOrder: number
  isMultiSelect: boolean
}

export type SeedModule = {
  id: string
  dimKey: string
  contentEn: string
  displayName: string
  isNsfw: boolean
  isEnabled: boolean
}

export type SeedRule = {
  id: string
  name: string
  type: string
  sourceDimensionId: string | null
  sourceModuleId: string | null
  targetDimensionId: string | null
  targetModuleId: string | null
  message: string
}

export const SEED_VERSION = 1

export const SEED_DIMENSIONS: SeedDimension[] = [
${dimLines.join('\n')}
]
export const SEED_MODULES: SeedModule[] = [
${modLines.join('\n')}
]
export const SEED_RULES: SeedRule[] = [
  { id: 'rule_01', name: '套装互斥', type: 'mutex', sourceDimensionId: 'dim_05', sourceModuleId: null, targetDimensionId: 'dim_03', targetModuleId: null, message: '已选全身套装，上装/下装将自动忽略' },
  { id: 'rule_02', name: '鞋袜与赤脚互斥', type: 'mutex', sourceDimensionId: 'dim_06', sourceModuleId: 'mod_shoes_15', targetDimensionId: 'dim_06', targetModuleId: null, message: '赤脚与鞋袜不可共存' },
  { id: 'rule_03', name: '室内外背景互斥', type: 'excludes', sourceDimensionId: 'dim_10', sourceModuleId: 'mod_bg_01', targetDimensionId: 'dim_10', targetModuleId: null, message: '室内背景与户外背景冲突' },
]
`

writeFileSync(outFile, header)
console.log(`dims=${DIMS.length} modules=${modLines.length} skippedEmpty=${skipped} -> ${outFile}`)
