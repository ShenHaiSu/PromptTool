import { describe, it, expect } from 'vitest'
import { formatPixels, toYmd, addDaysStr, todayStr } from '@/lib/statsApi'

describe('need01 需求3 报表 helper', () => {
  it('formatPixels 按 MP/k 展示', () => {
    expect(formatPixels(0)).toBe('0')
    expect(formatPixels(1048576)).toContain('MP')
    expect(formatPixels(5000)).toContain('k')
    expect(formatPixels(999)).toBe('999')
  })
  it('日期 helper 本机 yyyy-MM-dd', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(toYmd(new Date(2026, 8, 24))).toBe('2026-09-24')
    expect(addDaysStr('2026-09-24', -6)).toBe('2026-09-18')
  })
})
