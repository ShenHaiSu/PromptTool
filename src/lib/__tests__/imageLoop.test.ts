/**
 * F3 §7：imageLoop 测试（真值表 / 补货不写 batch.results / want 钳制 / 词库空节流 toast）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  convertFileSrc: (p: string) => `file://${p}`,
  isTauri: () => false,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

import { useAssemblyStore } from '@/stores/assembly'
import { useBatchStore } from '@/stores/batch'
import { useImageQueueStore } from '@/stores/imageQueue'
import { useLibraryStore } from '@/stores/library'
import { __resetLoopTestState, refillFromEngine, prepareStartQueue } from '@/lib/imageLoop'

function seedRunningLoop(concurrency = 2): void {
  const iq = useImageQueueStore()
  iq.config.loopEnabled = true
  iq.config.apiKeyState = 'set'
  iq.runningGen = 1
  iq.__applyStatsNow({ queued: 0, running: 1, succeeded: 0, failed: 0, consecFail: 0, stopped: false })
  iq.config.concurrency = concurrency
}

function seedLibrary(): void {
  const library = useLibraryStore()
  library.dimensions = [
    { id: 'd1', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 0, isMultiSelect: false, isEnabled: true },
  ]
  library.modulesByDim = {
    top: [
      { id: 'm1', dimensionId: 'd1', contentEn: 'white shirt', displayName: 'ws', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
      { id: 'm2', dimensionId: 'd1', contentEn: 'black jacket', displayName: 'bj', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
    ],
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  __resetLoopTestState()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === 'iq_enqueue') return Promise.resolve(['t-new'])
    return Promise.reject(new Error(`no backend: ${cmd}`))
  })
})

describe('prepareStartQueue 开始前备料', () => {
  const noopPush = (() => {}) as never
  function seedAutoRandom(concurrency = 2): void {
    const iq = useImageQueueStore()
    iq.config.autoRandomOnStart = true
    iq.config.apiKeyState = 'set'
    iq.config.concurrency = concurrency
  }
  function seedBatchResult(): void {
    const batch = useBatchStore()
    batch.results = [
      { index: 1, ir: { segments: [], warnings: [], hash: () => 'u1' } as never, finalPrompt: 'user p1', warnings: [], dimKeys: [], hash: 'u1' },
    ]
  }
  function iqEnqueueCalls(): unknown[][] {
    return mockInvoke.mock.calls.filter((c) => c[0] === 'iq_enqueue')
  }

  it('开关关闭 → direct 且不入队', async () => {
    const r = await prepareStartQueue({ push: noopPush, confirm: () => true })
    expect(r).toEqual({ kind: 'direct' })
    expect(iqEnqueueCalls()).toHaveLength(0)
  })

  it('开关开但未设密钥 → blocked no-key', async () => {
    const iq = useImageQueueStore()
    iq.config.autoRandomOnStart = true
    const r = await prepareStartQueue({ push: noopPush, confirm: () => true })
    expect(r).toEqual({ kind: 'blocked', reason: 'no-key' })
    expect(iqEnqueueCalls()).toHaveLength(0)
  })

  it('有批量结果 + 确定 → 直接入队现有', async () => {
    seedAutoRandom()
    seedBatchResult()
    const r = await prepareStartQueue({ push: noopPush, confirm: () => true })
    expect(r).toMatchObject({ kind: 'ready', usedExisting: true, enqueued: 1 })
    expect(iqEnqueueCalls().length).toBeGreaterThan(0)
  })

  it('有批量结果 + 取消 → 重新随机并发数条', async () => {
    seedAutoRandom(2)
    seedLibrary()
    seedBatchResult()
    let n = 0
    const engine = {
      randomAssembly: vi.fn().mockImplementation(() => {
        n += 1
        return [{ segments: [], hash: () => `fresh${n}` }]
      }),
      partialRandomAssembly: vi.fn().mockReturnValue([]),
    }
    const r = await prepareStartQueue({ engine: engine as never, push: noopPush, confirm: () => false })
    expect(r).toMatchObject({ kind: 'ready', usedExisting: false })
    expect(engine.randomAssembly).toHaveBeenCalledTimes(2)
  })

  it('无批量结果 + 词库空 → blocked empty', async () => {
    seedAutoRandom()
    const pushes: string[] = []
    const r = await prepareStartQueue({ push: ((m: string) => { pushes.push(m) }) as never, confirm: () => true })
    expect(r).toEqual({ kind: 'blocked', reason: 'empty' })
    expect(iqEnqueueCalls()).toHaveLength(0)
  })
})

describe('补货不写 batch.results', () => {
  it('refill 后用户批量结果原样保留', async () => {
    seedRunningLoop()
    seedLibrary()
    const batch = useBatchStore()
    batch.results = [
      { index: 1, ir: { segments: [], warnings: [], hash: () => 'u' } as never, finalPrompt: 'user asset', warnings: [], dimKeys: [], hash: 'u' },
    ]
    const before = [...batch.results]
    const engine = {
      randomAssembly: vi.fn().mockReturnValue([{ segments: [], hash: () => 'h-new' }]),
      partialRandomAssembly: vi.fn().mockReturnValue([]),
    }
    const r = await refillFromEngine(1, { engine: engine as never })
    expect(r.enqueued).toBe(1)
    expect(batch.results).toEqual(before)
  })
})

describe('want 钳制', () => {
  it('want=100 且 concurrency=2 时最多补 2 条', async () => {
    seedRunningLoop(2)
    seedLibrary()
    let n = 0
    const engine = {
      randomAssembly: vi.fn().mockImplementation(() => {
        n += 1
        return [{ segments: [], hash: () => `h${n}` }]
      }),
      partialRandomAssembly: vi.fn().mockReturnValue([]),
    }
    await refillFromEngine(100, { engine: engine as never })
    expect(engine.randomAssembly).toHaveBeenCalledTimes(2)
  })
})

describe('词库空节流 toast', () => {
  it('10s 内只提示一次“词库为空”', async () => {
    seedRunningLoop()
    const assembly = useAssemblyStore()
    void assembly
    const pushes: string[] = []
    const push = (msg: string) => {
      pushes.push(msg)
    }
    // library 为空：fetchAll 走 db（invoke reject）后仍空
    const r1 = await refillFromEngine(1, { push: push as never })
    expect(r1).toEqual({ enqueued: 0, skipped: 0 })
    expect(pushes.filter((m) => m.includes('词库为空'))).toHaveLength(1)
    const r2 = await refillFromEngine(1, { push: push as never })
    expect(r2).toEqual({ enqueued: 0, skipped: 0 })
    expect(pushes.filter((m) => m.includes('词库为空'))).toHaveLength(1)
  })
})
