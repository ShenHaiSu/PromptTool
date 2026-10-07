import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/db', () => ({
  dbGetDimensions: vi.fn().mockResolvedValue([]),
  dbGetAllModulesGrouped: vi.fn().mockResolvedValue({}),
}))

import DimensionEditDialog from '../DimensionEditDialog.vue'
import ModuleEditDialog from '../ModuleEditDialog.vue'
import SaveDialog from '../SaveDialog.vue'
import RuleEditDialog from '../RuleEditDialog.vue'
import ModuleBatchDialog from '../ModuleBatchDialog.vue'
import DimensionTranslateDialog from '../DimensionTranslateDialog.vue'
import DimensionGenerateDialog from '../DimensionGenerateDialog.vue'
import DimensionMigrateDialog from '../DimensionMigrateDialog.vue'
import SegmentImportDialog from '../SegmentImportDialog.vue'
import LibraryDialog from '../LibraryDialog.vue'
import ImageTaskDetailDialog from '../ImageTaskDetailDialog.vue'
import StatsReportDialog from '../StatsReportDialog.vue'
import IrConflictEditorDialog from '../IrConflictEditorDialog.vue'
import { useImageTaskDialog } from '@/composables/useImageTaskDialog'
import { useStatsReport } from '@/composables/useStatsReport'

function mountAny(comp: unknown, props: Record<string, unknown> = {}) {
  setActivePinia(createPinia())
  return mount(comp as never, {
    props: { open: true, ...props } as never,
    global: { plugins: [createPinia()] },
    attachTo: document.body,
  })
}

/** 内按外松不应关闭；外-外应当关闭（need03 D2 内按外松回归矩阵） */
async function expectMatrix(w: ReturnType<typeof mount>, overlayTestId: string, innerSelector: string, isClosed: () => boolean): Promise<void> {
  const overlay = () => w.find(`[data-testid="${overlayTestId}"]`)
  expect(overlay().exists()).toBe(true)
  // 内-外
  await w.find(innerSelector).trigger('mousedown')
  await overlay().trigger('click')
  expect(isClosed()).toBe(false)
  // 外-外
  await overlay().trigger('mousedown')
  await overlay().trigger('click')
  expect(isClosed()).toBe(true)
}

