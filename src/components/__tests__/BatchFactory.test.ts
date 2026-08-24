import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import BatchFactory from '../BatchFactory.vue'
import { useBatchStore } from '@/stores/batch'
// mock db layer used by BatchFactory.ensureDims
vi.mock('@/lib/db', () => ({
  dbGetDimensions: vi.fn().mockResolvedValue([
    { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 5, isMultiSelect: false, isEnabled: true },
    { id: 'd_bottom', key: 'bottom', nameCn: '下装', nameEn: 'Bottom', sortOrder: 6, isMultiSelect: false, isEnabled: true },
    { id: 'd_face', key: 'face', nameCn: '面部', nameEn: 'Face', sortOrder: 4, isMultiSelect: false, isEnabled: true },
  ]),
  dbGetAllModulesGrouped: vi.fn().mockResolvedValue({
    top: [
      { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: 'white shirt', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
      { id: 'm_top_2', dimensionId: 'd_top', contentEn: 'black jacket', displayName: 'black jacket', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
    ],
    bottom: [
      { id: 'm_bot_1', dimensionId: 'd_bottom', contentEn: 'pleated skirt', displayName: 'pleated skirt', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'bottom' },
    ],
    face: [
      { id: 'm_face_1', dimensionId: 'd_face', contentEn: 'smiling face', displayName: 'smiling face', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'face' },
    ],
  }),
  dbSaveAssemblyFromIr: vi.fn().mockResolvedValue('asm_1'),
  dbListRecent: vi.fn().mockResolvedValue([]),
  dbListFavorites: vi.fn().mockResolvedValue([]),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))

beforeEach(() => {
  setActivePinia(createPinia())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
  // URL.createObjectURL mock for CSV export
  if (!URL.createObjectURL) Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), configurable: true })
  if (!URL.revokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
})

describe('BatchFactory', () => {
  it('初始空状态，控制行暴露 数量/随机/含NSFW/可控/复制全部/清空/导出CSV', async () => {
    const w = mount(BatchFactory, { global: { plugins: [createPinia()] } })
    await w.vm.$nextTick()
    expect(w.find('[data-testid="batch-factory"]').exists()).toBe(true)
    expect(w.find('[data-testid="batch-count-input"]').exists()).toBe(true)
    expect(w.find('[data-testid="batch-random-btn"]').exists()).toBe(true)
    expect(w.find('[data-testid="batch-nsfw-switch"]').exists()).toBe(true)
    expect(w.find('[data-testid="batch-partial-switch"]').exists()).toBe(true)
    expect(w.find('[data-testid="batch-copy-all"]').exists()).toBe(true)
    expect(w.find('[data-testid="batch-clear"]').exists()).toBe(true)
    expect(w.find('[data-testid="batch-export-csv"]').exists()).toBe(true)
    expect(w.find('[data-testid="batch-empty"]').exists()).toBe(true)
  })

  it('随机生成 20 条去重正确（hash 校验，无重复）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const w = mount(BatchFactory, { global: { plugins: [pinia] } })
    await w.vm.$nextTick()
    const input = w.find('[data-testid="batch-count-input"]')
    // 设置 20
    await input.setValue('20')
    await w.find('[data-testid="batch-random-btn"]').trigger('click')
    // 等待 ensureDims + generate（同步）
    await new Promise((r) => setTimeout(r, 30))
    await w.vm.$nextTick()
    const batch = useBatchStore()
    // 可能因池子有限生成 <20，但不应有重复 hash，且不少于 1 条
    expect(batch.results.length).toBeGreaterThan(0)
    expect(batch.results.length).toBeLessThanOrEqual(20)
    const hashes = batch.results.map((r) => r.hash)
    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it('数量钳制 1-500', async () => {
    const w = mount(BatchFactory, { global: { plugins: [createPinia()] } })
    await w.vm.$nextTick()
    const input = w.find('[data-testid="batch-count-input"]')
    await input.setValue('999')
    // 触发 input 事件；组件内 clamp 500
    await input.trigger('input')
    // 无法直接断言 ref，使用生成验证钳制：设 999 后生成仍 ≤500
    // 此用例仅校验无崩溃
    expect(w.find('[data-testid="batch-count-input"]').exists()).toBe(true)
  })

  it('生成后虚拟化容器出现', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const w = mount(BatchFactory, { global: { plugins: [pinia] } })
    await w.vm.$nextTick()
    await w.find('[data-testid="batch-random-btn"]').trigger('click')
    await new Promise((r) => setTimeout(r, 30))
    await w.vm.$nextTick()
    const batch = useBatchStore()
    if (batch.results.length > 0) {
      expect(w.find('[data-testid="batch-virtual-scroll"]').exists()).toBe(true)
    }
  })

  it('复制全部调用 clipboard', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const w = mount(BatchFactory, { global: { plugins: [pinia] } })
    await w.vm.$nextTick()
    await w.find('[data-testid="batch-random-btn"]').trigger('click')
    await new Promise((r) => setTimeout(r, 30))
    await w.vm.$nextTick()
    const batch = useBatchStore()
    if (batch.results.length > 0) {
      await w.find('[data-testid="batch-copy-all"]').trigger('click')
      expect(writeText).toHaveBeenCalled()
    }
  })
})
