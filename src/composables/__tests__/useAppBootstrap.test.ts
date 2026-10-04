/**
 * need03 S6：useAppBootstrap 启动编排（前台库判定 / carry 回填 / 各段降级）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

const { stores } = vi.hoisted(() => ({
  stores: {
    assembly: { setSelected: vi.fn(), selectedItems: [] as unknown[] },
    history: { fetchAll: vi.fn() },
    dbRegistry: {
      fetchActiveInfo: vi.fn(),
      fetchList: vi.fn(),
      activeInfo: null as unknown,
      onboardingOpen: false as boolean,
    },
    library: {
      fetchAll: vi.fn(),
      scheduleFetch: vi.fn(),
      dispose: vi.fn(),
      dimensions: [] as unknown[],
      total: 0,
      modulesByDim: {} as Record<string, unknown[]>,
    },
    dbGetTempCarry: vi.fn(),
  },
}))

vi.mock('@/stores/assembly', () => ({ useAssemblyStore: () => stores.assembly }))
vi.mock('@/stores/history', () => ({ useHistoryStore: () => stores.history }))
vi.mock('@/stores/dbRegistry', () => ({ useDbRegistryStore: () => stores.dbRegistry }))
vi.mock('@/stores/library', () => ({ useLibraryStore: () => stores.library }))
vi.mock('@/lib/db', () => ({ dbGetTempCarry: stores.dbGetTempCarry }))

import { useAppBootstrap } from '../useAppBootstrap'

type Api = ReturnType<typeof useAppBootstrap>

const foreground = { id: 'g1', path: 'C:/lib', alias: '主库' }

/** 在真实组件上下文里跑（onMounted 需要），返回 composable 出口。 */
function setup(): Api {
  let api!: Api
  const C = defineComponent({
    setup() {
      api = useAppBootstrap()
      return () => h('div')
    },
  })
  mount(C)
  return api
}

/** onMounted 会自动跑一次 bootstrap；需要隔离某次显式 bootstrap 时先冲干净自动那次。 */
async function flushAutoBootstrap(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
  stores.assembly.setSelected.mockClear()
  stores.history.fetchAll.mockClear()
  stores.dbRegistry.fetchActiveInfo.mockClear()
  stores.dbRegistry.fetchList.mockClear()
  stores.library.fetchAll.mockClear()
  stores.library.scheduleFetch.mockClear()
  stores.dbGetTempCarry.mockClear()
  stores.dbRegistry.onboardingOpen = false
}

