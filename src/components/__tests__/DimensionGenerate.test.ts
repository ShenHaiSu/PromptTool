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
    pose: [
      { id: 'm_pose_1', dimensionId: 'd_pose', contentEn: 'standing with hands in pockets', displayName: '插兜站立', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'pose' },
    ],
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
  dbBatchCreateModules: vi.fn().mockResolvedValue({
    totalRequested: 2, valid: 2, modulesCreated: 1, modulesUpdated: 0, modulesSkipped: 1,
    emptyIgnored: 0, duplicateInBatch: 0, truncated: 0, errors: [], warnings: [],
  }),
}))

vi.mock('@/lib/db', () => dbMocks)
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))

import DimensionPanel from '../DimensionPanel.vue'
import DimensionGenerateDialog from '../DimensionGenerateDialog.vue'

async function flush(wrapper: ReturnType<typeof mount>) {
  await new Promise((r) => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 30))
  await wrapper.vm.$nextTick()
}

const dimPose = { id: 'd_pose', key: 'pose', nameCn: '姿态', nameEn: 'Pose', sortOrder: 1, isMultiSelect: true, isEnabled: true } as any
const modsPose: Module[] = [
  { id: 'm_pose_1', dimensionId: 'd_pose', contentEn: 'standing with hands in pockets', displayName: '插兜站立', weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'pose' },
]

function mountDialog(modules: Module[] = modsPose) {
  return mount(DimensionGenerateDialog, {
    props: { open: true, dimension: dimPose, modules } as any,
    attachTo: document.body,
  })
}

