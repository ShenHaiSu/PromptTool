/**
 * need02-02 图片元数据展示纯函数（可单测，无 Tauri 依赖）。
 * 字段来源：后端 queue.rs#783 meta={prompt,irHash,size,ratio,model,imageUrl,elapsedMs,createdAt,taskId}，
 * 前端 imageQueueApi.ts EmbeddedImageMeta。缺字段（老图无 taskId）显示 '—' 而非崩。
 */
import type { EmbeddedImageMeta } from '@/lib/imageQueueApi'

export const META_DASH = '—'

/** createdAt 秒 → 本地全串；非法/缺失回 '—'。 */
export function formatCreatedAt(sec: number | null | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return META_DASH
  try {
    const d = new Date(sec * 1000)
    if (Number.isNaN(d.getTime())) return META_DASH
    return d.toLocaleString()
  } catch {
    return META_DASH
  }
}

/** createdAt 秒 → 相对时间（刚刚/x分钟前/x小时前/x天前）；非法回 ''。 */
export function formatRelativeTime(sec: number | null | undefined, nowMs: number = Date.now()): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return ''
  const diff = nowMs - sec * 1000
  if (!Number.isFinite(diff) || diff < 0) return ''
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day}天前`
  const mon = Math.floor(day / 30)
  if (mon < 12) return `${mon}个月前`
  return `${Math.floor(mon / 12)}年前`
}

/** 生成时间组合：本地串 + 相对时间；缺失回 '—'。 */
export function formatCreatedAtFull(sec: number | null | undefined, nowMs: number = Date.now()): string {
  const base = formatCreatedAt(sec)
  if (base === META_DASH) return base
  const rel = formatRelativeTime(sec, nowMs)
  return rel ? `${base}（${rel}）` : base
}

/** elapsedMs → 'xx.xs'；非法/缺失回 '—'。 */
export function formatElapsed(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return META_DASH
  return `${(ms / 1000).toFixed(1)}s`
}

export interface MetaBasicDisplay {
  model: string
  size: string
  ratio: string
  createdAtText: string
  elapsedText: string
  taskId: string
  imageUrl: string
  irHash: string
  promptLength: number
  hasPrompt: boolean
}

function text(v: string | null | undefined): string {
  const t = (v ?? '').trim()
  return t ? t : META_DASH
}

/** 字段分组：基础/更多展示用显示串，缺字段一律 '—'。 */
export function groupMeta(m: EmbeddedImageMeta | null | undefined): MetaBasicDisplay {
  if (!m) {
    return {
      model: META_DASH,
      size: META_DASH,
      ratio: META_DASH,
      createdAtText: META_DASH,
      elapsedText: META_DASH,
      taskId: META_DASH,
      imageUrl: META_DASH,
      irHash: META_DASH,
      promptLength: 0,
      hasPrompt: false,
    }
  }
  const prompt = (m.prompt ?? '').trim()
  return {
    model: text(m.model),
    size: text(m.size),
    ratio: text(m.ratio),
    createdAtText: formatCreatedAtFull(m.createdAt),
    elapsedText: formatElapsed(m.elapsedMs),
    taskId: text(m.taskId),
    imageUrl: text(m.imageUrl),
    irHash: text(m.irHash),
    promptLength: prompt.length,
    hasPrompt: prompt.length > 0,
  }
}

/** prompt 复制文本拼装：prompt 主体 + 元信息脚注（无 prompt 时回 ''）。 */
export function buildCopyText(m: EmbeddedImageMeta | null | undefined): string {
  const prompt = (m?.prompt ?? '').trim()
  if (!prompt) return ''
  const g = groupMeta(m)
  const metaLine = [g.model, g.size, g.ratio].every((v) => v === META_DASH)
    ? ''
    : `\n\n—— ${[g.model, g.size, g.ratio].filter((v) => v !== META_DASH).join(' · ')}`
  return `${prompt}${metaLine}`
}
