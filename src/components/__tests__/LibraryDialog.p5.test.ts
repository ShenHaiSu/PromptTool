import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const dbMocks = vi.hoisted(() => ({
  dbExportLibrary: vi.fn().mockResolvedValue('{"format":"pmf-library"}'),
  dbPreviewLibraryText: vi.fn().mockResolvedValue({
    dimensionsCreated: 1, dimensionsUpdated: 0, dimensionsSkipped: 2,
    modulesCreated: 3, modulesUpdated: 0, modulesSkipped: 4,
    rulesCreated: 0, rulesUpdated: 0, rulesSkipped: 0,
    tagsCreated: 0, tagsSkipped: 0, errors: [],
    templatesCreated: 0, templatesUpdated: 0, templatesSkipped: 0,
    assembliesCreated: 0, assembliesSkipped: 0,
    moduleTagsCreated: 0, moduleTagsSkipped: 0,
  }),
  dbImportLibraryText: vi.fn().mockResolvedValue({
    dimensionsCreated: 1, dimensionsUpdated: 0, dimensionsSkipped: 2,
    modulesCreated: 3, modulesUpdated: 0, modulesSkipped: 4,
    rulesCreated: 0, rulesUpdated: 0, rulesSkipped: 0,
    tagsCreated: 0, tagsSkipped: 0, errors: [],
  }),
  dbClearLocalData: vi.fn().mockResolvedValue(undefined),
  dbGetDimensions: vi.fn().mockResolvedValue([]),
  dbGetAllModulesGrouped: vi.fn().mockResolvedValue({}),
  LIBRARY_LARGE_EXPORT_BYTES: 50 * 1024 * 1024,
}))

vi.mock('@/lib/db', () => dbMocks)
vi.mock('@/lib/export', () => ({
  buildLibraryCsvText: vi.fn().mockReturnValue('﻿a,b\n'),
  exportLibraryCsv: vi.fn(),
}))

import LibraryDialog from '../LibraryDialog.vue'

async function flush(w: ReturnType<typeof mount>) {
  await new Promise(r => setTimeout(r, 10))
  await w.vm.$nextTick()
  await new Promise(r => setTimeout(r, 10))
  await w.vm.$nextTick()
}

function fileInputOf(w: ReturnType<typeof mount>): HTMLInputElement {
  return w.find('[data-testid="library-file-input"]').element as HTMLInputElement
}

describe('LibraryDialog — 阶段五导入导出与隐私', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('选择文件后先预览计数，确认后才写库', async () => {
    const w = mount(LibraryDialog, { props: {} })
    await flush(w)
    const file = new File(['{"format":"pmf-library","version":1}'], 'lib.json', { type: 'application/json' })
    Object.defineProperty(fileInputOf(w), 'files', { value: [file], configurable: true })
    await w.find('[data-testid="library-file-input"]').trigger('change')
    await flush(w)
    // 预览出现，尚未调用真正导入
    expect(w.find('[data-testid="library-import-preview"]').exists()).toBe(true)
    expect(w.find('[data-testid="library-preview-dims"]').text()).toContain('新增 1')
    expect(dbMocks.dbPreviewLibraryText).toHaveBeenCalledTimes(1)
    expect(dbMocks.dbImportLibraryText).not.toHaveBeenCalled()
    // 二次确认后写库并出结果
    await w.find('[data-testid="library-import-confirm"]').trigger('click')
    await flush(w)
    expect(dbMocks.dbImportLibraryText).toHaveBeenCalledTimes(1)
    expect(w.find('[data-testid="library-report"]').exists()).toBe(true)
    expect(w.emitted('imported')).toBeTruthy()
    w.unmount()
  })

  it('取消预览不写库', async () => {
    const w = mount(LibraryDialog, { props: {} })
    await flush(w)
    const file = new File(['{}'], 'lib.json', { type: 'application/json' })
    Object.defineProperty(fileInputOf(w), 'files', { value: [file], configurable: true })
    await w.find('[data-testid="library-file-input"]').trigger('change')
    await flush(w)
    expect(w.find('[data-testid="library-import-preview"]').exists()).toBe(true)
    await w.find('[data-testid="library-import-cancel"]').trigger('click')
    await flush(w)
    expect(w.find('[data-testid="library-import-preview"]').exists()).toBe(false)
    expect(dbMocks.dbImportLibraryText).not.toHaveBeenCalled()
    w.unmount()
  })

  it('导出区有 JSON/CSV 与完整备份选项，隐私文案固定', async () => {
    const w = mount(LibraryDialog, { props: {} })
    await flush(w)
    expect(w.find('[data-testid="library-export-btn"]').exists()).toBe(true)
    expect(w.find('[data-testid="library-export-csv-btn"]').exists()).toBe(true)
    expect(w.find('[data-testid="library-export-full-backup"]').exists()).toBe(true)
    expect(w.find('[data-testid="library-privacy"]').text()).toContain('IndexedDB')
    expect(w.find('[data-testid="library-privacy"]').text()).toContain('请定期导出备份')
    w.unmount()
  })

  it('清空需二次确认，确认后调用 dbClearLocalData', async () => {
    const w = mount(LibraryDialog, { props: {} })
    await flush(w)
    expect(w.find('[data-testid="library-clear-confirm"]').exists()).toBe(false)
    await w.find('[data-testid="library-clear-btn"]').trigger('click')
    await flush(w)
    expect(w.find('[data-testid="library-clear-confirm"]').exists()).toBe(true)
    await w.find('[data-testid="library-clear-confirm"]').trigger('click')
    await flush(w)
    expect(dbMocks.dbClearLocalData).toHaveBeenCalledTimes(1)
    w.unmount()
  })
})
