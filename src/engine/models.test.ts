import { describe, it, expect } from 'vitest'
import { PromptIR } from './models'

describe('PromptIR.hash', () => {
  it('same segments same hash', () => {
    const a = new PromptIR([{ dimensionKey: 'top', text: 'white shirt', weight: 1.0, sourceModuleId: 'm1' }], [])
    const b = new PromptIR([{ dimensionKey: 'top', text: 'white shirt', weight: 1.0, sourceModuleId: 'm1' }], [])
    expect(a.hash()).toBe(b.hash())
  })
  it('different text different hash', () => {
    const a = new PromptIR([{ dimensionKey: 'top', text: 'white shirt', weight: 1.0, sourceModuleId: 'm1' }], [])
    const b = new PromptIR([{ dimensionKey: 'top', text: 'black shirt', weight: 1.0, sourceModuleId: 'm2' }], [])
    expect(a.hash()).not.toBe(b.hash())
  })
  it('weight rounding to 1 decimal', () => {
    const a = new PromptIR([{ dimensionKey: 'top', text: 'white shirt', weight: 1.04, sourceModuleId: 'm1' }], [])
    const b = new PromptIR([{ dimensionKey: 'top', text: 'white shirt', weight: 1.0, sourceModuleId: 'm1' }], [])
    // round(1.04,1)=1.0 so same hash as 1.0
    expect(a.hash()).toBe(b.hash())
  })
  it('known vector matches Python hashlib.md5', async () => {
    // Python: hashlib.md5("top:white shirt:1.0|bottom:pleated skirt:1.5".encode()).hexdigest()
    // Compute expected via node crypto
    const { createHash } = await import('node:crypto')
    const raw = 'top:white shirt:1.0|bottom:pleated skirt:1.5'
    const expected = createHash('md5').update(raw).digest('hex')
    const ir = new PromptIR(
      [
        { dimensionKey: 'top', text: 'white shirt', weight: 1.0, sourceModuleId: 'm1' },
        { dimensionKey: 'bottom', text: 'pleated skirt', weight: 1.5, sourceModuleId: 'm2' },
      ],
      [],
    )
    expect(ir.hash()).toBe(expected)
  })
  it('empty segments hash of empty string', async () => {
    const { createHash } = await import('node:crypto')
    const expected = createHash('md5').update('').digest('hex')
    expect(new PromptIR([], []).hash()).toBe(expected)
  })
})
