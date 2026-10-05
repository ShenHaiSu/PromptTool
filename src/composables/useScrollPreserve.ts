/**
 * 滚动位置保持 — 修复「点击随机/词库刷新后维度面板滚动高度丢失」。
 *
 * 背景：滚动容器是 el-scrollbar，其内容节点在 loading 分支下曾被 v-if 卸载重建，
 * 内容高度塌缩时浏览器把 scrollTop 归零；即使内容不再卸载，数据整体替换也可能
 * 让 wrap 的 scrollHeight 短暂不足。此 composable 负责：
 *   1. 在「重建信号」（reloadSignal）变化前抓取当前 scrollTop 并写入 store；
 *   2. 信号变化后（DOM 已更新）把 scrollTop 还原；
 *   3. 组件挂载时还原（覆盖 v-if/v-show 切换、面板重挂）；
 *   4. resetSignal（如搜索词变化）变化时清零并归位到顶部。
 *
 * 位置按 persistKey 分桶存放于 dimensionPanel store（localStorage: pmf:scrollTop）。
 */
import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { useDimensionPanelStore } from '@/stores/dimensionPanel'

/**
 * 滚动适配器：优先使用 el-scrollbar 实例方法（若有），否则直接操作其 wrap 元素。
 * Element Plus 仅 expose 了 setScrollTop/wrapRef，未暴露 getScrollTop，故两者都要兜底。
 */
export interface ScrollApi {
  getScrollTop: () => number
  setScrollTop: (n: number) => void
}
export interface ScrollPreserveOptions {
  /** el-scrollbar 的 template ref */
  scroller: Ref<ScrollApi | null | undefined>
  /** 持久化分桶 key，通常为 `${区域}:${搜索词}` */
  persistKey: string | Ref<string>
  /** 会导致滚动内容重建/高度变化的信号，如 () => props.loading */
  reloadSignal?: () => unknown
  /** 语义上应当回到顶部的信号，如 () => props.keyword */
  resetSignal?: () => unknown
  /** 该面板当前是否可见（v-show 切换时用于重新归位） */
  activeSignal?: () => unknown
}

/** 兼容测试/降级：ref 未绑定时创建的替身 */
function noopApi(): ScrollApi {
  return { getScrollTop: () => 0, setScrollTop: () => {} }
}

export function useScrollPreserve(opts: ScrollPreserveOptions): void {
  const store = useDimensionPanelStore()
  const { scroller, reloadSignal, resetSignal, activeSignal } = opts
  const key = (): string => (typeof opts.persistKey === 'string' ? opts.persistKey : opts.persistKey.value)
  // 组件内最后一次已知位置（store 为跨挂载的持久层）
  let last = 0

  function api(): ScrollApi {
    const raw = scroller.value as unknown as Record<string, unknown> | null | undefined
    if (!raw) return noopApi()
    // 1) 实例自带完整 API
    if (typeof raw.getScrollTop === 'function' && typeof raw.setScrollTop === 'function') {
      return {
        getScrollTop: () => (raw.getScrollTop as () => number)(),
        setScrollTop: (n: number) => { (raw.setScrollTop as (v: number) => void)(n) },
      }
    }
    // 2) el-scrollbar：直接操作 wrap 元素（EP 未 expose getScrollTop）
    const wrap = (raw.wrapRef ?? (raw.$el as HTMLElement | undefined)?.querySelector?.('.el-scrollbar__wrap')) as HTMLElement | undefined
    if (wrap) {
      return {
        getScrollTop: () => wrap.scrollTop,
        setScrollTop: (n: number) => {
          wrap.scrollTop = n
          const handle = raw.handleScroll
          if (typeof handle === 'function') (handle as (e: unknown) => void).call(raw, wrap)
        },
      }
    }
    return noopApi()
  }

  /** 抓取当前真实位置并写入 store */
  function capture(): void {
    const v = api().getScrollTop()
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      last = v
      store.setScrollTop(key(), v)
    }
  }

  /** DOM 更新后还原到 last / store 中的位置 */
  async function restore(): Promise<void> {
    await nextTick()
    const target = last > 0 ? last : store.getScrollTop(key())
    if (target <= 0) return
    const a = api()
    // 内容尚未撑开时 el-scrollbar 会忽略 setScrollTop，下一帧再补一次
    a.setScrollTop(target)
    await nextTick()
    a.setScrollTop(target)
  }

  if (resetSignal) {
    watch(resetSignal, () => {
      last = 0
      store.clearScrollTop(key())
      api().setScrollTop(0)
    })
  }

  if (reloadSignal) {
    // 变化前抓取（pre），变化后还原（post，保证 DOM 已更新）
    watch(reloadSignal, () => { capture() }, { flush: 'pre' })
    watch(reloadSignal, () => { void restore() }, { flush: 'post' })
  }

  if (activeSignal) {
    // 面板由 v-show 切换：隐藏时抓取，重新显示时归位
    watch(activeSignal, (v) => {
      if (v) void restore()
      else capture()
    }, { flush: 'post' })
  }
  onMounted(() => {
    void restore()
  })

  onBeforeUnmount(() => {
    capture()
  })

  return undefined
}

