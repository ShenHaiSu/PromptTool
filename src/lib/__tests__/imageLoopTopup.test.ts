/**
 * 需求1 验收测试（docs/need01 01 + 07 A1–A4）
 * 后端 want/节流由 Rust 单测覆盖（queue.rs topup_want_table / topup_throttle_800ms）；
 * 本文件覆盖前端契约：shouldRefill 真值表 / 在途合并 / 停止丢弃 / 关开关回现状。
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

import { useImageQueueStore } from '@/stores/imageQueue'
import { useLibraryStore } from '@/stores/library'
import {
  __resetLoopTestState,
  __refillInflightState,
  cancelRefill,
  refillFromEngine,
  shouldRefill,
} from '@/lib/imageLoop'

function seedRunningLoop(concurrency = 3): void {
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

function uniqEngine() {
  let n = 0
  return {
    randomAssembly: vi.fn().mockImplementation(() => {
      n += 1
      return [{ segments: [], hash: () => `topup-h${n}` }]
    }),
    partialRandomAssembly: vi.fn().mockReturnValue([]),
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

describe('shouldRefill 真值表（需求1 §2.2：running=true + want>0 即补）', () => {
  it('loop 关 → false（A3 回现状）', () => {
    expect(shouldRefill(false, true, 2)).toBe(false)
  })
  it('未运行 → false', () => {
    expect(shouldRefill(true, false, 2)).toBe(false)
  })
  it('want=0 → false', () => {
    expect(shouldRefill(true, true, 0)).toBe(false)
  })
  it('运行中 + 缺口 → true（top-up 场景）', () => {
    expect(shouldRefill(true, true, 1)).toBe(true)
    expect(shouldRefill(true, true, 3)).toBe(true)
  })
})

describe('在途合并（需求1 §2.2：top-up hungry 高频到达不堆积）', () => {
  it('第二路 hungry 合并进挂起缺口，首轮结束后一次性再补', async () => {
    seedRunningLoop(3)
    seedLibrary()
    const engine = uniqEngine()
    const push = (() => {}) as never
    // 同步连续触发两路 hungry：p1 进轮内，p2 应合并（立即回 empty）
    const p1 = refillFromEngine(2, { engine: engine as never, push })
    const p2 = refillFromEngine(2, { engine: engine as never, push })
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r2).toEqual({ enqueued: 0, skipped: 0 })
    // 首轮 2 条 + 挂起轮 2 条，共补 4 条
    expect(r1.enqueued).toBe(4)
    expect(engine.randomAssembly).toHaveBeenCalledTimes(4)
    expect(__refillInflightState()).toEqual({ inflight: 0, pending: 0 })
  })

  it('挂起缺口上限为并发量', async () => {
    seedRunningLoop(3)
    seedLibrary()
    const engine = uniqEngine()
    const push = (() => {}) as never
    const p1 = refillFromEngine(3, { engine: engine as never, push })
    const p2 = refillFromEngine(3, { engine: engine as never, push })
    const p3 = refillFromEngine(3, { engine: engine as never, push })
    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    expect(r2).toEqual({ enqueued: 0, skipped: 0 })
    expect(r3).toEqual({ enqueued: 0, skipped: 0 })
    // 首轮 3 + 挂起 min(3+3, cap 3)=3，共 6
    expect(r1.enqueued).toBe(6)
    expect(engine.randomAssembly).toHaveBeenCalledTimes(6)
  })
})

describe('停止/关开关丢弃（A2/A3）', () => {
  it('loopEnabled=关 → 直接回 empty 且不调引擎', async () => {
    seedRunningLoop(3)
    seedLibrary()
    const iq = useImageQueueStore()
    iq.config.loopEnabled = false
    const engine = uniqEngine()
    const r = await refillFromEngine(3, { engine: engine as never, push: (() => {}) as never })
    expect(r).toEqual({ enqueued: 0, skipped: 0 })
    expect(engine.randomAssembly).not.toHaveBeenCalled()
  })

  it('cancel 后到达的 hungry 被丢弃（停止后无新增补货）', async () => {
    seedRunningLoop(3)
    seedLibrary()
    cancelRefill()
    const engine = uniqEngine()
    const r = await refillFromEngine(2, { engine: engine as never, push: (() => {}) as never })
    expect(r).toEqual({ enqueued: 0, skipped: 0 })
    expect(engine.randomAssembly).not.toHaveBeenCalled()
  })

  it('补货途中 cancel → 结果丢弃且挂起清空', async () => {
    seedRunningLoop(3)
    seedLibrary()
    let draws = 0
    const engine = {
      randomAssembly: vi.fn().mockImplementation(() => {
        draws += 1
        if (draws === 1) cancelRefill()
        return [{ segments: [], hash: () => `c-h${draws}` }]
      }),
      partialRandomAssembly: vi.fn().mockReturnValue([]),
    }
    const r = await refillFromEngine(3, { engine: engine as never, push: (() => {}) as never })
    expect(r).toEqual({ enqueued: 0, skipped: 0 })
    expect(__refillInflightState()).toEqual({ inflight: 0, pending: 0 })
  })
})
