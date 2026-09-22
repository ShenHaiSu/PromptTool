/**
 * F2 §6：任务域测试（增量合并 / stats 节流 / halted toast / 降级轮询开关）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mockInvoke = vi.fn()
const mockListen = vi.fn().mockResolvedValue(() => {})
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  convertFileSrc: (p: string) => `file://${p}`,
  isTauri: () => false,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
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
  mockListen.mockReset()
  mockListen.mockResolvedValue(() => {})
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

describe('事件订阅 / 降级轮询开关（先订阅，失败才降级）', () => {
  it('listen 成功 → 走事件通道，degraded=false', async () => {
    const iq = useImageQueueStore()
    await iq.initQueue()
    expect(mockListen).toHaveBeenCalled()
    expect(iq.degraded).toBe(false)
    expect(iq.queueReady).toBe(true)
    expect(iq.order).toEqual([])
    iq.disposeQueue()
  })
  it('listen 失败 → 降级轮询，degraded=true 且空队列可用', async () => {
    mockListen.mockRejectedValueOnce(new Error('no event channel'))
    mockListen.mockRejectedValue(new Error('no event channel'))
    const iq = useImageQueueStore()
    await iq.initQueue()
    expect(iq.degraded).toBe(true)
    expect(iq.queueReady).toBe(true)
    expect(iq.order).toEqual([])
    iq.disposeQueue()
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
