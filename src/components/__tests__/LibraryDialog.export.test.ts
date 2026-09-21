import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const dbMocks = vi.hoisted(() => ({
  dbExportLibrary: vi.fn().mockResolvedValue('{"format":"pmf-library"}'),
  dbImportLibraryText: vi.fn().mockResolvedValue({ dimensionsCreated: 0, dimensionsUpdated: 0, dimensionsSkipped: 0, modulesCreated: 0, modulesUpdated: 0, modulesSkipped: 0, rulesCreated: 0, rulesUpdated: 0, rulesSkipped: 0, tagsCreated: 0, tagsSkipped: 0, errors: [] }),
  dbPreviewLibraryText: vi.fn(),
  dbClearLocalData: vi.fn().mockResolvedValue(undefined),
  dbGetDimensions: vi.fn().mockResolvedValue([]),
  dbGetAllModulesGrouped: vi.fn().mockResolvedValue({}),
  LIBRARY_LARGE_EXPORT_BYTES: 50 * 1024 * 1024,
}))

vi.mock('@/lib/db', () => dbMocks)

import LibraryDialog from '../LibraryDialog.vue'

async function flush(w: ReturnType<typeof mount>) {
  await new Promise(r => setTimeout(r, 10))
  await w.vm.$nextTick()
  await new Promise(r => setTimeout(r, 10))
  await w.vm.$nextTick()
}

describe('LibraryDialog — 阶段三纯 Web 导出/导入', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    dbMocks.dbExportLibrary.mockResolvedValue('{"format":"pmf-library"}')
  })

  it('导出区：纯 Blob 下载，无目录选择/落盘 UI', async () => {
    const w = mount(LibraryDialog, { props: {} })
    await flush(w)
    expect(w.find('[data-testid="library-export-section"]').exists()).toBe(true)
    expect(w.find('[data-testid="library-export-btn"]').exists()).toBe(true)
    // 阶段三已删除目录/落盘/打开文件夹 UI
    expect(w.find('[data-testid="library-export-dir"]').exists()).toBe(false)
    expect(w.find('[data-testid="library-export-pick-dir"]').exists()).toBe(false)
    expect(w.find('[data-testid="library-export-result"]').exists()).toBe(false)
    expect(w.find('[data-testid="library-export-open-dir"]').exists()).toBe(false)
    w.unmount()
  })

  it('点击导出调用 dbExportLibrary 并触发浏览器下载', async () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((n: any) => n)
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((n: any) => n)
    const w = mount(LibraryDialog, { props: {} })
    await flush(w)
    await w.find('[data-testid="library-export-btn"]').trigger('click')
    await flush(w)
    expect(dbMocks.dbExportLibrary).toHaveBeenCalledTimes(1)
    expect(appendSpy).toHaveBeenCalled()
    expect(removeSpy).toHaveBeenCalled()
    appendSpy.mockRestore()
    removeSpy.mockRestore()
    w.unmount()
  })

  it('导入区：input[file] + 旧库迁移文案', async () => {
    const w = mount(LibraryDialog, { props: {} })
    await flush(w)
    expect(w.find('[data-testid="library-import-section"]').exists()).toBe(true)
    expect(w.find('[data-testid="library-file-input"]').exists()).toBe(true)
    expect(w.text()).toMatch('旧数据迁移')
    w.unmount()
  })
})
