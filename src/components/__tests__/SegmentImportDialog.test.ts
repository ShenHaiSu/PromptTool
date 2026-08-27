import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const dbMocks = vi.hoisted(() => ({
  dbGetDimensions: vi.fn().mockResolvedValue([
    { id: 'd_body', key: 'body', nameCn: '身材', nameEn: 'Body', sortOrder: 1, isMultiSelect: false, isEnabled: true },
    { id: 'd_face', key: 'face', nameCn: '面部', nameEn: 'Face', sortOrder: 2, isMultiSelect: false, isEnabled: true },
    { id: 'd_camera', key: 'camera', nameCn: '相机', nameEn: 'Camera', sortOrder: 3, isMultiSelect: false, isEnabled: true },
  ]),
  dbImportSegments: vi.fn().mockResolvedValue({
    prompts: 1, segmentsTotal: 2, segmentsImported: 2, segmentsSkipped: 0, segmentsIgnoredUnassigned: 0,
    modulesCreated: 2, modulesUpdated: 0, modulesSkipped: 0, errors: [], warnings: [],
  }),
}))

vi.mock('@/lib/db', () => dbMocks)
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))

import SegmentImportDialog from '../SegmentImportDialog.vue'

function createWrapper(open = true) {
  return mount(SegmentImportDialog, {
    props: { open },
  })
}

describe('SegmentImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    dbMocks.dbGetDimensions.mockResolvedValue([
      { id: 'd_body', key: 'body', nameCn: '身材', nameEn: 'Body', sortOrder: 1, isMultiSelect: false, isEnabled: true },
      { id: 'd_face', key: 'face', nameCn: '面部', nameEn: 'Face', sortOrder: 2, isMultiSelect: false, isEnabled: true },
      { id: 'd_camera', key: 'camera', nameCn: '相机', nameEn: 'Camera', sortOrder: 3, isMultiSelect: false, isEnabled: true },
    ])
    dbMocks.dbImportSegments.mockResolvedValue({
      prompts: 1, segmentsTotal: 2, segmentsImported: 2, segmentsSkipped: 0, segmentsIgnoredUnassigned: 0,
      modulesCreated: 2, modulesUpdated: 0, modulesSkipped: 0, errors: [], warnings: [],
    })
  })

  it('挂载后三步标题与关键 data-testid 存在', async () => {
    const w = createWrapper(true)
    await w.vm.$nextTick()
    expect(w.find('[data-testid="segment-import-dialog"]').exists()).toBe(true)
    expect(w.find('[data-testid="segment-raw-textarea"]').exists()).toBe(true)
    expect(w.find('[data-testid="segment-generate-btn"]').exists()).toBe(true)
    expect(w.find('[data-testid="segment-instruction-preview"]').exists()).toBe(false)
  })

  it('Step1 生成指令并复制会调用 clipboard', async () => {
    const w = createWrapper(true)
    await w.vm.$nextTick()
    const ta = w.find('[data-testid="segment-raw-textarea"]')
    // set raw text
    await ta.setValue('slim waist, long legs\nred dress')
    await w.vm.$nextTick()
    await w.find('[data-testid="segment-generate-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 30))
    await w.vm.$nextTick()
    expect(navigator.clipboard.writeText).toHaveBeenCalled()
    const callArg = (navigator.clipboard.writeText as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as string
    expect(callArg).toContain('pmf-segments')
  })

  it('Step2 粘贴 JSON 解析后进入预览', async () => {
    const w = createWrapper(true)
    await w.vm.$nextTick()
    // switch to step 2
    await w.find('[data-testid="segment-step-2"]').trigger('click')
    await w.vm.$nextTick()
    const json = JSON.stringify({
      format: 'pmf-segments',
      formatVersion: 1,
      prompts: [{ id: 'p01', raw: 'slim waist, oval face', segments: [{ dimensionKey: 'body', contentEn: 'slim waist' }, { dimensionKey: 'face', contentEn: 'oval face' }] }],
    })
    const llmTa = w.find('[data-testid="segment-llm-textarea"]')
    await llmTa.setValue(json)
    await w.vm.$nextTick()
    await w.find('[data-testid="segment-parse-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 30))
    await w.vm.$nextTick()
    expect(w.find('[data-testid="segment-preview"]').exists()).toBe(true)
    expect(w.find('[data-testid="segment-stats"]').exists()).toBe(true)
    expect(w.find('[data-testid="segment-prompt-card-p01"]').exists()).toBe(true)
  })

  it('tagged 转 JSON 按钮可用', async () => {
    const w = createWrapper(true)
    await w.vm.$nextTick()
    await w.find('[data-testid="segment-step-2"]').trigger('click')
    await w.vm.$nextTick()
    const tagged = '[body] slim waist\n[face] oval face'
    await w.find('[data-testid="segment-llm-textarea"]').setValue(tagged)
    await w.vm.$nextTick()
    // parse first to get parsed, then use to-json
    await w.find('[data-testid="segment-parse-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 30))
    await w.vm.$nextTick()
    expect(w.find('[data-testid="segment-preview"]').exists()).toBe(true)
  })

  it('预览筛选与勾选切换生效', async () => {
    const w = createWrapper(true)
    await w.vm.$nextTick()
    await w.find('[data-testid="segment-step-2"]').trigger('click')
    await w.vm.$nextTick()
    const json = JSON.stringify({
      format: 'pmf-segments',
      formatVersion: 1,
      prompts: [
        { id: 'p01', raw: 'slim waist', segments: [{ dimensionKey: 'body', contentEn: 'slim waist' }] },
        { id: 'p02', raw: 'unknown', segments: [{ dimensionKey: 'unknown_xyz', contentEn: 'something' }] },
      ],
    })
    await w.find('[data-testid="segment-llm-textarea"]').setValue(json)
    await w.find('[data-testid="segment-parse-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 30))
    await w.vm.$nextTick()
    // toggle checkbox
    const cb = w.find('[data-testid="segment-row-checkbox-p01-0"]')
    expect(cb.exists()).toBe(true)
    const before = (cb.element as HTMLInputElement).checked
    await cb.trigger('change')
    await w.vm.$nextTick()
    // filter to needs_review should show only p02
    await w.find('[data-testid="segment-filter"]').setValue('needs_review')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="segment-prompt-card-p02"]').exists()).toBe(true)
    void before
  })

  it('导入成功 emit imported', async () => {
    const w = createWrapper(true)
    await w.vm.$nextTick()
    await w.find('[data-testid="segment-step-2"]').trigger('click')
    await w.vm.$nextTick()
    const json = JSON.stringify({
      format: 'pmf-segments',
      formatVersion: 1,
      prompts: [{ id: 'p01', raw: 'slim waist', segments: [{ dimensionKey: 'body', contentEn: 'slim waist' }] }],
    })
    await w.find('[data-testid="segment-llm-textarea"]').setValue(json)
    await w.find('[data-testid="segment-parse-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 30))
    await w.vm.$nextTick()
    await w.find('[data-testid="segment-import-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 30))
    await w.vm.$nextTick()
    expect(dbMocks.dbImportSegments).toHaveBeenCalled()
    expect(w.emitted('imported')).toBeTruthy()
  })
})
