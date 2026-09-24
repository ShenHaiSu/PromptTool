/**
 * need01 需求3+4 API 封装（报表查询 + 手动单发）。
 * 与 `src/lib/imageQueueApi.ts` 同风格：参数一律 camelCase。
 */
import { invoke } from '@tauri-apps/api/core'

export interface LedgerSummary {
  total: number
  succeeded: number
  failed: number
  pixels: number
  avgElapsedMs: number
}

export interface LedgerDailyRow {
  day: string
  total: number
  succeeded: number
  pixels: number
}

export interface LedgerHourlyRow {
  hour: number
  total: number
  succeeded: number
  pixels: number
}

export interface SinglePreview {
  imageBase64: string
  mime: string
  elapsedMs: number
}

export interface SingleSaveResult {
  filename: string
  filePath: string
}

export async function statsLedgerSummary(from: string, to: string): Promise<LedgerSummary> {
  return invoke<LedgerSummary>('stats_ledger_summary', { from, to })
}

export async function statsLedgerDaily(from: string, to: string): Promise<LedgerDailyRow[]> {
  return invoke<LedgerDailyRow[]>('stats_ledger_daily', { from, to })
}

export async function statsLedgerHourly(day: string): Promise<LedgerHourlyRow[]> {
  return invoke<LedgerHourlyRow[]>('stats_ledger_hourly', { day })
}

/** 需求4 生成：内存预览，不落盘。 */
export async function iqGenerateOnePreview(prompt: string, size: string, ratio: string): Promise<SinglePreview> {
  return invoke<SinglePreview>('iq_generate_one_preview', { prompt, size, ratio })
}

/** 需求4 保存：落盘 + ledger source=single。outputDir 为空走队列默认。 */
export async function iqSavePreview(
  imageBase64: string,
  prompt: string,
  size: string,
  ratio: string,
  outputDir?: string,
): Promise<SingleSaveResult> {
  return invoke<SingleSaveResult>('iq_save_preview', {
    imageBase64,
    prompt,
    size,
    ratio,
    outputDir: outputDir ?? null,
  })
}

/** yyyy-MM-dd（本机）。 */
export function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayStr(): string {
  return toYmd(new Date())
}

export function addDaysStr(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10))
  const dt = new Date(y || 2000, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + delta)
  return toYmd(dt)
}

/** 像素总量展示：≥1M 显示 MP，否则显示 k。 */
export function formatPixels(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}MP`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
