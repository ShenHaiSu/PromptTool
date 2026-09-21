/**
 * 随机后联动已删除：点随机不再自动入队/启动（备料改由生图队列开始前完成）；
 * 此处回归随机主链路不受影响 + chip 只读 loopEnabled。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  convertFileSrc: (p: string) => `file://${p}`,
}))

vi.mock('@/lib/db', () => ({
  dbGetDimensions: vi.fn().mockResolvedValue([
    { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true },
    { id: 'd_bottom', key: 'bottom', nameCn: '下装', nameEn: 'Bottom', sortOrder: 6, isMultiSelect: false, isEnabled: true },
  ]),
  dbGetAllModulesGrouped: vi.fn().mockResolvedValue({
    top: [
      { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: 'white shirt', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
      { id: 'm_top_2', dimensionId: 'd_top', contentEn: 'black jacket', displayName: 'black jacket', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
    ],
    bottom: [
      { id: 'm_bot_1', dimensionId: 'd_bottom', contentEn: 'pleated skirt', displayName: 'pleated skirt', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'bottom' },
    ],
  }),
  dbSaveAssemblyFromIr: vi.fn().mockResolvedValue('asm_1'),
  dbListRecent: vi.fn().mockResolvedValue([]),
  dbListFavorites: vi.fn().mockResolvedValue([]),
}))

import BatchFactory from '../BatchFactory.vue'
import { useBatchStore } from '@/stores/batch'
import { useImageQueueStore } from '@/stores/imageQueue'
import { useLibraryStore } from '@/stores/library'

function iqCalls(name: string): unknown[][] {
  return mockInvoke.mock.calls.filter((c) => c[0] === name)
}

/** 预置词库（跳过 fetchAll 时序竞态，确定性可测）。 */
function seedLibrary(): void {
  const lib = useLibraryStore()
  lib.dimensions = [
    { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true },
    { id: 'd_bottom', key: 'bottom', nameCn: '下装', nameEn: 'Bottom', sortOrder: 6, isMultiSelect: false, isEnabled: true },
  ]
  lib.modulesByDim = {
    top: [
      { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: 'white shirt', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
      { id: 'm_top_2', dimensionId: 'd_top', contentEn: 'black jacket', displayName: 'black jacket', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
    ],
    bottom: [
      { id: 'm_bot_1', dimensionId: 'd_bottom', contentEn: 'pleated skirt', displayName: 'pleated skirt', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'bottom' },
    ],
  }
}

function newPiniaWithSeed(): ReturnType<typeof createPinia> {
  const pinia = createPinia()
  setActivePinia(pinia)
  seedLibrary()
  return pinia
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === 'iq_enqueue') return Promise.resolve(['t1', 't2'])
    if (cmd === 'iq_start') return Promise.resolve(1)
    return Promise.reject(new Error(`no backend: ${cmd}`))
  })
})

async function clickRandom(pinia: ReturnType<typeof createPinia>) {
  setActivePinia(pinia)
  const w = mount(BatchFactory, { global: { plugins: [pinia] } })
  await w.vm.$nextTick()
  await w.find('[data-testid="batch-random-btn"]').trigger('click')
  await new Promise((r) => setTimeout(r, 60))
  await w.vm.$nextTick()
  return w
}

describe('点随机不再自动入队/启动', () => {
  it('loop 开 + 已设密钥 + 备料开关开 → 仍不调 iq_enqueue/iq_start', async () => {
    // 同一 pinia 实例：先预置词库+开关再 mount，组件内读到同一份 store
    const pinia = newPiniaWithSeed()
    const iq = useImageQueueStore()
    iq.config.loopEnabled = true
    iq.config.autoRandomOnStart = true
    iq.config.apiKeyState = 'set'
    await clickRandom(pinia)
    expect(iqCalls('iq_enqueue')).toHaveLength(0)
    expect(iqCalls('iq_start')).toHaveLength(0)
    // 随机主链路本身正常产出
    const batch = useBatchStore()
    expect(batch.results.length).toBeGreaterThan(0)
  })
})

describe('chip 只读 loopEnabled', () => {
  it('loopEnabled=true → chip 显示开', async () => {
    const pinia = newPiniaWithSeed()
    const iq = useImageQueueStore()
    iq.config.loopEnabled = true
    setActivePinia(pinia)
    const w = mount(BatchFactory, { global: { plugins: [pinia] } })
    await w.vm.$nextTick()
    expect(w.find('[data-testid="batch-loop-chip"]').text()).toContain('开')
  })
  it('loopEnabled=false → chip 显示关', async () => {
    const pinia = newPiniaWithSeed()
    const iq = useImageQueueStore()
    iq.config.loopEnabled = false
    setActivePinia(pinia)
    const w = mount(BatchFactory, { global: { plugins: [pinia] } })
    await w.vm.$nextTick()
    expect(w.find('[data-testid="batch-loop-chip"]').text()).toContain('关')
  })
})
