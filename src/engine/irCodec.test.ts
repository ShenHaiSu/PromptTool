import { describe, it, expect } from 'vitest'
import { IR_SNAPSHOT_VERSION, PromptIR } from './models'
import { parsePromptIr, isLegacySnapshot } from './irCodec'

describe('parsePromptIr', () => {
  it('parses v2 snapshot with findings', () => {
    const json = JSON.stringify({
      segments: [{ dimensionKey: 'outfit', text: 'red slip dress', weight: 1.0, sourceModuleId: 'mod_outfit_03' }],
      warnings: ['已选全身套装，上装/下装将自动忽略'],
      findings: [
        {
          ruleId: 'rule_01', ruleName: '套装互斥', type: 'mutex',
          severity: 'warning', message: '已选全身套装，上装/下装将自动忽略',
          involvedIndexes: [0, 1], involvedModuleIds: ['mod_outfit_03', 'mod_top_01'],
          fix: { removeIndexes: [1], keepIndexes: [0], reason: '将移除上装，保留全身套装' },
        },
      ],
      version: 2,
    })
    const ir = parsePromptIr(json)
    expect(ir.segments).toHaveLength(1)
    expect(ir.findings).toHaveLength(1)
    expect(ir.findings[0]!.fix?.removeIndexes).toEqual([1])
    expect(ir.version).toBe(IR_SNAPSHOT_VERSION)
  })

  it('legacy snapshot without findings gets defaults (forward compat)', () => {
    const json = JSON.stringify({
      segments: [{ dimensionKey: 'top', text: 'white shirt', weight: 1.0, sourceModuleId: 'm1' }],
      warnings: [],
    })
    const ir = parsePromptIr(json)
    expect(ir.segments).toHaveLength(1)
    expect(ir.findings).toEqual([])
    expect(ir.version).toBe(1)
    expect(isLegacySnapshot(json)).toBe(true)
  })

  it('invalid JSON returns empty IR with warning', () => {
    const ir = parsePromptIr('{not json')
    expect(ir.segments).toEqual([])
    expect(ir.warnings.some((w) => w.includes('快照解析失败'))).toBe(true)
  })

  it('drops malformed segments and records warning', () => {
    const json = JSON.stringify({
      segments: [
        { dimensionKey: 'top', text: 'white shirt', weight: 1.0, sourceModuleId: 'm1' },
        { dimensionKey: 'top', weight: 1.0 },
        'garbage',
      ],
      warnings: [],
    })
    const ir = parsePromptIr(json)
    expect(ir.segments).toHaveLength(1)
    expect(ir.warnings.some((w) => w.includes('缺失字段'))).toBe(true)
  })

  it('ignored flag is never persisted (parsed as false)', () => {
    const json = JSON.stringify({
      segments: [],
      warnings: [],
      findings: [
        {
          ruleId: 'r1', ruleName: 'n', type: 'limit', severity: 'warning', message: 'm',
          involvedIndexes: [], involvedModuleIds: [], fix: null, ignored: true,
        },
      ],
      version: 2,
    })
    const ir = parsePromptIr(json)
    expect(ir.findings[0]!.ignored).toBe(false)
  })

  it('hash ignores findings (rollback-safe)', () => {
    const a = new PromptIR(
      [{ dimensionKey: 'top', text: 'white shirt', weight: 1.0, sourceModuleId: 'm1' }],
      [],
      [],
    )
    const b = new PromptIR(
      [{ dimensionKey: 'top', text: 'white shirt', weight: 1.0, sourceModuleId: 'm1' }],
      ['w'],
      [{ ruleId: 'r', ruleName: 'n', type: 'mutex', severity: 'warning', message: 'm', involvedIndexes: [], involvedModuleIds: [], fix: null }],
    )
    expect(a.hash()).toBe(b.hash())
  })
})
