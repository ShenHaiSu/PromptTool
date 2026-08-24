import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAssemblyStore } from './assembly'
import type { Module } from '@/engine/models'

function mod(id: string, key: string, text: string): Module {
  return { id, dimensionId: 'd_' + key, contentEn: text, displayName: text, weight: 1.0, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: key } as Module
}

beforeEach(() => setActivePinia(createPinia()))

describe('assembly store', () => {
  it('addModule + reassemble builds finalPrompt', () => {
    const s = useAssemblyStore()
    s.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    expect(s.finalPrompt).toContain('white shirt')
    expect(s.selectedItems).toHaveLength(1)
  })
  it('deduplicates same module.id', () => {
    const s = useAssemblyStore()
    s.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    s.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    expect(s.selectedItems).toHaveLength(1)
  })
  it('removeModule updates prompt', () => {
    const s = useAssemblyStore()
    s.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    s.removeModule('m1')
    expect(s.selectedItems).toHaveLength(0)
    expect(s.finalPrompt).toBe('')
  })
  it('updateWeight applies brackets', () => {
    const s = useAssemblyStore()
    s.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    s.updateWeight('m1', 1.5)
    expect(s.finalPrompt).toBe('(white shirt:1.5)')
  })
  it('toggleLocked flips', () => {
    const s = useAssemblyStore()
    s.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    s.toggleLocked('m1')
    expect(s.selectedItems[0]!.locked).toBe(true)
  })
  it('reorder changes order in customDragOrder', () => {
    const s = useAssemblyStore()
    s.setConfig({ sortBy: 'customDragOrder' })
    s.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    s.addModule({ module: mod('m2', 'bottom', 'pleated skirt'), locked: false })
    s.reorder(0, 1)
    expect(s.selectedItems[0]!.module.id).toBe('m2')
  })
  it('setConfig separator updates final', () => {
    const s = useAssemblyStore()
    s.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    s.addModule({ module: mod('m2', 'bottom', 'pleated skirt'), locked: false })
    s.setConfig({ separator: ' BREAK ' })
    expect(s.finalPrompt).toContain(' BREAK ')
  })
  it('outfit mutex emits warning', () => {
    const s = useAssemblyStore()
    s.addModule({ module: mod('m_out', 'outfit', 'red dress'), locked: false })
    s.addModule({ module: mod('m_top', 'top', 'white shirt'), locked: false })
    expect(s.warnings.some((w) => w.includes('全身套装'))).toBe(true)
  })
  it('clear resets', () => {
    const s = useAssemblyStore()
    s.addModule({ module: mod('m1', 'top', 'white shirt'), locked: false })
    s.clear()
    expect(s.selectedItems).toHaveLength(0)
    expect(s.finalPrompt).toBe('')
  })
})
