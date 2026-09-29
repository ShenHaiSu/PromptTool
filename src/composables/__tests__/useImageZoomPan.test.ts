import { describe, it, expect } from 'vitest'
import {
  clampScale,
  computeFitScale,
  zoomAroundPoint,
  ZOOM_MAX,
  ZOOM_MIN,
} from '@/composables/useImageZoomPan'

describe('useImageZoomPan 纯函数', () => {
  it('clampScale 限制在 [MIN, MAX] 且忽略非法值', () => {
    expect(clampScale(0.01)).toBe(ZOOM_MIN)
    expect(clampScale(999)).toBe(ZOOM_MAX)
    expect(clampScale(2.5)).toBe(2.5)
    expect(clampScale(Number.NaN)).toBe(1)
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('zoomAroundPoint：缩放后锚点下的图像点保持不动', () => {
    // s: 1 -> 2，锚点 m=(30,10)，原偏移 o=(5,-4)
    const o = { x: 5, y: -4 }
    const next = zoomAroundPoint({ x: 30, y: 10 }, o, 1, 2)
    // 校验不变量：(m - o') === (m - o) * s'/s
    expect(30 - next.x).toBeCloseTo((30 - o.x) * 2, 6)
    expect(10 - next.y).toBeCloseTo((10 - o.y) * 2, 6)
  })

  it('zoomAroundPoint：以中心为锚缩放时偏移按比例放大', () => {
    // 锚点即容器中心：图像以中心为原点整体缩放，偏移需同比缩放才不漂移
    const o = { x: 7, y: -3 }
    const next = zoomAroundPoint({ x: 0, y: 0 }, o, 1, 2)
    expect(next.x).toBeCloseTo(o.x * 2, 6)
    expect(next.y).toBeCloseTo(o.y * 2, 6)
  })

  it('zoomAroundPoint：缩回更小比例同样成立', () => {
    const o = { x: 12, y: 8 }
    const next = zoomAroundPoint({ x: -20, y: 40 }, o, 4, 1)
    expect(-20 - next.x).toBeCloseTo((-20 - o.x) * (1 / 4), 6)
    expect(40 - next.y).toBeCloseTo((40 - o.y) * (1 / 4), 6)
  })

  it('zoomAroundPoint：非法源比例原样返回', () => {
    expect(zoomAroundPoint({ x: 1, y: 1 }, { x: 3, y: 4 }, 0, 2)).toEqual({ x: 3, y: 4 })
  })

  it('computeFitScale 取宽高约束的较小值并留白', () => {
    // 1000x1000 图片放进 500x500 容器 -> 受宽度限制
    const s = computeFitScale({ x: 1000, y: 1000 }, { x: 500, y: 500 })
    expect(s).toBeCloseTo(0.5 * 0.96, 6)
    // 1000x500 放进 500x500 -> 受高度限制
    const s2 = computeFitScale({ x: 1000, y: 500 }, { x: 500, y: 500 })
    expect(s2).toBeCloseTo(0.5 * 0.96, 6)
  })

  it('computeFitScale：尺寸缺失时回退为 1', () => {
    expect(computeFitScale({ x: 0, y: 0 }, { x: 500, y: 500 })).toBe(1)
    expect(computeFitScale({ x: 100, y: 100 }, { x: 0, y: 0 })).toBe(1)
  })
})
