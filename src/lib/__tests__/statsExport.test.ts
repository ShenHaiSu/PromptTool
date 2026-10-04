import { describe, it, expect } from 'vitest'
import { buildStatsLedgerCsvText } from '@/lib/export'

function baseOpts() {
  return {
    from: '2026-09-28',
    to: '2026-10-04',
    focusDay: '2026-10-04',
    summary: { total: 10, succeeded: 8, failed: 2, pixels: 12345, avgElapsedMs: 1200 },
    daily: [{ day: '2026-10-04', total: 5, succeeded: 4, pixels: 1000 }],
    hourly: [{ hour: 10, total: 2, succeeded: 2, pixels: 500 }],
  }
}

describe('need01-03 statsExport', () => {
  it('段头存在：汇总/按天/按小时', () => {
    const csv = buildStatsLedgerCsvText(baseOpts())
    expect(csv).toContain('汇总')
    expect(csv).toContain('按天')
    expect(csv).toContain('按小时')
    expect(csv).toContain('日期')
    expect(csv).toContain('小时')
  })
  it('BOM 头', () => {
    const csv = buildStatsLedgerCsvText(baseOpts())
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })
  it('引号转义：日期含引号被双写', () => {
    const csv = buildStatsLedgerCsvText({
      ...baseOpts(),
      daily: [{ day: '2026-10-"04', total: 1, succeeded: 1, pixels: 10 }],
    })
    expect(csv).toContain('""04')
  })
  it('空 daily 不抛且保留汇总段+暂无数据', () => {
    const csv = buildStatsLedgerCsvText({ ...baseOpts(), daily: [], hourly: [] })
    expect(csv).toContain('汇总')
    expect(csv).toContain('暂无数据')
  })
})
