import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDimensionPanelStore } from '@/stores/dimensionPanel'

describe('dimensionPanel Store — need06', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('load 空 localStorage 时 expandedKeys 为空', () => {
    const s = useDimensionPanelStore()
    expect(s.expandedKeys.size).toBe(0)
  })

  it('非法 JSON 时回落空集', () => {
    localStorage.setItem('pmf:expandedKeys', 'not-json')
    setActivePinia(createPinia())
    const s = useDimensionPanelStore()
    expect(s.expandedKeys.size).toBe(0)
  })

  it('非字符串与空串被过滤', () => {
    localStorage.setItem('pmf:expandedKeys', JSON.stringify(['top', 123, '', null, 'bottom']))
    setActivePinia(createPinia())
    const s = useDimensionPanelStore()
    expect([...s.expandedKeys].sort()).toEqual(['bottom', 'top'])
  })

  it('toggleExpand 切换', () => {
    const s = useDimensionPanelStore()
    s.toggleExpand('top')
    expect(s.isExpanded('top')).toBe(true)
    s.toggleExpand('top')
    expect(s.isExpanded('top')).toBe(false)
  })

  it('setExpanded 设置', () => {
    const s = useDimensionPanelStore()
    s.setExpanded('top', true)
    expect(s.isExpanded('top')).toBe(true)
    s.setExpanded('top', false)
    expect(s.isExpanded('top')).toBe(false)
  })

  it('prune 仅剔除不存在 key，保留其余', () => {
    const s = useDimensionPanelStore()
    s.setExpanded('top', true)
    s.setExpanded('bottom', true)
    s.setExpanded('orphan', true)
    s.prune(new Set(['top', 'bottom']))
    expect(s.isExpanded('top')).toBe(true)
    expect(s.isExpanded('bottom')).toBe(true)
    expect(s.isExpanded('orphan')).toBe(false)
  })

  it('prune 全部删除时 expandedKeys 为空', () => {
    const s = useDimensionPanelStore()
    s.setExpanded('top', true)
    s.prune(new Set())
    expect(s.expandedKeys.size).toBe(0)
  })

  it('持久化：写后 localStorage 可回读', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const s = useDimensionPanelStore()
    s.setExpanded('top', true)
    await new Promise((r) => setTimeout(r, 20))
    const raw = localStorage.getItem('pmf:expandedKeys')
    expect(raw).not.toBeNull()
    const arr = JSON.parse(raw!)
    expect(arr).toContain('top')
    setActivePinia(createPinia())
    const s2 = useDimensionPanelStore()
    expect(s2.isExpanded('top')).toBe(true)
  })

  it('localStorage 不可用时静默退化', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    setActivePinia(createPinia())
    const s = useDimensionPanelStore()
    expect(s.expandedKeys.size).toBe(0)
    s.setExpanded('top', true)
    expect(s.isExpanded('top')).toBe(true)
    vi.restoreAllMocks()
  })
})
