import { describe, it, expect } from 'vitest'
import { applyRules } from './rules'
import type { Module, SelectedItem } from './models'

function mod(kw: Partial<Module> & { id: string; dimensionKey?: string; contentEn: string }): Module {
  return {
    dimensionId: 'd_' + (kw.dimensionKey ?? 'x'),
    displayName: kw.displayName ?? kw.contentEn,
    weight: kw.weight ?? 1.0,
    isEnabled: true,
    isNsfw: false,
    usageCount: 0,
    dimensionKey: kw.dimensionKey ?? null,
    ...kw,
  } as Module
}

describe('R01 outfit mutex', () => {
  it('outfit removes top and bottom when not locked', () => {
    const outfit = mod({ id: 'm_out', dimensionKey: 'outfit', contentEn: 'red bodycon dress' })
    const top = mod({ id: 'm_top', dimensionKey: 'top', contentEn: 'white shirt' })
    const bottom = mod({ id: 'm_bot', dimensionKey: 'bottom', contentEn: 'pleated skirt' })
    const selected: SelectedItem[] = [{ module: outfit, locked: false }, { module: top, locked: false }, { module: bottom, locked: false }]
    const [filtered, warnings] = applyRules(selected)
    const keys = new Set(filtered.map((it) => it.module.dimensionKey))
    expect(keys.has('outfit')).toBe(true)
    expect(keys.has('top')).toBe(false)
    expect(keys.has('bottom')).toBe(false)
    expect(warnings.some((w) => w.includes('全身套装'))).toBe(true)
  })

  it('outfit keeps locked top', () => {
    const outfit = mod({ id: 'm_out', dimensionKey: 'outfit', contentEn: 'red bodycon dress' })
    const top = mod({ id: 'm_top', dimensionKey: 'top', contentEn: 'white shirt' })
    const selected: SelectedItem[] = [{ module: outfit, locked: false }, { module: top, locked: true }]
    const [filtered] = applyRules(selected)
    expect(filtered.some((it) => it.module.dimensionKey === 'top')).toBe(true)
  })
})

describe('R02 barefoot mutex', () => {
  it('barefoot and shoes cannot coexist', () => {
    const bare = mod({ id: 'm_bare', dimensionKey: 'shoes', contentEn: 'barefoot' })
    const sneaker = mod({ id: 'm_snk', dimensionKey: 'shoes', contentEn: 'white sneakers' })
    const selected: SelectedItem[] = [{ module: bare, locked: false }, { module: sneaker, locked: false }]
    const [filtered, warnings] = applyRules(selected)
    const contents = new Set(filtered.map((it) => it.module.contentEn))
    expect(contents.has('barefoot') && contents.has('white sneakers')).toBe(false)
    expect(warnings.some((w) => w.includes('赤脚'))).toBe(true)
  })

  it('barefoot locked keeps barefoot, removes sneakers', () => {
    const bare = mod({ id: 'm_bare', dimensionKey: 'shoes', contentEn: 'barefoot' })
    const sneaker = mod({ id: 'm_snk', dimensionKey: 'shoes', contentEn: 'white sneakers' })
    const selected: SelectedItem[] = [{ module: bare, locked: true }, { module: sneaker, locked: false }]
    const [filtered] = applyRules(selected)
    const contents = new Set(filtered.map((it) => it.module.contentEn))
    expect(contents.has('barefoot')).toBe(true)
    expect(contents.has('white sneakers')).toBe(false)
  })
})

describe('R03 studio vs outdoor', () => {
  it('studio and beach conflict keeps studio', () => {
    const studio = mod({ id: 'm_st', dimensionKey: 'background', contentEn: 'minimalist studio, white backdrop' })
    const beach = mod({ id: 'm_be', dimensionKey: 'background', contentEn: 'cherry blossom street, soft sunlight' })
    const selected: SelectedItem[] = [{ module: studio, locked: false }, { module: beach, locked: false }]
    const [filtered, warnings] = applyRules(selected)
    const contents = new Set(filtered.map((it) => it.module.contentEn))
    expect(contents.has('minimalist studio, white backdrop')).toBe(true)
    expect(contents.has('cherry blossom street, soft sunlight')).toBe(false)
    expect(warnings.some((w) => w.includes('室内背景'))).toBe(true)
  })
})
