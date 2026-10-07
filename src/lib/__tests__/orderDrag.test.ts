import { describe, it, expect } from 'vitest'
import { calcInsertIndex } from '../orderDrag'

const rows = [
  { top: 0, height: 40 },
  { top: 40, height: 40 },
  { top: 80, height: 40 },
  { top: 120, height: 40 },
]

describe('calcInsertIndex', () => {
  it('首行下拖：指针越过中点即下移一位', () => {
    // from=0，其余中点 60/100/140
    expect(calcInsertIndex(10, rows, 0)).toBe(0) // 未越过
    expect(calcInsertIndex(61, rows, 0)).toBe(1)
    expect(calcInsertIndex(101, rows, 0)).toBe(2)
    expect(calcInsertIndex(500, rows, 0)).toBe(3) // 拖出底部钳制到末位
  })

  it('末行上拖：指针抬高中点即上移', () => {
    // from=3，其余中点 20/60/100
    expect(calcInsertIndex(130, rows, 3)).toBe(3) // 未越过
    expect(calcInsertIndex(99, rows, 3)).toBe(2)
    expect(calcInsertIndex(59, rows, 3)).toBe(1)
    expect(calcInsertIndex(-50, rows, 3)).toBe(0) // 拖出顶部钳制到首位
  })

  it('中间行双向移动', () => {
    // from=1，其余中点 20/100/140
    expect(calcInsertIndex(50, rows, 1)).toBe(1) // 原位
    expect(calcInsertIndex(10, rows, 1)).toBe(0) // 上移
    expect(calcInsertIndex(110, rows, 1)).toBe(2) // 下移
  })

  it('空数组与单行钳制', () => {
    expect(calcInsertIndex(100, [], 0)).toBe(0)
    expect(calcInsertIndex(100, [{ top: 0, height: 40 }], 0)).toBe(0)
  })
})