describe('Need03 — 片段批量生成', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    localStorage.clear()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
  })

  it('1. 维度头右键菜单含第 4 项 dim-ctx-generate', async () => {
    const w = mount(DimensionPanel, { global: { plugins: [createPinia()] }, attachTo: document.body })
    await flush(w)
    await w.find('[data-testid="dimension-header-pose"]').trigger('contextmenu', { clientX: 100, clientY: 100 })
    await w.vm.$nextTick()
    const btn = document.body.querySelector('[data-testid="dim-ctx-generate-pose"]') as HTMLElement | null
    expect(btn).toBeTruthy()
    expect(btn?.textContent).toContain('片段批量生成')
    w.unmount()
  })

  it('2. 空维度点击可拉起 Dialog（与翻译禁用形成对照）', async () => {
    dbMocks.dbGetAllModulesGrouped.mockResolvedValueOnce({ pose: [], top: [] })
    const w = mount(DimensionPanel, { global: { plugins: [createPinia()] }, attachTo: document.body })
    await flush(w)
    await w.find('[data-testid="dimension-header-pose"]').trigger('contextmenu', { clientX: 10, clientY: 10 })
    await w.vm.$nextTick()
    const genBtn = document.body.querySelector('[data-testid="dim-ctx-generate-pose"]') as HTMLButtonElement | null
    expect(genBtn?.disabled).toBe(false)
    const transBtn = document.body.querySelector('[data-testid="dim-ctx-translate-pose"]') as HTMLButtonElement | null
    expect(transBtn?.disabled).toBe(true)
    genBtn?.click()
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 30))
    expect(document.body.querySelector('[data-testid="generate-dialog"]')).toBeTruthy()
    w.unmount()
  })

  it('3. 倾向为空时 generate-build-btn disabled + 提示', async () => {
    const w = mountDialog()
    await w.vm.$nextTick()
    const btn = w.find('[data-testid="generate-build-btn"]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    expect(w.text()).toContain('请先填写倾向')
    w.unmount()
  })

  it('4. 填写倾向后生成预览含 user_preference、维度 key、pmf-fragments 且不含 fence', async () => {
    const w = mountDialog()
    await w.vm.$nextTick()
    await w.find('[data-testid="generate-tendency"]').setValue('偏复古胶片感')
    await w.vm.$nextTick()
    await w.find('[data-testid="generate-build-btn"]').trigger('click')
    await w.vm.$nextTick()
    const preview = w.find('[data-testid="generate-prompt-preview"]')
    expect(preview.exists()).toBe(true)
    const text = preview.text()
    expect(text).toContain('<user_preference>')
    expect(text).toContain('偏复古胶片感')
    expect(text).toContain('pose')
    expect(text).toContain('pmf-fragments')
    expect(text).not.toContain('```')
    w.unmount()
  })

  it('5. 换一批改变示例区内容（种子变化）', async () => {
    const many: Module[] = Array.from({ length: 20 }, (_, i) => ({
      id: `m_pose_${i + 1}`, dimensionId: 'd_pose', contentEn: `pose fragment ${i + 1}`, displayName: `片段${i + 1}`,
      weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'pose',
    }))
    const w = mountDialog(many)
    await w.vm.$nextTick()
    await w.find('[data-testid="generate-tendency"]').setValue('街头风')
    await w.find('[data-testid="generate-build-btn"]').trigger('click')
    await w.vm.$nextTick()
    const before = w.find('[data-testid="generate-prompt-preview"]').text()
    await w.find('[data-testid="generate-reshuffle"]').trigger('click')
    await w.vm.$nextTick()
    const after = w.find('[data-testid="generate-prompt-preview"]').text()
    // 种子行必变（seed 显示在模板 §5 标题），示例大概率变；至少种子行变化
    expect(after).not.toBe(before)
    expect(after).toContain('种子')
    w.unmount()
  })

  it('6a. 粘贴含 fence JSON 可解析并跳 Step3', async () => {
    const w = mountDialog([])
    await w.vm.$nextTick()
    await w.findAll('button').find((b) => b.text().includes('②'))?.trigger('click')
    await w.vm.$nextTick()
    const body = JSON.stringify({
      format: 'pmf-fragments', formatVersion: 1, dimensionKey: 'pose', count: 2,
      items: [
        { contentEn: 'leaning against wall', displayName: '倚墙' },
        { contentEn: 'arms crossed', displayName: '抱臂' },
      ],
    })
    await w.find('[data-testid="generate-result-textarea"]').setValue(`前言\n\`\`\`json\n${body}\n\`\`\`\n后记`)
    await w.find('[data-testid="generate-parse-btn"]').trigger('click')
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 20))
    expect(w.find('[data-testid="generate-step-3"]').exists()).toBe(true)
    expect(w.find('[data-testid="generate-stats"]').text()).toContain('可入库 2')
    w.unmount()
  })

  it('6b. 纯行文本可解析', async () => {
    const w = mountDialog([])
    await w.vm.$nextTick()
    await w.findAll('button').find((b) => b.text().includes('②'))?.trigger('click')
    await w.vm.$nextTick()
    await w.find('[data-testid="generate-result-textarea"]').setValue('leaning against wall | 倚墙\narms crossed\n')
    await w.find('[data-testid="generate-parse-btn"]').trigger('click')
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 20))
    expect(w.find('[data-testid="generate-step-3"]').exists()).toBe(true)
    expect(w.find('[data-testid="generate-stats"]').text()).toContain('可入库 2')
    w.unmount()
  })

  it('7. 库内重复行默认不勾选且 pill 为黄；skip 入库后报告 modulesSkipped≥1', async () => {
    const w = mountDialog(modsPose)
    await w.vm.$nextTick()
    await w.findAll('button').find((b) => b.text().includes('②'))?.trigger('click')
    await w.vm.$nextTick()
    const body = JSON.stringify({
      format: 'pmf-fragments', formatVersion: 1, dimensionKey: 'pose',
      items: [
        { contentEn: 'Standing With Hands In Pockets', displayName: '重复' },
        { contentEn: 'brand new fragment xyz', displayName: '新' },
      ],
    })
    await w.find('[data-testid="generate-result-textarea"]').setValue(body)
    await w.find('[data-testid="generate-parse-btn"]').trigger('click')
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 20))
    const cb0 = w.find('[data-testid="generate-row-checkbox-0"]')
    expect((cb0.element as HTMLInputElement).checked).toBe(false)
    expect(w.find('[data-testid="generate-row-0"]').text()).toContain('库内重复')
    expect(w.find('[data-testid="generate-row-0"]').classes().join(' ')).toContain('amber')
    await w.find('[data-testid="generate-apply-btn"]').trigger('click')
    await new Promise((r) => setTimeout(r, 30))
    expect(dbMocks.dbBatchCreateModules).toHaveBeenCalled()
    const arg = (dbMocks.dbBatchCreateModules.mock.calls[0] as any)[0]
    expect(arg.dimId).toBe('d_pose')
    expect(arg.mode).toBe('skip')
    expect(w.find('[data-testid="generate-report"]').text()).toContain('跳过 1')
    w.unmount()
  })

  it('8. 三步步骤条可直接切换；Esc/外部点击关闭', async () => {
    const w = mount(DimensionPanel, { global: { plugins: [createPinia()] }, attachTo: document.body })
    await flush(w)
    // 菜单 Esc 关闭
    await w.find('[data-testid="dimension-header-pose"]').trigger('contextmenu', { clientX: 10, clientY: 10 })
    await w.vm.$nextTick()
    expect(document.body.querySelector('[data-testid="dim-context-menu"]')).toBeTruthy()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(document.body.querySelector('[data-testid="dim-context-menu"]')).toBeFalsy()
    // Dialog 步骤条切换
    await w.find('[data-testid="dimension-header-pose"]').trigger('contextmenu', { clientX: 10, clientY: 10 })
    await w.vm.$nextTick()
    ;(document.body.querySelector('[data-testid="dim-ctx-generate-pose"]') as HTMLElement)?.click()
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 30))
    const step3Btn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('③'))
    expect(step3Btn).toBeTruthy()
    ;(step3Btn as HTMLElement)?.click()
    await new Promise((r) => setTimeout(r, 20))
    expect(document.body.querySelector('[data-testid="generate-step-3"]')).toBeTruthy()
    w.unmount()
  })
})
