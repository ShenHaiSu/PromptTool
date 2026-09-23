import { describe, expect, it } from 'vitest'
import { displayPath, stripVerbatim } from '../pathDisplay'

const BS = String.fromCharCode(92)
const VERB = BS + BS + '?' + BS // \\?\

describe('stripVerbatim（与后端 strip_verbatim 锁定）', () => {
  it('B1: 去驱动器 verbatim 前缀', () => {
    expect(stripVerbatim(VERB + 'D:' + BS + 'a.db')).toBe('D:' + BS + 'a.db')
  })
  it('B2: 去 UNC verbatim 前缀', () => {
    expect(stripVerbatim(VERB + 'UNC' + BS + 's' + BS + 'sh' + BS + 'a')).toBe(
      BS + BS + 's' + BS + 'sh' + BS + 'a',
    )
  })
  it('普通路径原样', () => {
    expect(stripVerbatim('D:' + BS + 'a.db')).toBe('D:' + BS + 'a.db')
    expect(stripVerbatim('/tmp/a.db')).toBe('/tmp/a.db')
  })
  it('GLOBALROOT 原样', () => {
    const g = VERB + 'GLOBALROOT' + BS + 'x'
    expect(stripVerbatim(g)).toBe(g)
  })
})

describe('displayPath', () => {
  it('脱壳 + 去首尾空格', () => {
    expect(displayPath('  ' + VERB + 'D:' + BS + 'x  ')).toBe('D:' + BS + 'x')
  })
})
