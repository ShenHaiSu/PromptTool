import { ref, computed, onMounted, onBeforeUnmount, type Ref } from 'vue'
import { logger } from '@/lib/logger'

/** 缩放范围 */
export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 8
/** 步进倍率（1:1 按钮与 +/- 使用） */
export const ZOOM_STEP = 1.25
/** 适应窗口时的留白比例，避免图片贴边 */
const FIT_PADDING = 0.96

export interface ZoomPoint {
  x: number
  y: number
}

export interface ZoomTransform {
  scale: number
  x: number
  y: number
}

/** 钳制缩放值到 [ZOOM_MIN, ZOOM_MAX] */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))
}

/**
 * 以锚点为基准换算缩放后的平移偏移。
 *
 * 图像以容器中心为原点，先缩放再平移：屏幕坐标 = offset + point * scale
 * 设缩放前 (s, o)，缩放后 (s', o')，要求锚点 m 下的图像点保持不动：
 *   m - o' = (m - o) * s' / s   =>   o' = m - (m - o) * s' / s
 *
 * @param m 锚点在容器坐标系中的位置（相对容器中心）
 * @param o 缩放前的平移偏移
 * @param from 缩放前的 scale
 * @param to 缩放后的 scale
 */
export function zoomAroundPoint(
  m: ZoomPoint,
  o: ZoomPoint,
  from: number,
  to: number,
): ZoomPoint {
  if (from <= 0) return { ...o }
  const ratio = to / from
  return {
    x: m.x - (m.x - o.x) * ratio,
    y: m.y - (m.y - o.y) * ratio,
  }
}

/** 计算适应容器的缩放比 */
export function computeFitScale(
  natural: ZoomPoint,
  container: ZoomPoint,
): number {
  if (natural.x <= 0 || natural.y <= 0) return 1
  if (container.x <= 0 || container.y <= 0) return 1
  const s = Math.min(container.x / natural.x, container.y / natural.y) * FIT_PADDING
  return clampScale(s)
}

/**
 * 图片缩放 / 平移交互。
 *
 * - 滚轮：以光标为锚点缩放
 * - 左键拖拽：平移
 * - 双击：复位
 *
 * 仅在 stageRef 指定的容器内捕获事件，滚轮不冒泡滚动页面。
 */
export function useImageZoomPan(stageRef: Ref<HTMLElement | null>) {
  const scale = ref(1)
  const offsetX = ref(0)
  const offsetY = ref(0)
  /** 适应窗口模式：容器尺寸变化时自动重算 fit */
  const autoFit = ref(true)
  /** 拖拽中（用于 cursor 反馈） */
  const dragging = ref(false)

  const natural = ref<ZoomPoint>({ x: 0, y: 0 })
  const container = ref<ZoomPoint>({ x: 0, y: 0 })

  const transform = computed<ZoomTransform>(() => ({
    scale: scale.value,
    x: offsetX.value,
    y: offsetY.value,
  }))

  const percentLabel = computed(() => `${Math.round(scale.value * 100)}%`)

  /** 把客户端坐标换算为「相对容器中心」的坐标 */
  function toLocalCenter(clientX: number, clientY: number): ZoomPoint {
    const el = stageRef.value
    if (!el) return { x: clientX, y: clientY }
    const rect = el.getBoundingClientRect()
    return {
      x: clientX - (rect.left + rect.width / 2),
      y: clientY - (rect.top + rect.height / 2),
    }
  }

  function applyFit(): void {
    const s = computeFitScale(natural.value, container.value)
    scale.value = s
    offsetX.value = 0
    offsetY.value = 0
  }

  function setScaleAround(next: number, anchor: ZoomPoint): void {
    const to = clampScale(next)
    const from = scale.value
    if (to === from) return
    const o = zoomAroundPoint(anchor, { x: offsetX.value, y: offsetY.value }, from, to)
    offsetX.value = o.x
    offsetY.value = o.y
    scale.value = to
    // 手动缩放后脱离适应模式
    if (Math.abs(to - computeFitScale(natural.value, container.value)) > 1e-6) {
      autoFit.value = false
    }
  }

  function zoomBy(factor: number, anchor?: ZoomPoint): void {
    const a = anchor ?? { x: 0, y: 0 }
    setScaleAround(scale.value * factor, a)
  }

  function zoomIn(): void {
    zoomBy(ZOOM_STEP)
  }

  function zoomOut(): void {
    zoomBy(1 / ZOOM_STEP)
  }

  /** 100% 原始像素 */
  function actualSize(): void {
    setScaleAround(1, { x: 0, y: 0 })
  }

  /** 适应窗口 */
  function fit(): void {
    autoFit.value = true
    applyFit()
  }

  /** 复位：回到 100% 且无偏移 */
  function reset(): void {
    autoFit.value = false
    scale.value = 1
    offsetX.value = 0
    offsetY.value = 0
  }

  /** 图片加载完成后告知自然尺寸 */
  function onImageLoad(img: HTMLImageElement): void {
    natural.value = { x: img.naturalWidth, y: img.naturalHeight }
    measureContainer()
    if (autoFit.value) applyFit()
  }

  function measureContainer(): void {
    const el = stageRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    container.value = { x: rect.width, y: rect.height }
  }

  function onWheel(e: WheelEvent): void {
    if (natural.value.x <= 0) return
    e.preventDefault()
    // 向上滚（deltaY<0）放大，与常见图片查看器一致
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
    const anchor = toLocalCenter(e.clientX, e.clientY)
    setScaleAround(scale.value * factor, anchor)
  }

  let dragPointerId: number | null = null
  let startX = 0
  let startY = 0
  let startOffsetX = 0
  let startOffsetY = 0

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return
    if (natural.value.x <= 0) return
    dragPointerId = e.pointerId
    startX = e.clientX
    startY = e.clientY
    startOffsetX = offsetX.value
    startOffsetY = offsetY.value
    dragging.value = true
    stageRef.value?.setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e: PointerEvent): void {
    if (dragPointerId !== e.pointerId) return
    offsetX.value = startOffsetX + (e.clientX - startX)
    offsetY.value = startOffsetY + (e.clientY - startY)
  }

  function endDrag(e: PointerEvent): void {
    if (dragPointerId !== e.pointerId) return
    try {
      stageRef.value?.releasePointerCapture?.(e.pointerId)
    } catch (e) {
      logger.warn('useImageZoomPan', '释放 pointer capture 失败：', e)
    }
    dragPointerId = null
    dragging.value = false
  }

  let observer: ResizeObserver | null = null

  onMounted(() => {
    measureContainer()
    const el = stageRef.value
    if (!el || typeof ResizeObserver === 'undefined') return
    observer = new ResizeObserver(() => {
      measureContainer()
      if (autoFit.value) applyFit()
    })
    observer.observe(el)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })

  return {
    scale,
    offsetX,
    offsetY,
    transform,
    percentLabel,
    dragging,
    autoFit,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onDblClick: reset,
    onImageLoad,
    zoomIn,
    zoomOut,
    actualSize,
    fit,
    reset,
    clampScale,
  }
}