describe('OverlayClose 回归矩阵（need03 D2）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('DimensionEditDialog', async () => {
     const w = mountAny(DimensionEditDialog, { mode: 'create' })
     // 注：jsdom 下 el-dialog 插槽内容 display:none 未渲染，用 EP 的 .el-overlay-dialog
     // 作为“内容区落点”验证 press/release 判定
     await expectMatrix(w, 'dimension-edit-dialog-overlay', '.el-overlay-dialog', () => (w.emitted('update:open')?.length ?? 0) > 0)
     w.unmount()
   })

  it('ModuleEditDialog', async () => {
    const w = mountAny(ModuleEditDialog, { mode: 'create', dimensions: [] })
     await expectMatrix(w, 'module-edit-dialog-overlay', '.el-overlay-dialog', () => (w.emitted('update:open')?.length ?? 0) > 0)
    w.unmount()
  })

  it('SaveDialog', async () => {
    const w = mountAny(SaveDialog, { mode: 'assembly' })
     await expectMatrix(w, 'save-dialog-overlay', '.el-overlay-dialog', () => (w.emitted('update:open')?.length ?? 0) > 0)
    w.unmount()
  })

  it('RuleEditDialog', async () => {
    const w = mountAny(RuleEditDialog, { mode: 'create' })
     await expectMatrix(w, 'rule-dialog', '.el-overlay-dialog', () => (w.emitted('update:open')?.length ?? 0) > 0)
    w.unmount()
  })

  it('ModuleBatchDialog', async () => {
    const w = mountAny(ModuleBatchDialog, { dimension: null })
    await expectMatrix(w, 'module-batch-dialog', '[data-testid="module-batch-close"]', () => (w.emitted('update:open')?.length ?? 0) > 0)
    w.unmount()
  })

  it('DimensionTranslateDialog', async () => {
    const w = mountAny(DimensionTranslateDialog, { dimension: null, modules: [] })
    await expectMatrix(w, 'translate-dialog', '[data-testid="translate-close"]', () => (w.emitted('update:open')?.length ?? 0) > 0)
    w.unmount()
  })

  it('DimensionGenerateDialog', async () => {
    const w = mountAny(DimensionGenerateDialog, { dimension: null, modules: [] })
    await expectMatrix(w, 'generate-dialog', '[data-testid="generate-close"]', () => (w.emitted('update:open')?.length ?? 0) > 0)
    w.unmount()
  })

  it('DimensionMigrateDialog（busy 时外-外也不关）', async () => {
    const w = mountAny(DimensionMigrateDialog, { dimension: null, count: 0, selectedCount: 0, busy: true })
    const overlay = () => w.find('[data-testid="migrate-dialog"]')
    await overlay().trigger('mousedown')
    await overlay().trigger('click')
    expect(w.emitted('update:open')).toBeUndefined()
     await (w.setProps as (p: Record<string, unknown>) => Promise<void>)({ busy: false })
    await overlay().trigger('mousedown')
    await overlay().trigger('click')
    expect(w.emitted('update:open')).toEqual([[false]])
    w.unmount()
  })

  it('SegmentImportDialog', async () => {
    const w = mountAny(SegmentImportDialog)
    await new Promise((r) => setTimeout(r, 0))
    await expectMatrix(w, 'segment-import-dialog', '[data-testid="segment-import-close"]', () => (w.emitted('update:open')?.length ?? 0) > 0)
    w.unmount()
  })

  it('LibraryDialog（close 事件）', async () => {
    const w = mountAny(LibraryDialog, {})
    w.findAll('div').length // touch render
    await expectMatrix(w, 'library-dialog', '[data-testid="library-close"]', () => (w.emitted('close')?.length ?? 0) > 0)
    w.unmount()
  })

   it('ImageTaskDetailDialog（store 开关，Teleport 内容落 body）', async () => {
     setActivePinia(createPinia())
     const dlg = useImageTaskDialog()
     dlg.opened.value = true
     const w = mount(ImageTaskDetailDialog, { global: { plugins: [createPinia()] }, attachTo: document.body })
     await w.vm.$nextTick()
     // Teleport 内容不在 wrapper 内，用原生事件直发（button 默认为 0 即左键）
     const overlayEl = () => document.body.querySelector('[data-testid="image-task-detail-dialog"]') as HTMLElement
     const innerEl = () => document.body.querySelector('[data-testid="image-task-detail-dialog"] .el-card') as HTMLElement
     expect(overlayEl()).toBeTruthy()
     expect(innerEl()).toBeTruthy()
     innerEl().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
     overlayEl().dispatchEvent(new MouseEvent('click', { bubbles: true }))
     expect(dlg.opened.value).toBe(true)
     overlayEl().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
     overlayEl().dispatchEvent(new MouseEvent('click', { bubbles: true }))
     expect(dlg.opened.value).toBe(false)
     w.unmount()
     dlg.opened.value = false
     document.body.innerHTML = ''
   })
 
   it('StatsReportDialog（store 开关，Esc 走既有监听）', async () => {
     setActivePinia(createPinia())
     const statsUi = useStatsReport()
     statsUi.open()
     const w = mount(StatsReportDialog, { global: { plugins: [createPinia()] }, attachTo: document.body })
     await new Promise((r) => setTimeout(r, 0))
     await w.vm.$nextTick()
     const overlayEl = () => document.body.querySelector('[data-testid="stats-report-dialog"]') as HTMLElement
     const innerEl = () => document.body.querySelector('[data-testid="stats-report-dialog"] .el-card') as HTMLElement
     expect(overlayEl()).toBeTruthy()
     expect(innerEl()).toBeTruthy()
     innerEl().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
     overlayEl().dispatchEvent(new MouseEvent('click', { bubbles: true }))
     expect(statsUi.showStatsReport.value).toBe(true)
     overlayEl().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
     overlayEl().dispatchEvent(new MouseEvent('click', { bubbles: true }))
     expect(statsUi.showStatsReport.value).toBe(false)
     w.unmount()
     document.body.innerHTML = ''
   })

  it('IrConflictEditorDialog', async () => {
    const w = mountAny(IrConflictEditorDialog, { ir: null })
    await new Promise((r) => setTimeout(r, 0))
    await expectMatrix(w, 'ir-editor-overlay', '[data-testid="ir-editor-close"]', () => (w.emitted('update:open')?.length ?? 0) > 0)
    w.unmount()
  })
})
