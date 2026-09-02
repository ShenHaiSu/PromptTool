import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { Module } from '@/engine/models'

const dbMocks = vi.hoisted(() => ({
  dbGetDimensions: vi.fn().mockResolvedValue([
    { id: 'd_pose', key: 'pose', nameCn: '姿态', nameEn: 'Pose', sortOrder: 1, isMultiSelect: true, isEnabled: true, icon: null },
    { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 2, isMultiSelect: false, isEnabled: true, icon: null },
  ]),
  dbGetAllModulesGrouped: vi.fn().mockResolvedValue({
    pose: Array.from({ length: 65 }, (_, i) => ({
      id: `m_pose_${i + 1}`,
      dimensionId: 'd_pose',
      contentEn: `pose content ${i + 1}`,
      displayName: `pose content ${i + 1}`.slice(0, 20),
      weight: 1,
      isEnabled: true,
      isNsfw: false,
      usageCount: 0,
      dimensionKey: 'pose',
    })),
    top: [
      { id: 'm_top_1', dimensionId: 'd_top', contentEn: 'white shirt', displayName: '白衬衫', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top' },
    ],
  }),
  dbCreateDimension: vi.fn().mockResolvedValue({ id: 'd_new', key: 'new_dim', nameCn: '新维度', nameEn: 'New', sortOrder: 0, isMultiSelect: false, isEnabled: true }),
  dbUpdateDimension: vi.fn().mockResolvedValue(undefined),
  dbCreateModule: vi.fn().mockResolvedValue({ id: 'm_new', dimensionId: 'd_pose', contentEn: 'new', displayName: '新', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0 }),
  dbUpdateModule: vi.fn().mockResolvedValue(undefined),
  dbSoftDeleteModule: vi.fn().mockResolvedValue(undefined),
  dbBatchUpdateDisplayNames: vi.fn().mockResolvedValue({ totalRequested: 1, updated: 1, skipped: 0, warnings: [], errors: [] }),
}))

vi.mock('@/lib/db', () => dbMocks)
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))

import DimensionPanel from '../DimensionPanel.vue'
import DimensionTranslateDialog from '../DimensionTranslateDialog.vue'

async function flush(wrapper: ReturnType<typeof mount>) {
  await new Promise((r) => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 30))
  await wrapper.vm.$nextTick()
}

