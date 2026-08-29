import { describe, it, expect } from 'vitest'
import { parseBatchText, filterValidItems } from './moduleBatch'

describe('parseBatchText', () => {
  it('回车分隔基本路径：有效行统计正确', () => {
    const p = parseBatchText('oversized white shirt\ncropped black tank top\nlace-trim silk camisole')
    expect(p.stats.total).toBe(3)
    expect(p.stats.valid).toBe(3)
    expect(p.stats.empty).toBe(0)
    expect(p.lines.every((l) => l.displayName.length <= 20)).toBe(true)
  })

  it('空行忽略：trim 后空行标记 empty，不计 valid', () => {
    const p = parseBatchText('a\n\n  \n b\n')
    expect(p.stats.empty).toBe(3)
    expect(p.stats.valid).toBe(2)
    expect(p.lines.filter((l) => l.status === 'empty').length).toBe(3)
  })

  it('\\r\\n 与 \\n 混用', () => {
    const p = parseBatchText('a\r\nb\nc\r\nd')
    expect(p.lines.length).toBe(4)
    expect(p.stats.valid).toBe(4)
  })

  it('批次内重复标记 duplicate_in_batch（大小写敏感）', () => {
    const p = parseBatchText('hello\nhello\nHELLO\nhello ')
    // 'hello ' trim -> 'hello' duplicate
    expect(p.stats.duplicateInBatch).toBe(2)
    // HELLO != hello
    expect(p.lines[2]!.status).toBe('ok')
    expect(p.lines[1]!.status).toBe('duplicate_in_batch')
    expect(p.lines[3]!.status).toBe('duplicate_in_batch')
    expect(filterValidItems(p).length).toBe(2)
  })

  it('超长 500 截断 + warning', () => {
    const long = 'x'.repeat(600)
    const p = parseBatchText(long)
    expect(p.stats.tooLong).toBe(1)
    expect(p.lines[0]!.status).toBe('too_long')
    expect(p.lines[0]!.contentEn.length).toBe(500)
    expect(p.lines[0]!.warnings.length).toBe(1)
    expect(p.stats.valid).toBe(1)
  })

  it('批次内重复且超长：状态为 duplicate_in_batch', () => {
    const long = 'y'.repeat(600)
    const p = parseBatchText(`${long}\n${long}`)
    expect(p.lines[0]!.status).toBe('too_long')
    expect(p.lines[1]!.status).toBe('duplicate_in_batch')
  })

  it('超 500 行截断：仅保留前 500，warning 提示分批', () => {
    const big = Array.from({ length: 600 }, (_, i) => `line ${i}`).join('\n')
    const p = parseBatchText(big)
    expect(p.lines.length).toBe(500)
    expect(p.stats.total).toBe(600)
    expect(p.warnings.join('')).toContain('500')
    expect(p.stats.valid).toBe(500)
  })

  it('maxLines/maxLen 可覆盖', () => {
    const p = parseBatchText('a\nb\nc', { maxLines: 2, maxLen: 1 })
    expect(p.lines.length).toBe(2)
    expect(p.warnings.length).toBe(1)
    // len=1 so 'a' ok, but test deviation: next line truncated not needed here
  })

  it('displayName 派生为 contentEn 前 20 字符', () => {
    const p = parseBatchText('abcdefghijklmnopqrstuvwxyz')
    expect(p.lines[0]!.displayName).toBe('abcdefghijklmnopqrst')
  })
})
