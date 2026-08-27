import { describe, it, expect } from 'vitest'
import { buildDimensionTable, buildSegmentInstructionPrompt } from './segmentPrompt'
import type { Dimension } from '@/engine/models'

const baseDims: Dimension[] = [
  { id: 'd_gender', key: 'gender', nameCn: '性别', nameEn: 'Gender', sortOrder: 1, isMultiSelect: false, isEnabled: true },
  { id: 'd_body', key: 'body', nameCn: '身材', nameEn: 'Body', sortOrder: 2, isMultiSelect: false, isEnabled: true },
  { id: 'd_acc', key: 'accessories', nameCn: '配饰', nameEn: 'Accessories', sortOrder: 3, isMultiSelect: true, isEnabled: true },
]

describe('segmentPrompt', () => {
  it('buildDimensionTable 含全部维度 key', () => {
    const table = buildDimensionTable(baseDims)
    expect(table).toContain('gender')
    expect(table).toContain('body')
    expect(table).toContain('accessories')
    expect(table).toContain('unassigned')
  })

  it('自定义维度回退到 nameCn/nameEn', () => {
    const dims: Dimension[] = [...baseDims, { id: 'd_custom', key: 'custom_jewelry', nameCn: '饰品风格', nameEn: 'Jewelry', sortOrder: 99, isMultiSelect: true, isEnabled: true }]
    const table = buildDimensionTable(dims)
    expect(table).toContain('custom_jewelry')
    expect(table).toContain('饰品风格')
  })

  it('禁用维度标注 enabled=no 并含说明', () => {
    const dims: Dimension[] = [{ id: 'd_body', key: 'body', nameCn: '身材', nameEn: 'Body', sortOrder: 1, isMultiSelect: false, isEnabled: false }]
    const table = buildDimensionTable(dims)
    expect(table).toContain('no')
    expect(table).toContain('Disabled dimensions')
  })

  it('buildSegmentInstructionPrompt 注入 rawPrompts', () => {
    const prompt = buildSegmentInstructionPrompt({ dimensions: baseDims, rawPrompts: ['slim waist, long legs', 'red dress'] })
    expect(prompt).toContain('pmf-segments')
    expect(prompt).toContain('## 5. Input')
    expect(prompt).toContain('1. slim waist, long legs')
    expect(prompt).toContain('2. red dress')
    expect(prompt).toContain('Example 1')
  })

  it('rawPrompts 为空时抛错', () => {
    expect(() => buildSegmentInstructionPrompt({ dimensions: baseDims, rawPrompts: [] })).toThrow()
  })

  it('超 50 条追加 large note', () => {
    const raws = Array.from({ length: 51 }, (_, i) => `prompt ${i}`)
    const prompt = buildSegmentInstructionPrompt({ dimensions: baseDims, rawPrompts: raws })
    expect(prompt).toContain('Input is large')
  })
})