describe('Need01 — 维度批量翻译', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    localStorage.clear()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
  })

  it('右键维度头出现菜单，首项批量翻译可点击', async () => {
    const w = mount(DimensionPanel, { global: { plugins: [createPinia()] }, attachTo: document.body })
    await flush(w)
    const header = w.find('[data-testid="dimension-header-pose"]')
    expect(header.exists()).toBe(true)
    await header.trigger('contextmenu', { clientX: 100, clientY: 100 })
    await w.vm.$nextTick()
    const menu = document.body.querySelector('[data-testid="dim-context-menu"]')
    expect(menu).toBeTruthy()
    const trans = document.body.querySelector('[data-testid="dim-ctx-translate-pose"]') as HTMLElement | null
    expect(trans).toBeTruthy()
    expect(trans?.textContent).toContain('批量翻译')
    w.unmount()
  })

  it('空维度首项 disabled', async () => {
    dbMocks.dbGetAllModulesGrouped.mockResolvedValueOnce({ pose: [], top: [] })
    const w = mount(DimensionPanel, { global: { plugins: [createPinia()] }, attachTo: document.body })
    await flush(w)
    await w.find('[data-testid="dimension-header-pose"]').trigger('contextmenu', { clientX: 10, clientY: 10 })
    await w.vm.$nextTick()
    const btn = document.body.querySelector('[data-testid="dim-ctx-translate-pose"]') as HTMLButtonElement | null
    expect(btn?.disabled).toBe(true)
    expect(btn?.title).toContain('暂无词条')
    w.unmount()
  })

  it('点击批量翻译打开对话框', async () => {
    const w = mount(DimensionPanel, { global: { plugins: [createPinia()] }, attachTo: document.body })
    await flush(w)
    await w.find('[data-testid="dimension-header-pose"]').trigger('contextmenu', { clientX: 10, clientY: 10 })
    await w.vm.$nextTick()
    ;(document.body.querySelector('[data-testid="dim-ctx-translate-pose"]') as HTMLElement)?.click()
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 30))
    expect(document.body.querySelector('[data-testid="translate-dialog"]')).toBeTruthy()
    w.unmount()
  })

  it('Escape 关闭菜单', async () => {
    const w = mount(DimensionPanel, { global: { plugins: [createPinia()] }, attachTo: document.body })
    await flush(w)
    await w.find('[data-testid="dimension-header-pose"]').trigger('contextmenu', { clientX: 10, clientY: 10 })
    await w.vm.$nextTick()
    expect(document.body.querySelector('[data-testid="dim-context-menu"]')).toBeTruthy()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(document.body.querySelector('[data-testid="dim-context-menu"]')).toBeFalsy()
    w.unmount()
  })

  it('DimensionTranslateDialog 三步：分片 65 条 30/片 → 3 片，切 50 即时重算', async () => {
    const mods: Module[] = Array.from({ length: 65 }, (_, i) => ({
      id: `m_pose_${i + 1}`, dimensionId: 'd_pose', contentEn: `pose content ${i + 1}`, displayName: `pose content ${i + 1}`, weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'pose',
    }))
    const dim = { id: 'd_pose', key: 'pose', nameCn: '姿态', nameEn: 'Pose', sortOrder: 1, isMultiSelect: true, isEnabled: true } as any
    const w = mount(DimensionTranslateDialog, { props: { open: true, dimension: dim, modules: mods } as any, attachTo: document.body })
    await w.vm.$nextTick()
    expect(w.find('[data-testid="translate-step-1"]').exists()).toBe(true)
    expect(w.find('[data-testid="translate-copy-all"]').text()).toContain('3 片')
    const sel = w.find('[data-testid="translate-chunk-size"]')
    // switch to 50
    await sel.setValue('50')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="translate-copy-all"]').text()).toContain('2 片')
    w.unmount()
  })

  it('粘贴多片 JSON → 解析并预览 → 过滤与选择 → 应用回填触发 dbBatchUpdateDisplayNames', async () => {
    const mods: Module[] = [
      { id: 'm1', dimensionId: 'd_pose', contentEn: 'standing', displayName: 'standing', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'pose' },
      { id: 'm2', dimensionId: 'd_pose', contentEn: 'sitting', displayName: 'sitting', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'pose' },
      { id: 'm3', dimensionId: 'd_pose', contentEn: 'walking', displayName: 'walking', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'pose' },
    ]
    const dim = { id: 'd_pose', key: 'pose', nameCn: '姿态', nameEn: 'Pose', sortOrder: 1, isMultiSelect: true, isEnabled: true } as any
    const w = mount(DimensionTranslateDialog, { props: { open: true, dimension: dim, modules: mods } as any, attachTo: document.body })
    await w.vm.$nextTick()
    // Switch to step2 then locate textarea
    const toStep2 = w.findAll('button').find(b => b.text().includes('②'))
    if (toStep2) await toStep2.trigger('click')
    await w.vm.$nextTick()
    let textarea = w.find('[data-testid="translate-result-textarea"]')
    if (!textarea.exists()) {
      // fallback: ensure activeStep 2 visible — force via prop? just wait
      await new Promise((r) => setTimeout(r, 10))
      textarea = w.find('[data-testid="translate-result-textarea"]')
    }
    const j1 = JSON.stringify({ format: 'pmf-translation', formatVersion: 1, dimensionKey: 'pose', chunkId: 'c01', items: [{ id: 'm1', zh: '站立' }, { id: 'm2', zh: '坐着' }] })
    const j2 = '```json\n' + JSON.stringify({ format: 'pmf-translation', formatVersion: 1, dimensionKey: 'pose', chunkId: 'c02', items: [{ id: 'm3', zh: '行走' }] }) + '\n```'
    await textarea.setValue(`${j1}\n\n${j2}`)
    await w.find('[data-testid="translate-parse-btn"]').trigger('click')
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 20))
    expect(w.find('[data-testid="translate-stats"]').text()).toContain('命中 3')
    expect(w.find('[data-testid="translate-preview"]').exists()).toBe(true)
    // Apply
    await w.find('[data-testid="translate-apply-btn"]').trigger('click')
    await new Promise((r) => setTimeout(r, 30))
    expect(dbMocks.dbBatchUpdateDisplayNames).toHaveBeenCalled()
    const arg = (dbMocks.dbBatchUpdateDisplayNames.mock.calls[0] as any)[0]
    expect(arg.dimensionId).toBe('d_pose')
    expect(arg.items.length).toBe(3)
    w.unmount()
  })

  it('复制本片与复制全部调 clipboard', async () => {
    const mods: Module[] = [
      { id: 'm1', dimensionId: 'd_pose', contentEn: 'a', displayName: 'a', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'pose' },
    ]
    const dim = { id: 'd_pose', key: 'pose', nameCn: '姿态', nameEn: 'Pose', sortOrder: 1, isMultiSelect: true, isEnabled: true } as any
    const w = mount(DimensionTranslateDialog, { props: { open: true, dimension: dim, modules: mods } as any, attachTo: document.body })
    await w.vm.$nextTick()
    const spy = vi.spyOn(navigator.clipboard, 'writeText')
    await w.find('[data-testid="translate-copy-chunk-c01"]').trigger('click')
    await new Promise((r) => setTimeout(r, 10))
    expect(spy).toHaveBeenCalled()
    await w.find('[data-testid="translate-copy-all"]').trigger('click')
    await new Promise((r) => setTimeout(r, 10))
    expect(spy).toHaveBeenCalledTimes(2)
    w.unmount()
  })

  it('非本维度 id 在预览中置灰且默认不勾选', async () => {
    const mods: Module[] = [
      { id: 'm1', dimensionId: 'd_pose', contentEn: 'standing', displayName: 'standing', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'pose' },
    ]
    const dim = { id: 'd_pose', key: 'pose', nameCn: '姿态', nameEn: 'Pose', sortOrder: 1, isMultiSelect: true, isEnabled: true } as any
    const w = mount(DimensionTranslateDialog, { props: { open: true, dimension: dim, modules: mods } as any, attachTo: document.body })
    await w.vm.$nextTick()
    await w.findAll('button').find(b => b.text().includes('②'))?.trigger('click')
    await w.vm.$nextTick()
    const j = JSON.stringify({ format: 'pmf-translation', formatVersion: 1, dimensionKey: 'pose', chunkId: 'c01', items: [{ id: 'm1', zh: '站立' }, { id: 'm_unknown', zh: '未知' }] })
    await w.find('[data-testid="translate-result-textarea"]').setValue(j)
    await w.find('[data-testid="translate-parse-btn"]').trigger('click')
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 20))
    const rowUnknown = w.find('[data-testid="translate-row-m_unknown"]')
    expect(rowUnknown.exists()).toBe(true)
    const cb = w.find('[data-testid="translate-row-checkbox-m_unknown"]') as any
    expect((cb.element as HTMLInputElement).checked).toBe(false)
    expect(rowUnknown.text()).toContain('非本维度')
    w.unmount()
  })
})
