import { describe, it, expect } from 'vitest'
import { assemble, sortByOrder } from './assembly'
import type { Module, SelectedItem } from './models'
import type { AssemblyConfig } from './models'

function mod(overrides: Partial<Module> & { id: string; dimensionKey?: string }): Module {
  return {
    dimensionId: overrides.dimensionId ?? 'd_' + (overrides.dimensionKey ?? 'top'),
    contentEn: overrides.contentEn ?? overrides.id,
    displayName: overrides.displayName ?? overrides.contentEn ?? overrides.id,
    weight: overrides.weight ?? 1.0,
    isEnabled: overrides.isEnabled ?? true,
    isNsfw: overrides.isNsfw ?? false,
    usageCount: 0,
    dimensionKey: overrides.dimensionKey ?? null,
    ...overrides,
  } as Module
}

function sampleModules() {
  return {
    top: mod({ id: 'm_top_01', dimensionId: 'd03', dimensionKey: 'top', contentEn: 'oversized white shirt', displayName: '宽松白衬衫' }),
    bottom: mod({ id: 'm_bot_01', dimensionId: 'd04', dimensionKey: 'bottom', contentEn: 'high-waisted pleated skirt', displayName: '高腰百褶裙' }),
    outfit: mod({ id: 'm_out_01', dimensionId: 'd05', dimensionKey: 'outfit', contentEn: 'red bodycon dress', displayName: '红色紧身连衣裙' }),
    shoesBare: mod({ id: 'm_sh_03', dimensionId: 'd06', dimensionKey: 'shoes', contentEn: 'barefoot', displayName: '赤脚', weight: 0.8 }),
    shoesSneaker: mod({ id: 'm_sh_01', dimensionId: 'd06', dimensionKey: 'shoes', contentEn: 'white sneakers', displayName: '白色运动鞋' }),
    bgStudio: mod({ id: 'm_bg_01', dimensionId: 'd10', dimensionKey: 'background', contentEn: 'minimalist studio, white backdrop', displayName: '极简棚拍白底' }),
    bgBeach: mod({ id: 'm_bg_02', dimensionId: 'd10', dimensionKey: 'background', contentEn: 'cherry blossom street, soft sunlight', displayName: '樱花街道柔光', weight: 1.2 }),
  }
}

function defaultConfig(): AssemblyConfig {
  return { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }
}

describe('assemble', () => {
  it('basic assembly contains segments and final', () => {
    const m = sampleModules()
    const selected: SelectedItem[] = [{ module: m.top, locked: false }, { module: m.bottom, locked: false }]
    const { ir, finalPrompt } = assemble(selected, defaultConfig())
    expect(ir.segments).toHaveLength(2)
    expect(finalPrompt).toContain('oversized white shirt')
    expect(finalPrompt).toContain('high-waisted pleated skirt')
  })

  it('weight override >1 wraps with parentheses', () => {
    const m = sampleModules()
    const cfg: AssemblyConfig = { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }
    const { finalPrompt } = assemble([{ module: m.top, weightOverride: 1.5, locked: false }], cfg)
    expect(finalPrompt).toBe('(oversized white shirt:1.5)')
  })

  it('weight <1 uses brackets', () => {
    const m = sampleModules()
    const cfg: AssemblyConfig = { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }
    const { finalPrompt } = assemble([{ module: m.top, weightOverride: 0.7, locked: false }], cfg)
    expect(finalPrompt).toBe('[oversized white shirt]')
  })

  it('weight 1.0 no brackets', () => {
    const m = sampleModules()
    const { finalPrompt } = assemble([{ module: m.top, locked: false }], defaultConfig())
    expect(finalPrompt).toBe('oversized white shirt')
  })

  it('separator comma', () => {
    const m = sampleModules()
    const cfg: AssemblyConfig = { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }
    const { finalPrompt } = assemble([{ module: m.top, locked: false }, { module: m.bottom, locked: false }], cfg)
    expect(finalPrompt).toContain(', ')
  })

  it('separator BREAK', () => {
    const m = sampleModules()
    const cfg: AssemblyConfig = { separator: ' BREAK ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }
    const { finalPrompt } = assemble([{ module: m.top, locked: false }, { module: m.bottom, locked: false }], cfg)
    expect(finalPrompt).toContain(' BREAK ')
  })

  it('hash consistency', () => {
    const m = sampleModules()
    const { ir: ir1 } = assemble([{ module: m.top, locked: false }], defaultConfig())
    const { ir: ir2 } = assemble([{ module: m.top, locked: false }], defaultConfig())
    expect(ir1.hash()).toBe(ir2.hash())
  })
})

describe('sortByOrder', () => {
  it('dimensionOrder sorts by dimOrder map', () => {
    const m = sampleModules()
    const items: SelectedItem[] = [{ module: m.bottom, locked: false }, { module: m.top, locked: false }]
    const ordered = sortByOrder(items, 'dimensionOrder')
    expect(ordered[0]!.module.dimensionKey).toBe('top')
    expect(ordered[1]!.module.dimensionKey).toBe('bottom')
  })

  it('customDragOrder preserves input order', () => {
    const m = sampleModules()
    const items: SelectedItem[] = [{ module: m.bottom, locked: false }, { module: m.top, locked: false }]
    const ordered = sortByOrder(items, 'customDragOrder')
    expect(ordered[0]!.module.dimensionKey).toBe('bottom')
    expect(ordered[1]!.module.dimensionKey).toBe('top')
  })

  it('full 14-dim order', () => {
    const dims = ['outfit', 'top', 'bottom', 'shoes', 'background', 'camera', 'gender']
    const items: SelectedItem[] = dims.map((k, i) => ({ module: mod({ id: `m_${i}`, dimensionKey: k, contentEn: k }), locked: false }))
    const ordered = sortByOrder(items, 'dimensionOrder')
    expect(ordered.map((it) => it.module.dimensionKey)).toEqual(['gender', 'top', 'bottom', 'outfit', 'shoes', 'background', 'camera'])
  })
})
