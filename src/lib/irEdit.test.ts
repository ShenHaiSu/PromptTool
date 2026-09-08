/**
 * need02 T4：irEdit 纯函数单测
 */
import { describe, it, expect } from 'vitest'
import {
  cloneSegments, updateSegmentText, updateSegmentWeight, removeSegment,
  moveSegment, appendEmptySegment, applyFindingFix, buildPreview, toSelectedItems, shortHash, clampWeight,
} from './irEdit'
import { PromptIR, type AssemblyConfig, type IRSegment } from '@/engine/models'

const segs = (): IRSegment[] => [
  { dimensionKey: 'outfit', text: 'red dress', weight: 1.0, sourceModuleId: 'm_out' },
  { dimensionKey: 'top', text: 'white shirt', weight: 1.5, sourceModuleId: 'm_top' },
  { dimensionKey: 'bottom', text: 'skirt', weight: 0.7, sourceModuleId: 'm_bot' },
]

const cfg = (): AssemblyConfig => ({ separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' })

describe('irEdit pure functions', () => {
  it('cloneSegments deep copies', () => {
    const a = segs()
    const b = cloneSegments(a)
    b[0]!.text = 'changed'
    expect(a[0]!.text).toBe('red dress')
  })

  it('updateSegmentText out-of-range returns copy', () => {
    const b = updateSegmentText(segs(), 99, 'x')
    expect(b).toHaveLength(3)
  })

  it('weight clamp 0.5-2.0 + round 0.1', () => {
    expect(clampWeight(9)).toBe(2.0)
    expect(clampWeight(0.1)).toBe(0.5)
    expect(clampWeight(1.04)).toBe(1.0)
    expect(clampWeight(NaN)).toBe(1.0)
    const b = updateSegmentWeight(segs(), 0, 1.55)
    expect(b[0]!.weight).toBe(1.6)
  })

  it('removeSegment / moveSegment immutable', () => {
    const a = segs()
    const b = removeSegment(a, 1)
    expect(b.map((s) => s.dimensionKey)).toEqual(['outfit', 'bottom'])
    expect(a).toHaveLength(3)
    const c = moveSegment(a, 0, 2)
    expect(c.map((s) => s.dimensionKey)).toEqual(['top', 'bottom', 'outfit'])
  })

  it('appendEmptySegment focuses contract (empty text+weight 1)', () => {
    const b = appendEmptySegment(segs())
    expect(b).toHaveLength(4)
    expect(b[3]).toEqual({ dimensionKey: '', text: '', weight: 1, sourceModuleId: '' })
  })

  it('applyFindingFix descending-safe (removes snapshot indexes)', () => {
    const b = applyFindingFix(segs(), { removeIndexes: [2, 0], keepIndexes: [1], reason: 'r' })
    expect(b.map((s) => s.dimensionKey)).toEqual(['top'])
  })

  it('buildPreview skips empty text and adapts weights', () => {
    const withEmpty: IRSegment[] = [...segs(), { dimensionKey: 'pose', text: '   ', weight: 1, sourceModuleId: '' }]
    const p = buildPreview(withEmpty, 'sd', cfg())
    expect(p).toBe('red dress, (white shirt:1.5), [skirt]')
    expect(p).not.toContain('pose')
  })

  it('toSelectedItems snapshot semantics (dimId map + lock map)', () => {
    const items = toSelectedItems(segs(), {
      lockedIndexes: new Set([1]),
      dimKeyToId: { outfit: 'dim_05', top: 'dim_03' },
    })
    expect(items).toHaveLength(3)
    expect(items[0]!.module.id).toBe('m_out')
    expect(items[0]!.module.dimensionId).toBe('dim_05')
    expect(items[2]!.module.dimensionId).toBe('') // bottom 未在映射 → 快照语义 ''
    expect(items[1]!.locked).toBe(true)
    expect(items[1]!.weightOverride).toBe(1.5)
    expect(items[0]!.weightOverride).toBeNull()
  })

  it('shortHash 8 chars stable', () => {
    const ir = new PromptIR(segs(), [])
    expect(shortHash(ir)).toBe(ir.hash().slice(0, 8))
    expect(shortHash(ir)).toHaveLength(8)
  })
})