beforeEach(() => {
  setActivePinia(createPinia())
  stores.assembly.setSelected.mockReset()
  stores.history.fetchAll.mockReset()
  stores.dbRegistry.fetchActiveInfo.mockReset()
  stores.dbRegistry.fetchList.mockReset()
  stores.library.fetchAll.mockReset()
  stores.library.scheduleFetch.mockReset()
  stores.library.dispose.mockReset()
  stores.dbGetTempCarry.mockReset()
  stores.dbRegistry.activeInfo = { foreground, resident: [], maxActive: 3 }
  stores.dbRegistry.onboardingOpen = false
  stores.library.dimensions = []
  stores.library.total = 0
  stores.library.modulesByDim = {}
  stores.history.fetchAll.mockResolvedValue(undefined)
  stores.library.fetchAll.mockResolvedValue(undefined)
  stores.dbRegistry.fetchActiveInfo.mockResolvedValue(undefined)
  stores.dbRegistry.fetchList.mockResolvedValue(undefined)
  stores.dbGetTempCarry.mockResolvedValue(null)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('useAppBootstrap 前台库判定', () => {
  it('有前台库：拉词库并同步计数', async () => {
    stores.library.dimensions = [{ id: 'd1' }, { id: 'd2' }]
    stores.library.total = 7
    const api = setup()
    await api.bootstrap()
    expect(stores.library.fetchAll).toHaveBeenCalled()
    expect(api.dimCount.value).toBe(2)
    expect(api.moduleCount.value).toBe(7)
    expect(stores.dbRegistry.onboardingOpen).toBe(false)
  })

  it('无前台库：直接开引导并提前返回（不拉词库）', async () => {
    stores.dbRegistry.activeInfo = { foreground: null, resident: [], maxActive: 3 }
    const api = setup()
    await api.bootstrap()
    expect(stores.dbRegistry.onboardingOpen).toBe(true)
    expect(stores.library.fetchAll).not.toHaveBeenCalled()
  })

  it('fetchActiveInfo reject：降级开引导并提前返回', async () => {

    const api = setup()
    await flushAutoBootstrap()
    stores.dbRegistry.fetchActiveInfo.mockRejectedValueOnce(new Error('reg boom'))
    await expect(api.bootstrap()).resolves.toBeUndefined()
    expect(stores.dbRegistry.onboardingOpen).toBe(true)
    expect(stores.library.fetchAll).not.toHaveBeenCalled()
  })

  it('library.fetchAll reject：降级继续拉历史', async () => {
    stores.library.fetchAll.mockRejectedValueOnce(new Error('lib boom'))
    const api = setup()
    await api.bootstrap()
    expect(stores.history.fetchAll).toHaveBeenCalled()
  })

  it('history.fetchAll reject：不影响启动完成', async () => {
    stores.history.fetchAll.mockRejectedValueOnce(new Error('hist boom'))
    const api = setup()
    await expect(api.bootstrap()).resolves.toBeUndefined()
  })
})

describe('useAppBootstrap 计数同步守卫', () => {
  it('词库为空时保持原计数（不被 0 覆盖）', () => {
    const api = setup()
    api.dimCount.value = 5
    api.moduleCount.value = 9
    api.syncCountsFromLibrary()
    expect(api.dimCount.value).toBe(5)
    expect(api.moduleCount.value).toBe(9)
  })
})

describe('useAppBootstrap temp carry 回填', () => {
  it('carry 有选中项且模块可解析时 setSelected（带 weightOverride）', async () => {
    stores.library.modulesByDim = { top: [{ id: 'm1', dimensionId: 'd1' }], bottom: [{ id: 'm2', dimensionId: 'd2' }] }
    stores.dbGetTempCarry.mockResolvedValueOnce({ selectedItemIds: ['m1', 'm2'], weightDraft: { m1: 1.5 } })
    const api = setup()
    await api.bootstrap()
    expect(stores.assembly.setSelected).toHaveBeenCalledWith([
      { module: { id: 'm1', dimensionId: 'd1' }, locked: false, weightOverride: 1.5 },
      { module: { id: 'm2', dimensionId: 'd2' }, locked: false, weightOverride: null },
    ])
  })

  it('carry 中 id 解析不到时被过滤，全空则不 setSelected', async () => {
    stores.library.modulesByDim = {}
    stores.dbGetTempCarry.mockResolvedValueOnce({ selectedItemIds: ['nope'] })
    const api = setup()
    await api.bootstrap()
    expect(stores.assembly.setSelected).not.toHaveBeenCalled()
  })

  it('carry 为空数组时值不 setSelected', async () => {
    stores.dbGetTempCarry.mockResolvedValueOnce({ selectedItemIds: [] })
    const api = setup()
    await api.bootstrap()
    expect(stores.assembly.setSelected).not.toHaveBeenCalled()
  })

  it('dbGetTempCarry reject：降级不抛', async () => {
    stores.dbGetTempCarry.mockRejectedValueOnce(new Error('carry boom'))
    const api = setup()
    await expect(api.bootstrap()).resolves.toBeUndefined()
  })
})

describe('useAppBootstrap 订阅与 dispose', () => {
  it('handleLibraryChanged 转调 library.scheduleFetch', () => {
    const api = setup()
    api.handleLibraryChanged()
    expect(stores.library.scheduleFetch).toHaveBeenCalled()
  })

  it('dispose 取消订阅并调用 library.dispose', () => {
    const api = setup()
    api.dispose()
    expect(stores.library.dispose).toHaveBeenCalled()
  })
})