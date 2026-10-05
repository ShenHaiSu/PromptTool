import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { persistGeometry, getPersistedGeometrySave, loadGeometry } from '../usePersist'

function stubViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
}

describe('usePersist persistGeometry（窗口几何持久化）', () => {
  beforeEach(() => {
    localStorage.clear()
    stubViewport(1600, 900)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('save 写 localStorage 双键并回调注入的 saveWindowState', async () => {
    const saver = vi.fn().mockResolvedValue(undefined)
    persistGeometry({ saveWindowState: saver })
    getPersistedGeometrySave()?.()
    await vi.waitFor(() => expect(saver).toHaveBeenCalledWith(1600, 900))
    expect(loadGeometry()).toMatchObject({ width: 1600, height: 900 })
    expect(localStorage.getItem('pmf:geometry')).toContain('1600')
    expect(localStorage.getItem('pmf-geometry')).toContain('1600')
  })

  it('未注入 saver 时只写 localStorage 且不抛错', () => {
    persistGeometry()
    expect(() => getPersistedGeometrySave()?.()).not.toThrow()
    expect(loadGeometry()).toMatchObject({ width: 1600, height: 900 })
  })

  it('saver reject 时降级留痕且不抛错', async () => {
    const saver = vi.fn().mockRejectedValue(new Error('no backend'))
    persistGeometry({ saveWindowState: saver })
    expect(() => getPersistedGeometrySave()?.()).not.toThrow()
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())
  })

  it('低于 768p 最小几何时直接跳过（不写缓存不调 saver）', () => {
    stubViewport(800, 600)
    const saver = vi.fn()
    persistGeometry({ saveWindowState: saver })
    getPersistedGeometrySave()?.()
    expect(saver).not.toHaveBeenCalled()
    expect(loadGeometry()).toBeNull()
  })
})
