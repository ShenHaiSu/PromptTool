import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const dbMocks = vi.hoisted(() => ({
  dbGetDimensions: vi.fn().mockResolvedValue([
    { id: 'd_pose', key: 'pose', nameCn: '姿态', nameEn: 'Pose', sortOrder: 1, isMultiSelect: true, isEnabled: true, icon: null },
    { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 2, isMultiSelect: false, isEnabled: true, icon: null },
  ]),
  dbGetAllModulesGrouped: vi.fn().mockResolvedValue({ pose: [], top: [] }),
  dbUpdateDimension: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/db', () => dbMocks)
vi.mock('@/lib/db/dimensions', () => ({ dbUpdateDimension: dbMocks.dbUpdateDimension }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))

import DimensionPanel from '../DimensionPanel.vue'

function mountPanel() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(DimensionPanel, { global: { plugins: [pinia] }, attachTo: document.body })
}

async function flush(wrapper: ReturnType<typeof mount>) {
  await new Promise((r) => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 30))
  await wrapper.vm.$nextTick()
}

describe('need03 D1 — 维度排序双入口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    localStorage.clear()
  })

  it('工具栏通用按钮打开排序 Dialog，列出全量维度', async () => {
    const w = mountPanel()
    await flush(w)
    const btn = w.find('[data-testid="dimension-order-btn"]')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    await w.vm.$nextTick()
     const overlay = w.find('[data-testid="dimension-order-overlay"]')
     expect(overlay.exists()).toBe(true)
     expect(overlay.findAll('[data-testid="dimension-order-row"]').length).toBe(2)
    w.unmount()
  })

  it('右键菜单“维度排序…”打开同一 Dialog', async () => {
    const w = mountPanel()
    await flush(w)
    await w.find('[data-testid="dimension-header-pose"]').trigger('contextmenu', { clientX: 100, clientY: 100 })
    await w.vm.$nextTick()
    const entry = document.body.querySelector('[data-testid="dim-ctx-order-pose"]') as HTMLElement
    expect(entry).toBeTruthy()
    entry.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await w.vm.$nextTick()
    await flush(w)
    expect(w.find('[data-testid="dimension-order-overlay"]').exists()).toBe(true)
    w.unmount()
  })
})
