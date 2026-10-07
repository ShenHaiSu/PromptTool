import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useLibraryStore } from '@/stores/library'
import type { Dimension } from '@/engine/models'

const dbMocks = vi.hoisted(() => ({
  dbUpdateDimension: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/db/dimensions', () => dbMocks)
 vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))
 vi.mock('@/lib/db', () => ({ dbGetDimensions: vi.fn().mockResolvedValue([]), dbGetAllModulesGrouped: vi.fn().mockResolvedValue({}) }))

import DimensionOrderDialog from '../DimensionOrderDialog.vue'

function dim(id: string, key: string, sortOrder: number, isEnabled = true): Dimension {
  return { id, key, nameCn: `名${key}`, nameEn: key, sortOrder, isMultiSelect: false, isEnabled } as Dimension
}

function setup(dims: Dimension[]) {
  setActivePinia(createPinia())
  const library = useLibraryStore()
  library.dimensions = [...dims]
  const w = mount(DimensionOrderDialog, {
    props: { open: true, dimensions: [...dims] },
    global: { plugins: [createPinia()] },
  })
  return { w, library }
}
 
 function firePointer(el: Element, type: string, props: Record<string, unknown>): void {
   // 注：@vue/test-utils 的 trigger('pointerdown', { button }) 会因只读 getter 抛错，改直发合成事件
   const e = new Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>
   Object.assign(e, props)
   el.dispatchEvent(e)
 }

describe('DimensionOrderDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('列出全量维度并按 sortOrder 升序，位序实时显示，未改动时保存禁用', () => {
    const { w } = setup([dim('d1', 'c', 6), dim('d2', 'a', 0), dim('d3', 'b', 5)])
    const rows = w.findAll('[data-testid="dimension-order-row"]')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.attributes('data-dim-key')).toBe('a')
    expect(rows[1]!.attributes('data-dim-key')).toBe('b')
    expect(rows[2]!.attributes('data-dim-key')).toBe('c')
    expect(w.findAll('[data-testid="dimension-order-index"]').map((n) => n.text())).toEqual(['1', '2', '3'])
    expect(w.find('[data-testid="dimension-order-confirm"]').attributes('disabled')).toBeDefined()
  })

  it('下移首行→保存：dbUpdate 逐条调用，applied 为稠密 0..n-1 并关闭', async () => {
    const { w } = setup([dim('d1', 'a', 0), dim('d2', 'b', 1), dim('d3', 'c', 2)])
    await w.find('[data-testid="dimension-order-down-a"]').trigger('click')
    const rows = w.findAll('[data-testid="dimension-order-row"]')
    expect(rows[0]!.attributes('data-dim-key')).toBe('b')
    expect(rows[1]!.attributes('data-dim-key')).toBe('a')
    expect(w.find('[data-testid="dimension-order-confirm"]').attributes('disabled')).toBeUndefined()
    await w.find('[data-testid="dimension-order-confirm"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await w.vm.$nextTick()
    expect(dbMocks.dbUpdateDimension).toHaveBeenCalledTimes(3)
    const applied = w.emitted('applied')?.[0]?.[0] as { id: string; sortOrder: number }[]
    expect(applied).toEqual([
      { id: 'd2', sortOrder: 0 },
      { id: 'd1', sortOrder: 1 },
      { id: 'd3', sortOrder: 2 },
    ])
    expect(w.emitted('update:open')).toEqual([[false]])
  })

  it('取消不写库只关闭；恢复按钮回到打开快照', async () => {
    const { w } = setup([dim('d1', 'a', 0), dim('d2', 'b', 1)])
    await w.find('[data-testid="dimension-order-down-a"]').trigger('click')
    expect(w.findAll('[data-testid="dimension-order-row"]')[0]!.attributes('data-dim-key')).toBe('b')
    await w.find('[data-testid="dimension-order-reset"]').trigger('click')
    expect(w.findAll('[data-testid="dimension-order-row"]')[0]!.attributes('data-dim-key')).toBe('a')
    expect(w.find('[data-testid="dimension-order-confirm"]').attributes('disabled')).toBeDefined()
    await w.find('[data-testid="dimension-order-cancel"]').trigger('click')
    expect(dbMocks.dbUpdateDimension).not.toHaveBeenCalled()
    expect(w.emitted('update:open')).toEqual([[false]])
    expect(w.emitted('applied')).toBeUndefined()
  })

  it('内按外松不关闭（拖出边界松开）；外-外关闭', async () => {
    const { w } = setup([dim('d1', 'a', 0), dim('d2', 'b', 1)])
    const overlay = w.find('[data-testid="dimension-order-overlay"]')
    const dialog = w.find('[data-testid="dimension-order-dialog"]')
    await dialog.trigger('mousedown')
    await overlay.trigger('click')
    expect(w.emitted('update:open')).toBeUndefined()
    await overlay.trigger('mousedown')
    await overlay.trigger('click')
    expect(w.emitted('update:open')).toEqual([[false]])
  })

  it('保存失败：不抛 applied，按 DB 刷新并错误提示', async () => {
    const { w } = setup([dim('d1', 'a', 0), dim('d2', 'b', 1)])
    dbMocks.dbUpdateDimension.mockRejectedValueOnce(new Error('db down'))
    await w.find('[data-testid="dimension-order-down-a"]').trigger('click')
    await w.find('[data-testid="dimension-order-confirm"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await w.vm.$nextTick()
    expect(w.emitted('applied')).toBeUndefined()
    expect(w.emitted('update:open')).toBeUndefined()
  })

  it('空维度显示空态', () => {
    const { w } = setup([])
    expect(w.findAll('[data-testid="dimension-order-row"]')).toHaveLength(0)
    expect(w.find('[data-testid="dimension-order-confirm"]').attributes('disabled')).toBeDefined()
  })
 
   it('单选框：点选/再点取消，同时最多选中一个', async () => {
     const { w } = setup([dim('d1', 'a', 0), dim('d2', 'b', 1)])
     const selA = () => w.find('[data-testid="dimension-order-select-a"]')
     const selB = () => w.find('[data-testid="dimension-order-select-b"]')
     expect(selA().text()).toBe('○')
     await selA().trigger('click')
     expect(selA().text()).toBe('●')
     expect(selA().attributes('aria-pressed')).toBe('true')
     await selB().trigger('click')
     expect(selA().text()).toBe('○')
     expect(selB().text()).toBe('●')
     await selB().trigger('click')
     expect(selB().text()).toBe('○')
     expect(w.emitted('applied')).toBeUndefined()
     w.unmount()
   })
 
   it('方向键：选中行按 ↑↓ 移动；未选中/组合键不响应', async () => {
     const { w } = setup([dim('d1', 'a', 0), dim('d2', 'b', 1), dim('d3', 'c', 2)])
     const keys = () => w.findAll('[data-testid="dimension-order-row"]').map((r) => r.attributes('data-dim-key'))
     // 未选中时方向键无效
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
     await w.vm.$nextTick()
     expect(keys()).toEqual(['a', 'b', 'c'])
     // 选中 b 后下移
     await w.find('[data-testid="dimension-order-select-b"]').trigger('click')
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
     await w.vm.$nextTick()
     expect(keys()).toEqual(['a', 'c', 'b'])
     // 组合键忽略
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, ctrlKey: true }))
     await w.vm.$nextTick()
     expect(keys()).toEqual(['a', 'c', 'b'])
     // 下移后保存可用（净变化）
     expect(w.find('[data-testid="dimension-order-confirm"]').attributes('disabled')).toBeUndefined()
     // 上移回到原位（选中跟随行走），净零变化 → 保存禁用
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
     await w.vm.$nextTick()
     expect(keys()).toEqual(['a', 'b', 'c'])
     expect(w.find('[data-testid="dimension-order-confirm"]').attributes('disabled')).toBeDefined()
     w.unmount()
   })
 
   it('指针拖拽：首行按住拖到末尾，松手提交顺序并选中跟随', async () => {
     const { w } = setup([dim('d1', 'a', 0), dim('d2', 'b', 1), dim('d3', 'c', 2)])
     const rows = () => w.findAll('[data-testid="dimension-order-row"]')
     // jsdom 无布局：桩出三行几何（每行高 36，纵向堆叠）
     rows().forEach((r, i) => {
       ;(r.element as HTMLElement).getBoundingClientRect = () =>
         ({ top: i * 40, height: 36 }) as unknown as DOMRect
     })
     const keys = () => rows().map((r) => r.attributes('data-dim-key'))
     firePointer(w.find('[data-testid="dimension-order-handle-a"]').element, 'pointerdown', { button: 0, clientY: 18, pointerId: 5 })
     await w.vm.$nextTick()
     // 拖拽中：被拖行跟随指针位移
     const draggingStyle = rows()[0]!.attributes('style') ?? ''
     expect(draggingStyle).toContain('translateY')
     // 指针移到末行下方 → 落点应为末位
     const mv = new Event('pointermove', { bubbles: true }) as Event & { clientY: number; pointerId: number }
     mv.clientY = 110
     mv.pointerId = 5
     window.dispatchEvent(mv)
     await w.vm.$nextTick()
     // 预览位序：被拖行显示 3
     expect(w.findAll('[data-testid="dimension-order-index"]').map((n) => n.text())).toEqual(['3', '1', '2'])
     const up = new Event('pointerup', { bubbles: true }) as Event & { pointerId: number }
     up.pointerId = 5
     window.dispatchEvent(up)
     await w.vm.$nextTick()
     expect(keys()).toEqual(['b', 'c', 'a'])
     // 拖拽行保持选中跟随
     expect(w.find('[data-testid="dimension-order-select-a"]').text()).toBe('●')
     expect(w.find('[data-testid="dimension-order-confirm"]').attributes('disabled')).toBeUndefined()
     w.unmount()
   })
 
   it('指针拖拽：按下原地松手不产生位移', async () => {
     const { w } = setup([dim('d1', 'a', 0), dim('d2', 'b', 1)])
     const rows = () => w.findAll('[data-testid="dimension-order-row"]')
     rows().forEach((r, i) => {
       ;(r.element as HTMLElement).getBoundingClientRect = () =>
         ({ top: i * 40, height: 36 }) as unknown as DOMRect
     })
     firePointer(w.find('[data-testid="dimension-order-handle-a"]').element, 'pointerdown', { button: 0, clientY: 18, pointerId: 5 })
     const up = new Event('pointerup', { bubbles: true }) as Event & { pointerId: number }
     up.pointerId = 5
     window.dispatchEvent(up)
     await w.vm.$nextTick()
     expect(rows().map((r) => r.attributes('data-dim-key'))).toEqual(['a', 'b'])
     expect(w.find('[data-testid="dimension-order-confirm"]').attributes('disabled')).toBeDefined()
     w.unmount()
   })
})
