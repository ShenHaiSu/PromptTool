import { describe, it, expect } from 'vitest'
import {
  formatCreatedAt,
  formatElapsed,
  formatRelativeTime,
  groupMeta,
  buildCopyText,
  META_DASH,
} from '@/lib/imageMeta'

const META = {
  prompt: 'a small glass cube',
  irHash: 'abc123',
  size: '2K',
  ratio: '16:9',
  model: 'agnes-image-2.5-flash',
  imageUrl: 'https://x/y.png',
  elapsedMs: 1500,
  createdAt: 1720000000,
  taskId: 'd1',
}

describe('need02-02 imageMeta 纯函数', () => {
  it('formatCreatedAt：合法秒转本地串，非法回 —', () => {
    expect(formatCreatedAt(1720000000)).not.toBe(META_DASH)
    expect(formatCreatedAt(null)).toBe(META_DASH)
    expect(formatCreatedAt(0)).toBe(META_DASH)
    expect(formatCreatedAt(NaN)).toBe(META_DASH)
  })

  it('formatRelativeTime：刚刚/分钟/小时/天', () => {
    const now = 1720000000 * 1000 + 30 * 1000
    expect(formatRelativeTime(1720000000, now)).toBe('刚刚')
    expect(formatRelativeTime(1720000000, 1720000000 * 1000 + 5 * 60000)).toBe('5分钟前')
    expect(formatRelativeTime(1720000000, 1720000000 * 1000 + 3 * 3600 * 1000)).toBe('3小时前')
    expect(formatRelativeTime(1720000000, 1720000000 * 1000 + 2 * 86400 * 1000)).toBe('2天前')
    expect(formatRelativeTime(null)).toBe('')
  })

  it('formatElapsed：ms → xx.xs', () => {
    expect(formatElapsed(1500)).toBe('1.5s')
    expect(formatElapsed(0)).toBe('0.0s')
    expect(formatElapsed(null)).toBe(META_DASH)
    expect(formatElapsed(-1)).toBe(META_DASH)
  })

  it('groupMeta：缺字段回 — 而非崩', () => {
    const g = groupMeta({ ...META, taskId: '', irHash: null, imageUrl: '' } as never)
    expect(g.taskId).toBe(META_DASH)
    expect(g.irHash).toBe(META_DASH)
    expect(g.imageUrl).toBe(META_DASH)
    expect(g.hasPrompt).toBe(true)
    expect(g.promptLength).toBe(META.prompt.length)
    const empty = groupMeta(null)
    expect(empty.model).toBe(META_DASH)
    expect(empty.hasPrompt).toBe(false)
  })

  it('buildCopyText：含 prompt 主体，无 prompt 回空', () => {
    const t = buildCopyText(META)
    expect(t).toContain('a small glass cube')
    expect(buildCopyText(null)).toBe('')
    expect(buildCopyText({ ...META, prompt: '  ' })).toBe('')
  })
})
