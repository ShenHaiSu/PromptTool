import { describe, it, expect } from 'vitest'
import { calcPopoverPos, calcMenuPos } from '@/lib/need05Position'

describe('need05Position', () => {
  it('popover 默认下方', () => {
    const pos = calcPopoverPos({ top: 100, bottom: 120, left: 50 }, 224, 180, 1024, 768)
    expect(pos.top).toBe(128)
    expect(pos.left).toBe(50)
  })
  it('popover 下方不足翻转至上方', () => {
    const pos = calcPopoverPos({ top: 650, bottom: 670, left: 50 }, 224, 180, 1024, 768)
    expect(pos.top).toBe(650 - 180 - 8)
  })
  it('popover 水平溢出收敛', () => {
    const pos = calcPopoverPos({ top: 100, bottom: 120, left: 900 }, 224, 180, 1024, 768)
    expect(pos.left).toBe(1024 - 224 - 8)
  })
  it('menu 视口收敛', () => {
    const pos = calcMenuPos(1000, 700, 180, 80, 1024, 768)
    expect(pos.left).toBeLessThan(1000)
    expect(pos.top).toBeLessThan(700)
  })
  it('极端小视口 top 不为负', () => {
    const pos = calcPopoverPos({ top: 2, bottom: 10, left: 2 }, 224, 180, 300, 200)
    expect(pos.top).toBeGreaterThanOrEqual(8)
    expect(pos.left).toBeGreaterThanOrEqual(8)
  })
})
