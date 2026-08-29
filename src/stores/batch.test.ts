import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBatchStore } from './batch'
import type { Dimension, Module } from '@/engine/models'

function mod(id: string, key: string, text: string): Module {
  return { id, dimensionId: 'd_' + key, contentEn: text, displayName: text, weight: 1.0, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: key } as Module
}
function dim(key: string, i: number): Dimension {
  return { id: 'd' + i, key, nameCn: key, nameEn: key, sortOrder: i, isMultiSelect: false, isEnabled: true }
}

beforeEach(() => setActivePinia(createPinia()))

describe('batch store', () => {
  it('generate fills results', () => {
    const s = useBatchStore()
    const dimensions = [dim('top', 0), dim('bottom', 1)]
    const grouped: Record<string, Module[]> = {
      top: [mod('m1', 'top', 'white shirt')],
      bottom: [mod('m2', 'bottom', 'pleated skirt')],
    }
    s.generate(dimensions, grouped, new Set(), 5, { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' })
    expect(s.results.length).toBeGreaterThan(0)
    expect(s.results.length).toBeLessThanOrEqual(5)
  })
  it('clear empties results', () => {
    const s = useBatchStore()
    s.results.push({ index: 1, ir: { segments: [], warnings: [], hash: () => 'h' } as unknown as import('@/engine/models').PromptIR, finalPrompt: 'a', warnings: [], dimKeys: [], hash: 'h' })
    s.clear()
    expect(s.results).toHaveLength(0)
  })
})

describe('batch store history persistence (need03)', () => {
  it('generate persists history to localStorage', () => {
    localStorage.clear()
    const s = useBatchStore()
    const dimensions = [dim('top', 0), dim('bottom', 1)]
    const grouped: Record<string, Module[]> = {
      top: [mod('m1', 'top', 'white shirt'), mod('m1b', 'top', 'black shirt')],
      bottom: [mod('m2', 'bottom', 'pleated skirt')],
    }
    s.generate(dimensions, grouped, new Set(), 1, { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' })
    expect(s.results.length).toBeGreaterThan(0)
    const raw = localStorage.getItem('pmf:randomHistory:v1')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.version).toBe(1)
    expect(parsed.hits).toBeDefined()
  })

  it('clearHistory clears storage', () => {
    localStorage.clear()
    const s = useBatchStore()
    const dimensions = [dim('top', 0)]
    const grouped: Record<string, Module[]> = { top: [mod('m1', 'top', 'white shirt')] }
    s.generate(dimensions, grouped, new Set(), 1, { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' })
    expect(localStorage.getItem('pmf:randomHistory:v1')).not.toBeNull()
    s.clearHistory()
    expect(localStorage.getItem('pmf:randomHistory:v1')).toBeNull()
  })
})

