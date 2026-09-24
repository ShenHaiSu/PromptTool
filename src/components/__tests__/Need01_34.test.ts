import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(p: string): string {
  return readFileSync(join(root, p), 'utf-8')
}

describe('need01 需求3+4 契约 testid/命令', () => {
  it('需求3：运行条报表入口 + 看板 testid', () => {
    const panel = read('src/components/ImageQueuePanel.vue')
    expect(panel).toContain('data-testid="iq-stats-report"')
    const dialog = read('src/components/StatsReportDialog.vue')
    expect(dialog).toContain('data-testid="stats-report-dialog"')
    expect(dialog).toContain('data-testid="stats-daily"')
    expect(dialog).toContain('data-testid="stats-hourly"')
    const bar = read('src/components/StatusBar.vue')
    expect(bar).toContain('data-testid="status-stats-report"')
  })
  it('需求4：Tabs 第三位 + 单发 testid', () => {
    const app = read('src/App.vue')
    expect(app).toContain('data-testid="center-tab-single"')
    expect(app).toContain('手动单发')
    expect(app).toContain('<SingleShotPanel')
    const single = read('src/components/SingleShotPanel.vue')
    for (const id of [
      'single-shot-panel',
      'single-shot-prompt',
      'single-shot-size',
      'single-shot-ratio',
      'single-shot-output',
      'single-shot-generate',
      'single-shot-save',
      'single-shot-reset',
      'single-shot-preview',
    ]) {
      expect(single).toContain(`data-testid="${id}"`)
    }
  })
  it('后端命令注册 5 个（报表 3 + 单发 2）', () => {
    const lib = read('src-tauri/src/lib.rs')
    for (const cmd of [
      'stats_ledger_summary',
      'stats_ledger_daily',
      'stats_ledger_hourly',
      'iq_generate_one_preview',
      'iq_save_preview',
    ]) {
      expect(lib).toContain(cmd)
    }
    const schema = read('src-tauri/resources/meta_schema.sql')
    expect(schema).toContain('generation_ledger')
  })
})
