import { describe, it, expect, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useShortcuts, type ShortcutHandlers } from '@/composables/useShortcuts'

function setup(handlers: ShortcutHandlers) {
  const C = defineComponent({ setup() { useShortcuts(handlers); return () => h('div') } })
  const w = mount(C, { attachTo: document.body })
  return w
}

function key(k: string, opts: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts })
}

describe('useShortcuts — need04 Ctrl+H', () => {
  it('Ctrl+H 调用 toggleHistory', () => {
    const toggleHistory = vi.fn()
    const w = setup({ toggleHistory })
    window.dispatchEvent(key('h', { ctrlKey: true }))
    expect(toggleHistory).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('Cmd+H（metaKey）同样触发', () => {
    const toggleHistory = vi.fn()
    const w = setup({ toggleHistory })
    window.dispatchEvent(key('h', { metaKey: true }))
    expect(toggleHistory).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('焦点在输入框内不触发 Ctrl+H', () => {
    const toggleHistory = vi.fn()
    const w = setup({ toggleHistory })
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(key('h', { ctrlKey: true }))
    expect(toggleHistory).not.toHaveBeenCalled()
    document.body.removeChild(input)
    w.unmount()
  })

  it('未注册 toggleHistory 时 Ctrl+H 不抛错，且 Ctrl+S 仍可用', () => {
    const save = vi.fn()
    const w = setup({ save })
    expect(() => window.dispatchEvent(key('h', { ctrlKey: true }))).not.toThrow()
    window.dispatchEvent(key('s', { ctrlKey: true }))
    expect(save).toHaveBeenCalledTimes(1)
    w.unmount()
  })
})
