import { describe, it, expect } from 'vitest'
import { adaptToModel } from './adapters'
import { PromptIR } from './models'
import type { AssemblyConfig } from './models'

function ir(text: string, weight = 1.0, dimKey = 'top'): PromptIR {
  return new PromptIR([{ dimensionKey: dimKey, text, weight, sourceModuleId: 'm1' }], [])
}

describe('SD adapter', () => {
  it('weight 1.0 no bracket', () => {
    const cfg: AssemblyConfig = { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }
    expect(adaptToModel(ir('white shirt', 1.0), 'sd', cfg)).toBe('white shirt')
  })
  it('weight >1 parenthesis', () => {
    const cfg: AssemblyConfig = { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }
    expect(adaptToModel(ir('white shirt', 1.2), 'sd', cfg)).toBe('(white shirt:1.2)')
  })
  it('weight <1 brackets', () => {
    const cfg: AssemblyConfig = { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }
    expect(adaptToModel(ir('white shirt', 0.8), 'sd', cfg)).toBe('[white shirt]')
  })
  it('brackets disabled', () => {
    const cfg: AssemblyConfig = { separator: ', ', useWeightBrackets: false, modelProfile: 'sd', sortBy: 'dimensionOrder' }
    expect(adaptToModel(ir('white shirt', 1.5), 'sd', cfg)).toBe('white shirt')
  })
  it('multiple segments joined', () => {
    const p = new PromptIR(
      [
        { dimensionKey: 'top', text: 'white shirt', weight: 1.0, sourceModuleId: 'm1' },
        { dimensionKey: 'bottom', text: 'pleated skirt', weight: 1.5, sourceModuleId: 'm2' },
      ],
      [],
    )
    const cfg: AssemblyConfig = { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }
    expect(adaptToModel(p, 'sd', cfg)).toBe('white shirt, (pleated skirt:1.5)')
  })
})

describe('MJ adapter', () => {
  it('weight 1.0 no suffix', () => {
    const cfg: AssemblyConfig = { separator: ', ', useWeightBrackets: true, modelProfile: 'mj', sortBy: 'dimensionOrder' }
    expect(adaptToModel(ir('white shirt', 1.0), 'mj', cfg)).toBe('white shirt')
  })
  it('weight !=1 adds ::weight', () => {
    const cfg: AssemblyConfig = { separator: ', ', useWeightBrackets: true, modelProfile: 'mj', sortBy: 'dimensionOrder' }
    expect(adaptToModel(ir('white shirt', 1.2), 'mj', cfg)).toBe('white shirt::1.2')
  })
})

describe('Flux adapter', () => {
  it('flux ignores weight', () => {
    const cfg: AssemblyConfig = { separator: ', ', useWeightBrackets: true, modelProfile: 'flux', sortBy: 'dimensionOrder' }
    expect(adaptToModel(ir('white shirt', 1.5), 'flux', cfg)).toBe('white shirt')
  })
})
