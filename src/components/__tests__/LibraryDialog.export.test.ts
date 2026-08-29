import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const dbMocks = vi.hoisted(() => ({
  dbExportLibrary: vi.fn().mockResolvedValue('{"format":"pmf-library"}'),
  dbExportLibraryToDir: vi.fn().mockResolvedValue({ path: 'E:/app/data/output/pmf-library-20260829-153022.json', json: '{}', filename: 'pmf-library-20260829-153022.json' }),
  dbGetDefaultExportDir: vi.fn().mockResolvedValue('E:/app/data/output'),
  dbImportLibraryText: vi.fn().mockResolvedValue({ dimensionsCreated: 0, dimensionsUpdated: 0, dimensionsSkipped: 0, modulesCreated: 0, modulesUpdated: 0, modulesSkipped: 0, rulesCreated: 0, rulesUpdated: 0, rulesSkipped: 0, tagsCreated: 0, tagsSkipped: 0, errors: [] }),
  dbRevealInExplorer: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/db', () => dbMocks)
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

// Mock @tauri-apps/plugin-dialog and plugin-opener via dynamic import path used in component
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn().mockResolvedValue(null) }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn().mockResolvedValue(undefined), open: vi.fn().mockResolvedValue(undefined) }))

import LibraryDialog from '../LibraryDialog.vue'

async function flush(w: ReturnType<typeof mount>) {
  await new Promise(r => setTimeout(r, 10))
  await w.vm.$nextTick()
  await new Promise(r => setTimeout(r, 10))
  await w.vm.$nextTick()
}

describe('LibraryDialog — Need02 导出落盘与文件夹自选', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    dbMocks.dbGetDefaultExportDir.mockResolvedValue('E:/app/data/output')
    dbMocks.dbExportLibrary.mockResolvedValue('{"format":"pmf-library"}')
    dbMocks.dbExportLibraryToDir.mockResolvedValue({ path: 'E:/app/data/output/pmf-library-20260829-153022.json', json: '{}', filename: 'pmf-library-20260829-153022.json' })
  })

  it('挂载后展示默认目录（输入框/占位）', async () => {
    const w = mount(LibraryDialog, { props: {} })
    await flush(w)
    expect(w.find('[data-testid="library-export-section"]').exists()).toBe(true)
    expect(w.find('[data-testid="library-export-dir"]').exists()).toBe(true)
    expect(w.find('[data-testid="library-export-pick-dir"]').exists()).toBe(true)
    // defaultDir fetched
    expect(dbMocks.dbGetDefaultExportDir).toHaveBeenCalled()
    w.unmount()
  })

  it('选择文件夹：open 返回 string 时回填并写 localStorage', async () => {
    const dialogMod: any = await import('@tauri-apps/plugin-dialog')
    dialogMod.open.mockResolvedValueOnce('D:/tmp/pmf-out')
    const w = mount(LibraryDialog, { props: {} })
    await flush(w)
    await w.find('[data-testid="library-export-pick-dir"]').trigger('click')
    await flush(w)
    expect(localStorage.getItem('pmf:exportDir')).toBe('D:/tmp/pmf-out')
    expect((w.find('[data-testid="library-export-dir"]').element as HTMLInputElement).value).toBe('D:/tmp/pmf-out')
    w.unmount()
  })

  it('选择文件夹：open 返回 null 时不改目录', async () => {
    localStorage.setItem('pmf:exportDir', 'D:/keep')
    const dialogMod: any = await import('@tauri-apps/plugin-dialog')
    dialogMod.open.mockResolvedValueOnce(null)
    const w = mount(LibraryDialog, { props: {} })
    await flush(w)
    const before = (w.find('[data-testid="library-export-dir"]').element as HTMLInputElement).value
    await w.find('[data-testid="library-export-pick-dir"]').trigger('click')
    await flush(w)
    expect((w.find('[data-testid="library-export-dir"]').element as HTMLInputElement).value).toBe(before)
    expect(localStorage.getItem('pmf:exportDir')).toBe('D:/keep')
    w.unmount()
  })

  it('导出成功展示 lastExportPath 与“打开文件夹”按钮', async () => {
    const w = mount(LibraryDialog, { props: {} })
    await flush(w)
    await w.find('[data-testid="library-export-btn"]').trigger('click')
    await flush(w)
    expect(dbMocks.dbExportLibraryToDir).toHaveBeenCalled()
    expect(w.find('[data-testid="library-export-result"]').exists()).toBe(true)
    expect(w.find('[data-testid="library-export-open-dir"]').exists()).toBe(true)
    w.unmount()
  })

  it('导出失败触发 Blob 降级分支（dbExportLibrary 被调用）', async () => {
    dbMocks.dbExportLibraryToDir.mockRejectedValueOnce(new Error('目录不可写'))
    const w = mount(LibraryDialog, { props: {} })
    await flush(w)
    // JSDOM Blob download path needs document; just verify fallback invoke
    const spy = vi.spyOn(document.body, 'appendChild').mockImplementation((n: any) => n)
    vi.spyOn(document.body, 'removeChild').mockImplementation((n: any) => n)
    // URL is polyfilled in jsdom
    await w.find('[data-testid="library-export-btn"]').trigger('click')
    await flush(w)
    expect(dbMocks.dbExportLibrary).toHaveBeenCalled()
    spy.mockRestore()
    w.unmount()
  })
})
