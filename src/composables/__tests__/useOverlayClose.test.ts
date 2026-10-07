import { describe, it, expect, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useOverlayClose } from '../useOverlayClose'

function mouseEvt(target: unknown, currentTarget: unknown, button = 0): MouseEvent {
  return { target, currentTarget, button } as unknown as MouseEvent
}

describe('useOverlayClose', () => {
  it('外-外：mousedown 在 overlay + click 在 overlay → 关闭', () => {
    const close = vi.fn()
    const oc = useOverlayClose(close, { enableEscape: false })
    const overlay = {}
    oc.onMouseDown(mouseEvt(overlay, overlay))
    oc.onClick(mouseEvt(overlay, overlay))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('内-外：mousedown 在内容 + click 在 overlay → 不关闭（D2 主 bug）', () => {
    const close = vi.fn()
    const oc = useOverlayClose(close, { enableEscape: false })
    const overlay = {}
    const inner = {}
    // 内容区 mousedown 冒泡到 overlay：target=inner, currentTarget=overlay
    oc.onMouseDown(mouseEvt(inner, overlay))
    // mouseup 在遮罩：浏览器 click.target 上浮为 overlay
    oc.onClick(mouseEvt(overlay, overlay))
    expect(close).not.toHaveBeenCalled()
  })

  it('内-内：内容区 click 冒泡 → 不关闭', () => {
    const close = vi.fn()
    const oc = useOverlayClose(close, { enableEscape: false })
    const overlay = {}
    const inner = {}
    oc.onMouseDown(mouseEvt(inner, overlay))
    oc.onClick(mouseEvt(inner, overlay))
    expect(close).not.toHaveBeenCalled()
  })

  it('外-内：外部按下、内部松开 → 不关闭', () => {
    const close = vi.fn()
    const oc = useOverlayClose(close, { enableEscape: false })
    const overlay = {}
    const inner = {}
    oc.onMouseDown(mouseEvt(overlay, overlay))
    oc.onClick(mouseEvt(inner, overlay))
    expect(close).not.toHaveBeenCalled()
  })

  it('右键 mousedown 不污染 flag', () => {
    const close = vi.fn()
    const oc = useOverlayClose(close, { enableEscape: false })
    const overlay = {}
    oc.onMouseDown(mouseEvt(overlay, overlay, 2))
    oc.onClick(mouseEvt(overlay, overlay))
    expect(close).not.toHaveBeenCalled()
  })

  it('忙态下遮罩关闭被拒', () => {
    const close = vi.fn()
    const busy = ref(true)
    const oc = useOverlayClose(close, { enableEscape: false, isBusy: busy })
    const overlay = {}
    oc.onMouseDown(mouseEvt(overlay, overlay))
    oc.onClick(mouseEvt(overlay, overlay))
    expect(close).not.toHaveBeenCalled()
    busy.value = false
    oc.onMouseDown(mouseEvt(overlay, overlay))
    oc.onClick(mouseEvt(overlay, overlay))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('Esc：open 时响应、关闭时不响应、忙态不响应', async () => {
    const close = vi.fn()
    const open = ref(true)
    const busy = ref(false)
    const Comp = defineComponent({
      setup() {
        useOverlayClose(close, { open, isBusy: busy })
        return () => h('div')
      },
    })
    const w = mount(Comp, { attachTo: document.body })
    await nextTick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(close).toHaveBeenCalledTimes(1)
    busy.value = true
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(close).toHaveBeenCalledTimes(1)
    busy.value = false
    open.value = false
    await nextTick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(close).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('enableEscape=false 时不注册 Esc', async () => {
    const close = vi.fn()
    const open = ref(true)
    const Comp = defineComponent({
      setup() {
        useOverlayClose(close, { open, enableEscape: false })
        return () => h('div')
      },
    })
    const w = mount(Comp, { attachTo: document.body })
    await nextTick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(close).not.toHaveBeenCalled()
    w.unmount()
  })
})
