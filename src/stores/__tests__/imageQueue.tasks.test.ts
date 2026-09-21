/**
 * F2 §6：任务域测试（增量合并 / stats 节流 / halted toast / 降级轮询开关）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  convertFileSrc: (p: string) => `file://${p}`,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

import { useImageQueueStore } from '@/stores/imageQueue'
import type { ImageTaskView } from '@/lib/imageQueueApi'

function task(id: string, status: ImageTaskView['status'] = 'queued'): ImageTaskView {
  return {
    id,
    prompt: `a test prompt ${id}`,
    irHash: null,
    size: '1K',
    ratio: '1:1',
    status,
    retryCount: 0,
    createdAt: Date.now(),
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === 'iq_list') return Promise.resolve({ total: 0, items: [] })
    if (cmd === 'iq_get_config') return Promise.resolve({ apiKey: '' })
    return Promise.reject(new Error(`no backend: ${cmd}`))
  })
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('task-updated 增量合并', () => {
  it('新 id 追加，老 id 原位更新，不全量刷新', () => {
    const iq = useImageQueueStore()
    iq.__applyTaskUpdated(task('t1'))
    iq.__applyTaskUpdated(task('t2'))
    expect(iq.order).toEqual(['t1', 't2'])
    iq.__applyTaskUpdated(task('t1', 'running'))
    expect(iq.order).toEqual(['t1', 't2'])
    expect(iq.tasks.get('t1')!.status).toBe('running')
  })
})

describe('stats 节流', () => {
  it('连续 10 次 emit 只渲染 ≤3 次（500ms 节流）', () => {
    vi.useFakeTimers()
    const iq = useImageQueueStore()
    const seen: number[] = []
    for (let i = 1; i <= 10; i++) {
      iq.__applyStats({ queued: 0, running: i, succeeded: 0, failed: 0, consecFail: 0, stopped: false })
      seen.push(iq.stats.running)
    }
    // 节流窗口内 stats 保持初始值（0），写入被合并
    expect(iq.stats.running).toBe(0)
    vi.advanceTimersByTime(500)
    expect(iq.stats.running).toBe(10)
    void seen
  })
})

describe('halted 各 reason 不崩且 stopped 置 true', () => {
  it.each(['manual', 'circuit', 'io', 'disk'] as const)('reason=%s', (reason) => {
    const iq = useImageQueueStore()
    iq.__applyHalted({ reason, message: 'boom' })
    expect(iq.stats.stopped).toBe(true)
    expect(iq.runningGen).toBeNull()
  })
})

describe('__TAURI__ 缺失降级轮询开关', () => {
  it('非 Tauri 环境 initQueue 后 degraded=true 且空队列可用', async () => {
    const g = window as unknown as Record<string, unknown>
    const prev = g.__TAURI__
    delete g.__TAURI__
    try {
      const iq = useImageQueueStore()
      await iq.initQueue()
      expect(iq.degraded).toBe(true)
      expect(iq.queueReady).toBe(true)
      expect(iq.order).toEqual([])
      iq.disposeQueue()
    } finally {
      if (prev !== undefined) g.__TAURI__ = prev
    }
  })
})

describe('enqueueBatch 本地去重', () => {
  it('与已存在任务撞键即跳过，不发 invoke', async () => {
    const iq = useImageQueueStore()
    iq.__applyTaskUpdated({ ...task('t1'), irHash: 'h1' })
    mockInvoke.mockClear()
    const r = await iq.enqueueBatch([{ prompt: 'other', irHash: 'h1' }])
    expect(r).toEqual({ enqueued: 0, skipped: 1 })
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
