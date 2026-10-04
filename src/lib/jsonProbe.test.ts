import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isParsableJson, tryParseJson } from './jsonProbe'

describe('jsonProbe（S5 空 catch 收敛）', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}))
  afterEach(() => vi.restoreAllMocks())

  it('合法 JSON 探测为 true', () => {
    expect(isParsableJson('{"a":1}')).toBe(true)
    expect(isParsableJson('[1,2]')).toBe(true)
  })

  it('非法 JSON 探测为 false 且留痕（不静默吞）', () => {
    expect(isParsableJson('{oops')).toBe(false)
    expect(console.warn).toHaveBeenCalled()
  })

  it('tryParseJson 返回值或 undefined', () => {
    expect(tryParseJson<{ a: number }>('{"a":2}')).toEqual({ a: 2 })
    expect(tryParseJson('nope')).toBeUndefined()
  })
})