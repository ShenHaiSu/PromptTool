/**
 * need02-01 终态A：报表导出冷却单测（连点只调一次 invoke、2s 内 disabled、timer 跑完恢复）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

const dbMocks = vi.hoisted(() => ({
  dbExportStatsLedgerToDir: vi.fn().mockResolvedValue({ path: 'E:/app/data/output/pmf-stats-2026-09-28_2026-10-04.csv', filename: 'pmf-stats-2026-09-28_2026-10-04.csv' }),
  dbRevealInExplorer: vi.fn().mockResolvedValue(undefined),
  dbExportLibrary: vi.fn(),
  dbGetDefaultExportDir: vi.fn(),
  dbExportLibraryToDir: vi.fn(),
  dbImportLibraryText: vi.fn(),
}))

vi.mock('@/lib/db', () => dbMocks)

vi.mock('@/lib/statsApi', () => ({
  statsLedgerSummary: vi.fn().mockResolvedValue({ total: 10, succeeded: 8, failed: 2, pixels: 100, avgElapsedMs: 1000 }),
  statsLedgerDaily: vi.fn().mockResolvedValue([{ day: '2026-10-04', total: 5, succeeded: 4, pixels: 50 }]),
  statsLedgerHourly: vi.fn().mockResolvedValue([{ hour: 10, total: 2, succeeded: 2, pixels: 20 }]),
  todayStr: () => '2026-10-04',
  addDaysStr: (s: string) => s,
  formatPixels: (n: number) => String(n),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: vi.fn().mockResolvedValue(undefined),
  open: vi.fn().mockResolvedValue(undefined),
}))

import StatsReportDialog from '../StatsReportDialog.vue'
import { useStatsReport } from '@/composables/useStatsReport'

async function tick(w: ReturnType<typeof mount>): Promise<void> {
  await w.vm.$nextTick()
  await Promise.resolve()
  await nextTick()
  await w.vm.$nextTick()
  await Promise.resolve()
}

describe('StatsReportDialog 导出冷却 2s', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    dbMocks.dbExportStatsLedgerToDir.mockResolvedValue({
      path: 'E:/app/data/output/pmf-stats-2026-09-28_2026-10-04.csv',
      filename: 'pmf-stats-2026-09-28_2026-10-04.csv',
    })
    dbMocks.dbRevealInExplorer.mockResolvedValue(undefined)
    vi.useFakeTimers()
    useStatsReport().close()
  })

  afterEach(() => {
    useStatsReport().close()
    vi.useRealTimers()
  })

  async function mountAndOpen(): Promise<ReturnType<typeof mount>> {
    const w = mount(StatsReportDialog, {
      global: { plugins: [createPinia()] },
    })
    useStatsReport().open()
    await tick(w)
    await vi.advanceTimersByTimeAsync(0)
    await tick(w)
    await tick(w)
    return w
  }

  function btn(): HTMLButtonElement {
    return document.body.querySelector('[data-testid="stats-export-csv"]') as HTMLButtonElement
  }

  it('连点只落盘一次，2s 内 disabled，跑完恢复', async () => {
    const w = await mountAndOpen()
    expect(btn()).not.toBeNull()
    expect(btn().disabled).toBe(false)
    btn().click()
    await vi.advanceTimersByTimeAsync(0)
    await tick(w)
    btn().click()
    await vi.advanceTimersByTimeAsync(0)
    await tick(w)
    expect(dbMocks.dbExportStatsLedgerToDir).toHaveBeenCalledTimes(1)
    expect(btn().disabled).toBe(true)
    expect(btn().textContent).toContain('已导出(2s)')
    await vi.advanceTimersByTimeAsync(2000)
    await tick(w)
    expect(btn().disabled).toBe(false)
    expect(dbMocks.dbRevealInExplorer).toHaveBeenCalled()
    w.unmount()
  })

  it('落盘失败也走完 2s 冷却', async () => {
    dbMocks.dbExportStatsLedgerToDir.mockRejectedValueOnce(new Error('目录不可写'))
    const w = await mountAndOpen()
    btn().click()
    await vi.advanceTimersByTimeAsync(0)
    await tick(w)
    expect(dbMocks.dbExportStatsLedgerToDir).toHaveBeenCalledTimes(1)
    expect(btn().disabled).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    await tick(w)
    expect(btn().disabled).toBe(false)
    w.unmount()
  })

  it('reveal 失败不吞导出成功（opener 兜底被调）', async () => {
    dbMocks.dbRevealInExplorer.mockRejectedValueOnce(new Error('explorer 挂了'))
    const w = await mountAndOpen()
    btn().click()
    await vi.advanceTimersByTimeAsync(0)
    await tick(w)
    await vi.advanceTimersByTimeAsync(0)
    await tick(w)
    expect(dbMocks.dbExportStatsLedgerToDir).toHaveBeenCalledTimes(1)
    const opener = await import('@tauri-apps/plugin-opener')
    expect((opener.openPath as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
    w.unmount()
  })
})
