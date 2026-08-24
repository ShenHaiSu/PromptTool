/**
 * CSV 导出 — 对标 src/exporter.py
 * 列：序号 / 提示词 / 维度构成 / 冲突警告
 * 前端 Blob 下载（UTF-8-BOM，Excel 可直接打开）；Tauri 侧亦提供 Rust db_export_csv 兜底
 */
import type { PromptIR } from '@/engine/models'

function escCell(s: string): string {
  // CSV RFC4180: 包双引号，转义双引号为 ""
  return `"${s.replace(/"/g, '""')}"`
}

export type ExportRow = {
  finalPrompt: string
  segments: PromptIR['segments']
  warnings: string[]
}

function dimChain(segments: PromptIR['segments']): string {
  return segments.map((s) => s.dimensionKey).join(' > ')
}

function promptFromSegments(segments: PromptIR['segments']): string {
  return segments.map((s) => s.text).join(', ')
}

/**
 * 将 results 导出为 CSV 并自动下载（前端 BOM + Blob）
 * results 可为 BatchCardModel[] / PromptIR[] / {finalPrompt,ir,warnings} 混用，通过适配器归一
 */
export function exportCsv(filename: string, rows: ExportRow[]): void {
  const header = ['序号', '提示词', '维度构成', '冲突警告']
  const lines: string[] = []
  lines.push(header.map(escCell).join(','))
  rows.forEach((r, idx) => {
    const prompt = r.finalPrompt || promptFromSegments(r.segments ?? [])
    const dims = dimChain(r.segments ?? [])
    const warns = (r.warnings ?? []).join(' | ')
    lines.push([String(idx + 1), escCell(prompt), escCell(dims), escCell(warns)].join(','))
  })
  const csv = '\uFEFF' + lines.join('\n') + '\n'
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 便捷：从 batch.results 导出 */
export function exportBatchCsv(results: Array<{ finalPrompt: string; warnings: string[]; ir: PromptIR }>): void {
  const rows: ExportRow[] = results.map((r) => ({
    finalPrompt: r.finalPrompt,
    segments: r.ir?.segments ?? [],
    warnings: r.warnings ?? [],
  }))
  exportCsv(`pmf-batch-${Date.now()}.csv`, rows)
}

/** 便捷：导出单条 PromptIR */
export function exportSingleCsv(ir: PromptIR, finalPrompt: string): void {
  exportCsv(`pmf-prompt-${Date.now()}.csv`, [
    { finalPrompt, segments: ir.segments, warnings: ir.warnings },
  ])
}

/**
 * 生成 CSV 文本（不下载），供 Rust db_export_csv 传入或测试校验
 * 含 BOM
 */
export function buildCsvText(rows: ExportRow[]): string {
  const header = ['序号', '提示词', '维度构成', '冲突警告']
  const lines: string[] = []
  lines.push(header.map(escCell).join(','))
  rows.forEach((r, idx) => {
    const prompt = r.finalPrompt || promptFromSegments(r.segments ?? [])
    const dims = dimChain(r.segments ?? [])
    const warns = (r.warnings ?? []).join(' | ')
    lines.push([String(idx + 1), escCell(prompt), escCell(dims), escCell(warns)].join(','))
  })
  return '\uFEFF' + lines.join('\n') + '\n'
}
