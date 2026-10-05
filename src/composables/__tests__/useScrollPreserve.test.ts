import { describe, it, expect, beforeEach } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useScrollPreserve, type ScrollApi } from '@/composables/useScrollPreserve'
import { useDimensionPanelStore } from '@/stores/dimensionPanel'

/** 假滚动容器：记录 setScrollTop 调用，可模拟「内容塌缩 → 位置被浏览器归零」 */
function makeFakeApi(): ScrollApi & { calls: number[]; current: number } {
  const api = {
    current: 0,
    calls: [] as number[],
    getScrollTop(this: { current: number }) { return this.current },
    setScrollTop(this: { current: number; calls: number[] }, n: number) {
      this.current = n
      this.calls.push(n)
    },
  }
  return api as unknown as ScrollApi & { calls: number[]; current: number }
}

describe('useScrollPreserve — 滚动位置保持', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('重建信号（loading）翻转时：先抓取当前位置，再在 DOM 更新后还原', async () => {
    const api = makeFakeApi()
    const loading = ref(false)
    const Host = defineComponent({
      setup() {
        const scroller = ref<ScrollApi | null>(api)
        useScrollPreserve({ scroller, persistKey: 'browse:', reloadSignal: () => loading.value })
        return () => h('div')
      },
    })
    const w = mount(Host)
    await nextTick()

    // 用户滚动到 480
    api.current = 480

    // 点击随机 → loading 变 true → 内容重建（此时位置被"浏览器"归零）→ 变 false
    loading.value = true
    await nextTick()
    api.current = 0 // 模拟内容塌缩导致 scrollTop 归零
    loading.value = false
    await nextTick()
    await nextTick()
    await nextTick()

    expect(api.current).toBe(480)
    expect(api.calls.filter((n) => n === 480).length).toBeGreaterThanOrEqual(1)
    expect(useDimensionPanelStore().getScrollTop('browse:')).toBe(480)
    w.unmount()
  })

  it('resetSignal（搜索词）变化时清零并回到顶部', async () => {
    const api = makeFakeApi()
    const keyword = ref('skirt')
    const Host = defineComponent({
      setup() {
        const scroller = ref<ScrollApi | null>(api)
        useScrollPreserve({ scroller, persistKey: 'browse:skirt', resetSignal: () => keyword.value })
        return () => h('div')
      },
    })
    const w = mount(Host)
    await nextTick()
    api.current = 320
    keyword.value = 'hat'
    await nextTick()
    await nextTick()

    expect(api.current).toBe(0)
    expect(useDimensionPanelStore().getScrollTop('browse:skirt')).toBe(0)
    w.unmount()
  })

  it('挂载时从 store 恢复上次位置（跨挂载/模式切换）', async () => {
    const store = useDimensionPanelStore()
    store.setScrollTop('browse:', 260)
    const api = makeFakeApi()
    const Host = defineComponent({
      setup() {
        const scroller = ref<ScrollApi | null>(api)
        useScrollPreserve({ scroller, persistKey: 'browse:' })
        return () => h('div')
      },
    })
    const w = mount(Host)
    await nextTick()
    await nextTick()
    await nextTick()
    expect(api.current).toBe(260)
    w.unmount()
  })

  it('activeSignal 由 false→true（v-show 重新显示）时归位，true→false 时抓取', async () => {
    const api = makeFakeApi()
    const active = ref(true)
    const Host = defineComponent({
      setup() {
        const scroller = ref<ScrollApi | null>(api)
        useScrollPreserve({ scroller, persistKey: 'browse:', activeSignal: () => active.value })
        return () => h('div')
      },
    })
    const w = mount(Host)
    await nextTick()
    api.current = 150

    active.value = false // 切到 selected：隐藏时抓取
    await nextTick()
    expect(useDimensionPanelStore().getScrollTop('browse:')).toBe(150)

    api.current = 0 // 隐藏期间内容塌缩
    active.value = true // 切回 browse：重新显示时归位
    await nextTick()
    await nextTick()
    await nextTick()
    expect(api.current).toBe(150)
    w.unmount()
  })

  it('卸载时抓取当前位置到 store（配合 v-if 场景）', async () => {
    const api = makeFakeApi()
    const Host = defineComponent({
      setup() {
        const scroller = ref<ScrollApi | null>(api)
        useScrollPreserve({ scroller, persistKey: 'selected:' })
        return () => h('div')
      },
    })
    const w = mount(Host)
    await nextTick()
    api.current = 90
    w.unmount()
    expect(useDimensionPanelStore().getScrollTop('selected:')).toBe(90)
  })

  it('scrollbar 未绑定/ref 缺失时静默降级，不抛错', async () => {
    const loading = ref(false)
    const Host = defineComponent({
      setup() {
        const scroller = ref<ScrollApi | null>(null)
        useScrollPreserve({ scroller, persistKey: 'browse:', reloadSignal: () => loading.value })
        return () => h('div')
      },
    })
    const w = mount(Host)
    await nextTick()
    loading.value = true
    await nextTick()
    loading.value = false
    await nextTick()
    expect(true).toBe(true)
    w.unmount()
  })
})
