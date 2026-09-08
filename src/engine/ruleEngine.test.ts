/**
 * need02 T3：规则引擎 v2 求值单测 — 五类语义 × 锁定矩阵 + 关键词 fallback + limit/isolated
 */
import { describe, it, expect } from 'vitest'
import { evaluateRules, buildAutoFixPreview, summarizeFindings, LEGACY_DEFAULT_RULES } from './ruleEngine'
import type { IRSegment } from './models'
import type { EngineRule } from './ruleTypes'

function seg(dimensionKey: string, text: string, id = `m_${text.slice(0, 4)}`): IRSegment {
  return { dimensionKey, text, weight: 1.0, sourceModuleId: id }
}

function mutexRule(over: Partial<EngineRule> = {}): EngineRule {
  return {
    id: 'r_mutex', name: '互斥', type: 'mutex',
    sourceDimensionId: null, sourceModuleId: null,
    targetDimensionId: null, targetModuleId: null,
    message: '已选{source}，{target}将自动忽略',
    isEnabled: true, sourceDimKey: 'outfit', targetDimKey: 'top',
    ...over,
  }
}

describe('mutex', () => {
  const segs = () => [seg('outfit', 'red dress', 'm_out'), seg('top', 'white shirt', 'm_top'), seg('bottom', 'skirt', 'm_bot')]
  it('no lock: keeps source, removes target', () => {
    const fs = evaluateRules({ segments: segs(), rules: [mutexRule()] })
    expect(fs).toHaveLength(1)
    expect(fs[0]!.fix?.removeIndexes).toEqual([1])
    expect(fs[0]!.fix?.keepIndexes).toEqual([0])
  })
  it('target locked: reverses to remove source', () => {
    const fs = evaluateRules({ segments: segs(), rules: [mutexRule()], lockedIndexes: new Set([1]) })
    expect(fs).toHaveLength(1)
    expect(fs[0]!.fix?.removeIndexes).toEqual([0])
    expect(fs[0]!.message).toContain('已锁定')
  })
  it('both locked: fix null with unlock hint', () => {
    const fs = evaluateRules({ segments: segs(), rules: [mutexRule()], lockedIndexes: new Set([0, 1]) })
    expect(fs).toHaveLength(1)
    expect(fs[0]!.fix).toBeNull()
    expect(fs[0]!.message).toContain('解锁')
  })
  it('single side present: no finding', () => {
    const fs = evaluateRules({ segments: [seg('outfit', 'red dress')], rules: [mutexRule()] })
    expect(fs).toHaveLength(0)
  })
  it('disabled rule skipped', () => {
    const fs = evaluateRules({ segments: segs(), rules: [mutexRule({ isEnabled: false })] })
    expect(fs).toHaveLength(0)
  })
  it('removeIndexes descending (splice-safe)', () => {
    const r = mutexRule({ id: 'rx', targetDimKey: 'bottom' })
    const two = [seg('outfit', 'dress', 'm1'), seg('bottom', 'a', 'm2'), seg('bottom', 'b', 'm3')]
    const fs = evaluateRules({ segments: two, rules: [r] })
    expect(fs[0]!.fix?.removeIndexes).toEqual([2, 1])
  })
})

describe('requires', () => {
  const rule: EngineRule = {
    id: 'r_req', name: '依赖', type: 'requires',
    sourceDimensionId: null, sourceModuleId: null, targetDimensionId: null, targetModuleId: null,
    message: '已选{source}，建议补选{target}', isEnabled: true,
    sourceDimKey: 'pose', targetDimKey: 'background',
  }
  it('missing target triggers, no fix', () => {
    const fs = evaluateRules({ segments: [seg('pose', 'standing')], rules: [rule] })
    expect(fs).toHaveLength(1)
    expect(fs[0]!.fix).toBeNull()
    expect(fs[0]!.message).toContain('补选')
  })
  it('target present: silent', () => {
    const fs = evaluateRules({ segments: [seg('pose', 'standing'), seg('background', 'studio')], rules: [rule] })
    expect(fs).toHaveLength(0)
  })
})

describe('excludes (keyword group)', () => {
  it('studio vs beach triggers, keeps studio', () => {
    const rule = LEGACY_DEFAULT_RULES.find((r) => r.id === 'rule_03')!
    const fs = evaluateRules({
      segments: [seg('background', 'minimalist studio, white backdrop', 'm_st'), seg('background', 'sunny beach', 'm_be')],
      rules: [rule],
    })
    expect(fs).toHaveLength(1)
    expect(fs[0]!.type).toBe('excludes')
    expect(fs[0]!.fix?.removeIndexes).toEqual([1])
  })
  it('street/sunset/rooftop all hit the group', () => {
    const rule = LEGACY_DEFAULT_RULES.find((r) => r.id === 'rule_03')!
    for (const kw of ['beach', 'sunset', 'street', 'rooftop']) {
      const fs = evaluateRules({
        segments: [seg('background', 'studio backdrop', 'm_st'), seg('background', `night ${kw}`, 'm_x')],
        rules: [rule],
      })
      expect(fs).toHaveLength(1)
    }
  })
})

describe('legacy R01/R02 compat', () => {
  it('rule_01a+01b cover top and bottom separately', () => {
    const segs = [seg('outfit', 'red dress', 'm_out'), seg('top', 'shirt', 'm_top'), seg('bottom', 'skirt', 'm_bot')]
    const fs = evaluateRules({ segments: segs, rules: LEGACY_DEFAULT_RULES })
    const ids = fs.map((f) => f.ruleId)
    expect(ids).toContain('rule_01a')
    expect(ids).toContain('rule_01b')
  })
  it('rule_02 barefoot keeps locked side', () => {
    const rule = LEGACY_DEFAULT_RULES.find((r) => r.id === 'rule_02')!
    const segs = [seg('shoes', 'barefoot soles', 'm_bare'), seg('shoes', 'white sneakers', 'm_snk')]
    const free = evaluateRules({ segments: segs, rules: [rule] })
    expect(free).toHaveLength(1)
    expect(free[0]!.fix?.removeIndexes).toEqual([1])
    const lockedBare = evaluateRules({ segments: segs, rules: [rule], lockedIndexes: new Set([0]) })
    expect(lockedBare[0]!.fix?.removeIndexes).toEqual([1])
    const lockedShoes = evaluateRules({ segments: segs, rules: [rule], lockedIndexes: new Set([1]) })
    expect(lockedShoes[0]!.fix?.removeIndexes).toEqual([0])
  })
  it('legacy rule_01 id expands to 01a/01b', () => {
    const legacy: EngineRule = { ...LEGACY_DEFAULT_RULES[0]!, id: 'rule_01', name: '套装互斥' }
    const segs = [seg('outfit', 'dress', 'm1'), seg('top', 'shirt', 'm2'), seg('bottom', 'skirt', 'm3')]
    const fs = evaluateRules({ segments: segs, rules: [legacy] })
    expect(fs.map((f) => f.ruleId).sort()).toEqual(['rule_01a', 'rule_01b'])
  })
})

describe('limit', () => {
  const rule: EngineRule = {
    id: 'r_lim', name: '上限', type: 'limit',
    sourceDimensionId: null, sourceModuleId: null, targetDimensionId: null, targetModuleId: null,
    message: '', isEnabled: true, targetDimKey: 'accessories', limitCount: 2,
  }
  it('over limit triggers without fix', () => {
    const segs = [seg('accessories', 'hat', 'm1'), seg('accessories', 'watch', 'm2'), seg('accessories', 'ring', 'm3')]
    const fs = evaluateRules({ segments: segs, rules: [rule] })
    expect(fs).toHaveLength(1)
    expect(fs[0]!.fix).toBeNull()
    expect(fs[0]!.involvedIndexes).toEqual([0, 1, 2])
  })
  it('within limit silent', () => {
    const fs = evaluateRules({ segments: [seg('accessories', 'hat', 'm1')], rules: [rule] })
    expect(fs).toHaveLength(0)
  })
})

describe('isolated', () => {
  const rule: EngineRule = {
    id: 'r_iso', name: '独占', type: 'isolated',
    sourceDimensionId: null, sourceModuleId: null, targetDimensionId: null, targetModuleId: null,
    message: '已选{source}，将独占画面', isEnabled: true, sourceDimKey: 'outfit',
  }
  it('clears others as error with fix', () => {
    const fs = evaluateRules({ segments: [seg('outfit', 'dress', 'm1'), seg('top', 'shirt', 'm2')], rules: [rule] })
    expect(fs).toHaveLength(1)
    expect(fs[0]!.severity).toBe('error')
    expect(fs[0]!.fix?.removeIndexes).toEqual([1])
  })
  it('locked outsider: fix null', () => {
    const fs = evaluateRules({ segments: [seg('outfit', 'dress', 'm1'), seg('top', 'shirt', 'm2')], rules: [rule], lockedIndexes: new Set([1]) })
    expect(fs[0]!.fix).toBeNull()
  })
  it('alone: silent', () => {
    const fs = evaluateRules({ segments: [seg('outfit', 'dress', 'm1')], rules: [rule] })
    expect(fs).toHaveLength(0)
  })
})

describe('helpers', () => {
  it('buildAutoFixPreview removes fix indexes', () => {
    const segs = [seg('outfit', 'dress', 'm1'), seg('top', 'shirt', 'm2')]
    const fs = evaluateRules({ segments: segs, rules: [mutexRule()] })
    const preview = buildAutoFixPreview(segs, fs[0]!)
    expect(preview.map((s) => s.dimensionKey)).toEqual(['outfit'])
    expect(segs).toHaveLength(2)
  })
  it('summarize counts errors/warnings/fixable (ignores ignored)', () => {
    const fs = evaluateRules({
      segments: [seg('outfit', 'dress', 'm1'), seg('top', 'shirt', 'm2')],
      rules: [mutexRule(), { ...mutexRule({ id: 'iso', type: 'isolated', name: '独', message: '独占' }) }],
    })
    const s = summarizeFindings(fs)
    expect(s.warnings).toBe(1)
    expect(s.errors).toBe(1)
    expect(s.fixable).toBe(2)
  })
})
