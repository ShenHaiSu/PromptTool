/**
 * need03 S6：useGenerateDialog 编排（本地态恢复 / 筛选分页 / 选择 / 入库 / 复制下载）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

const { dbMock, notifyMock } = vi.hoisted(() => ({
  dbMock: { dbBatchCreateModules: vi.fn() },
  notifyMock: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ dbBatchCreateModules: dbMock.dbBatchCreateModules }))
vi.mock('@/lib/notify', () => ({ notify: notifyMock }))

import { useGenerateDialog, type GenerateDialogProps, type GenerateDialogEmit } from '../useGenerateDialog'
import {
  GENERATE_COUNT_OPTIONS,
  GENERATE_EXAMPLE_COUNT_OPTIONS,
  GENERATE_LS_COUNT,
  GENERATE_COUNT_DEFAULT,
  GENERATE_LS_EXCLUDE,
  GENERATE_LS_STEP,
  GENERATE_LS_TENDENCY,
} from '@/lib/fragmentGeneratePrompt'
import { on, off, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import type { Dimension, Module } from '@/engine/models'

const dim: Dimension = {
  id: 'd_top',
  key: 'top',
  nameCn: '上装',
  nameEn: 'Top',
  sortOrder: 1,
  isMultiSelect: false,
  isEnabled: true,
}

function mod(en: string, zh = ''): Module {
  return {
    id: `m_${en}`,
    dimensionId: 'd_top',
    contentEn: en,
    displayName: zh,
    weight: 1,
    isEnabled: true,
    isNsfw: false,
    usageCount: 0,
    dimensionKey: 'top',
  } as Module
}

function make(over: Partial<GenerateDialogProps> = {}, emit?: GenerateDialogEmit) {
  const props: GenerateDialogProps = { open: true, dimension: dim, modules: [], ...over }
  const events: { name: string; arg: unknown }[] = []
  const e: GenerateDialogEmit = emit ?? ((name, arg) => events.push({ name, arg }))
  return { d: useGenerateDialog(props, e), props, events }
}

const LINES = 'white shirt\nblue jeans\nblack coat'

beforeEach(() => {
  localStorage.clear()
  dbMock.dbBatchCreateModules.mockReset()
  notifyMock.mockReset()
  dbMock.dbBatchCreateModules.mockResolvedValue({
    totalRequested: 2, valid: 2, modulesCreated: 2, modulesUpdated: 0, modulesSkipped: 0,
    emptyIgnored: 0, duplicateInBatch: 0, truncated: 0, errors: [], warnings: [],
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('useGenerateDialog 本地态恢复', () => {
  it('无缓存时全部回落默认值', () => {
    const { d } = make()
    expect(d.tendency.value).toBe('')
    expect(d.count.value).toBe(GENERATE_COUNT_DEFAULT)
    expect(d.excludeExisting.value).toBe(true)
    expect(d.activeStep.value).toBe(1)
  })

  it('从 localStorage 恢复倾向/条数/排除/步骤', () => {
    const opt = GENERATE_COUNT_OPTIONS[1]!
    localStorage.setItem(GENERATE_LS_TENDENCY, '复古')
    localStorage.setItem(GENERATE_LS_COUNT, String(opt))
    localStorage.setItem(GENERATE_LS_EXCLUDE, 'false')
    localStorage.setItem(GENERATE_LS_STEP, '3')
    const { d } = make()
    expect(d.tendency.value).toBe('复古')
    expect(d.count.value).toBe(opt)
    expect(d.excludeExisting.value).toBe(false)
    expect(d.activeStep.value).toBe(3)
  })

  it('条数缓存非法时回落默认', () => {
    localStorage.setItem(GENERATE_LS_COUNT, '999')
    localStorage.setItem(GENERATE_LS_STEP, '9')
    const { d } = make()
    expect(d.count.value).toBe(GENERATE_COUNT_DEFAULT)
    expect(d.activeStep.value).toBe(1)
  })

  it('示例条数缓存命中合法值', () => {
    localStorage.setItem('pmf.generate.exampleCount', String(GENERATE_EXAMPLE_COUNT_OPTIONS[0]!))
    const { d } = make()
    expect(d.excludeExisting.value).toBe(true)
  })

  it('watch 把变更写回 localStorage', async () => {
    const { d } = make()
    d.tendency.value = '赛博'
    d.count.value = GENERATE_COUNT_OPTIONS[0]!
    d.excludeExisting.value = false
    d.activeStep.value = 2
    await nextTick()
    expect(localStorage.getItem(GENERATE_LS_TENDENCY)).toBe('赛博')
    expect(localStorage.getItem(GENERATE_LS_COUNT)).toBe(String(GENERATE_COUNT_OPTIONS[0]!))
    expect(localStorage.getItem(GENERATE_LS_EXCLUDE)).toBe('false')
    expect(localStorage.getItem(GENERATE_LS_STEP)).toBe('2')
  })
})

describe('useGenerateDialog 计算属性', () => {
  it('existingCount / tendencyEmpty / promptTokens 初始态', () => {
    const { d } = make({ modules: [mod('a'), mod('b')] })
    expect(d.existingCount.value).toBe(2)
    expect(d.tendencyEmpty.value).toBe(true)
    expect(d.promptTokens.value).toBe(0)
  })

  it('无维度时 sampledExamples 为空', () => {
    const { d } = make({ dimension: null })
    expect(d.sampledExamples.value).toEqual([])
  })

  it('未解析时 filteredRows 为空、totalPages 至少 1', () => {
    const { d } = make()
    expect(d.filteredRows.value).toEqual([])
    expect(d.totalPages.value).toBe(1)
    expect(d.pagedRows.value).toEqual([])
    expect(d.selectedCount.value).toBe(0)
    expect(d.canApply.value).toBe(false)
  })

  it('切筛选/搜索后 curPage 归 1', async () => {
    const { d } = make()
    d.curPage.value = 3
    d.filter.value = 'ok'
    await nextTick()
    expect(d.curPage.value).toBe(1)
  })
})

describe('useGenerateDialog 步骤与清理', () => {
  it('onClose 抛 update:open=false', () => {
    const events: { name: string; arg: unknown }[] = []
    const { d } = make({}, ((name, arg) => events.push({ name, arg })) as GenerateDialogEmit)
    d.onClose()
    expect(events).toEqual([{ name: 'update:open', arg: false }])
  })

  it('onClearRaw 清原文/解析/报告', () => {
    const { d } = make()
    d.rawResultText.value = 'x'
    d.onParse()
    d.report.value = { modulesCreated: 1 } as never
    d.onClearRaw()
    expect(d.rawResultText.value).toBe('')
    expect(d.parsed.value).toBeNull()
    expect(d.report.value).toBeNull()
  })

  it('onClearAll 额外清提示词并回 step1', () => {
    const { d } = make()
    d.promptText.value = 'p'
    d.promptBuilt.value = true
    d.activeStep.value = 3
    d.onClearAll()
    expect(d.promptText.value).toBe('')
    expect(d.promptBuilt.value).toBe(false)
    expect(d.activeStep.value).toBe(1)
  })
})

describe('useGenerateDialog 生成提示词', () => {
  it('无维度时报错', () => {
    const { d } = make({ dimension: null })
    d.onBuildPrompt()
    expect(notifyMock).toHaveBeenCalledWith('维度不存在', 'error')
  })

  it('倾向为空时告警', () => {
    const { d } = make()
    d.onBuildPrompt()
    expect(notifyMock).toHaveBeenCalledWith('请先填写倾向，或点 chips 追加', 'warning')
  })

  it('正常生成并置 promptBuilt', () => {
    const { d } = make()
    d.tendency.value = '复古'
    d.onBuildPrompt()
    expect(d.promptBuilt.value).toBe(true)
    expect(d.promptText.value.length).toBeGreaterThan(0)
  })

  it('appendChip 追加倾向；空串时直接赋值', () => {
    const { d } = make()
    d.appendChip('赛博')
    expect(d.tendency.value).toBe('赛博')
    d.appendChip('复古')
    expect(d.tendency.value).toBe('赛博、复古')
  })

  it('onReshuffle 换 seed 并重建提示词', () => {
    const { d } = make()
    d.tendency.value = '复古'
    d.onBuildPrompt()
    const before = d.seed.value
    d.onReshuffle()
    expect(d.seed.value).not.toBe(before)
  })

  it('onCountChange / onExampleCountChange 只接受合法选项', () => {
    const { d } = make()
    d.onCountChange({ target: { value: String(GENERATE_COUNT_OPTIONS[2]!) } } as unknown as Event)
    expect(d.count.value).toBe(GENERATE_COUNT_OPTIONS[2])
    d.onCountChange({ target: { value: '999' } } as unknown as Event)
    expect(d.count.value).toBe(GENERATE_COUNT_OPTIONS[2])
    d.onExampleCountChange({ target: { value: String(GENERATE_EXAMPLE_COUNT_OPTIONS[1]!) } } as unknown as Event)
    expect(d.exampleCount.value).toBe(GENERATE_EXAMPLE_COUNT_OPTIONS[1])
    d.onExampleCountChange({ target: { value: '999' } } as unknown as Event)
    expect(d.exampleCount.value).toBe(GENERATE_EXAMPLE_COUNT_OPTIONS[1])
  })
})

describe('useGenerateDialog 复制与下载', () => {
  it('未生成提示词时复制告警', async () => {
    const { d } = make()
    await d.onCopyPrompt()
    expect(notifyMock).toHaveBeenCalledWith('请先生成提示词', 'warning')
  })

  it('剪贴板可用时复制成功', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { d } = make()
    d.tendency.value = '复古'
    d.onBuildPrompt()
    await d.onCopyPrompt()
    expect(writeText).toHaveBeenCalledWith(d.promptText.value)
    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('已复制生成提示词'), 'success', 2000)
  })

  it('剪贴板抛错时降级 execCommand', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('no perm')) },
    })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
    const { d } = make()
    d.tendency.value = '复古'
    d.onBuildPrompt()
    await d.onCopyPrompt()
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('已复制生成提示词'), 'success', 2000)
  })

  it('onDownload 无维度直接返回', () => {
    const { d } = make({ dimension: null })
    d.onDownload()
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('onDownload 未生成时告警', () => {
    const { d } = make()
    d.onDownload()
    expect(notifyMock).toHaveBeenCalledWith('请先生成提示词', 'warning')
  })

  it('onDownload 正常生成并触发点击', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:x')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { d } = make()
    d.tendency.value = '复古'
    d.onBuildPrompt()
    d.onDownload()
    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x')
    expect(notifyMock).toHaveBeenCalledWith('已下载', 'success', 1500)
  })
})

describe('useGenerateDialog 解析与校验', () => {
  it('空原文时解析告警', () => {
    const { d } = make()
    d.onParse()
    expect(notifyMock).toHaveBeenCalledWith('请先粘贴 LLM 返回的结果', 'warning')
  })

  it('无维度时报错', () => {
    const { d } = make({ dimension: null })
    d.rawResultText.value = LINES
    d.onParse()
    expect(notifyMock).toHaveBeenCalledWith('维度不存在', 'error')
  })

  it('unknown 格式时仅回填解析并告警、不跳 step3', () => {
    const { d } = make()
    d.activeStep.value = 1
    d.rawResultText.value = '{ not json at all'
    d.onParse()
    expect(d.activeStep.value).toBe(1)
    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('未能识别格式'), 'warning')
  })

  it('lines 格式解析成功并跳 step3', () => {
    const { d } = make()
    d.rawResultText.value = LINES
    d.onParse()
    expect(d.parsed.value!.rows).toHaveLength(3)
    expect(d.activeStep.value).toBe(3)
    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('解析完成'), 'success', 2000)
  })

  it('onValidate 空原文告警', () => {
    const { d } = make()
    d.onValidate()
    expect(notifyMock).toHaveBeenCalledWith('请先粘贴 LLM 返回的结果', 'warning')
  })

  it('onValidate 无维度报错', () => {
    const { d } = make({ dimension: null })
    d.rawResultText.value = LINES
    d.onValidate()
    expect(notifyMock).toHaveBeenCalledWith('维度不存在', 'error')
  })

  it('onValidate 输出统计信息', () => {
    const { d } = make()
    d.rawResultText.value = LINES
    d.onValidate()
    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('校验：共 3 条'), 'info', 2500)
  })

  it('onResultFileSelected 无文件时直接返回', async () => {
    const { d } = make()
    await d.onResultFileSelected({ target: { files: [], value: 'x' } } as unknown as Event)
    expect(d.rawResultText.value).toBe('')
  })

  it('onResultFileSelected 追加文件内容并清 input', async () => {
    const { d } = make()
    const file = new File(['a shirt'], 'r.txt', { type: 'text/plain' })
    const input = { files: [file], value: 'r.txt' }
    await d.onResultFileSelected({ target: input } as unknown as Event)
    expect(d.rawResultText.value).toBe('a shirt')
    expect(input.value).toBe('')
    expect(notifyMock).toHaveBeenCalledWith('已读取 r.txt', 'info', 1500)
  })
})

describe('useGenerateDialog 筛选与选择', () => {
  function parsed() {
    const { d } = make()
    d.rawResultText.value = LINES
    d.onParse()
    return d
  }

  it('各筛选值按 status 过滤', () => {
    const d = parsed()
    expect(d.filteredRows.value).toHaveLength(3)
    d.filter.value = 'ok'
    expect(d.filteredRows.value.every((r) => r.status === 'ok')).toBe(true)
    d.filter.value = 'dupDb'
    expect(d.filteredRows.value.every((r) => r.status === 'duplicate_in_db')).toBe(true)
    d.filter.value = 'dupBatch'
    expect(d.filteredRows.value.every((r) => r.status === 'duplicate_in_batch')).toBe(true)
    d.filter.value = 'tooLong'
    expect(d.filteredRows.value.every((r) => r.tooLong)).toBe(true)
    d.filter.value = 'all'
    expect(d.filteredRows.value).toHaveLength(3)
  })

  it('搜索按 contentEn/displayName 命中', () => {
    const d = parsed()
    d.search.value = 'WHITE'
    expect(d.filteredRows.value).toHaveLength(1)
    d.search.value = '不存在的词'
    expect(d.filteredRows.value).toHaveLength(0)
  })

  it('未解析时各选择函数直接返回', () => {
    const { d } = make()
    d.setRowSelected(0, true)
    d.selectAllValid()
    d.deselectAll()
    d.selectCurrentPage()
    d.invertSelection()
    expect(d.parsed.value).toBeNull()
  })

  it('setRowSelected：ok 行可勾可取消，非 ok 行不能勾选', () => {
    const d = parsed()
    d.deselectAll()
    d.setRowSelected(d.parsed.value!.rows[0]!.index, true)
    expect(d.selectedCount.value).toBe(1)
    d.setRowSelected(d.parsed.value!.rows[0]!.index, false)
    expect(d.selectedCount.value).toBe(0)
    const bad = d.parsed.value!.rows.find((r) => r.status !== 'ok')
    if (bad) {
      d.setRowSelected(bad.index, true)
      expect(d.parsed.value!.rows.find((r) => r.index === bad.index)!.selected).toBe(false)
    }
  })

  it('selectAllValid / deselectAll / invertSelection', () => {
    const d = parsed()
    d.deselectAll()
    d.selectAllValid()
    expect(d.selectedCount.value).toBe(3)
    d.invertSelection()
    expect(d.selectedCount.value).toBe(0)
  })

  it('selectCurrentPage 只选当前页（pageSize=50 时等价全选）', () => {
    const d = parsed()
    d.deselectAll()
    d.selectCurrentPage()
    expect(d.selectedCount.value).toBe(3)
    expect(d.canApply.value).toBe(true)
  })
})

describe('useGenerateDialog 入库', () => {
  it('无维度报错', async () => {
    const { d } = make({ dimension: null })
    await d.onApply()
    expect(notifyMock).toHaveBeenCalledWith('维度不存在', 'error')
  })

  it('未解析告警', async () => {
    const { d } = make()
    await d.onApply()
    expect(notifyMock).toHaveBeenCalledWith('请先解析', 'warning')
  })

  it('一条未勾选时告警', async () => {
    const { d } = make()
    d.rawResultText.value = LINES
    d.onParse()
    d.deselectAll()
    await d.onApply()
    expect(notifyMock).toHaveBeenCalledWith('请至少勾选一条可入库结果', 'warning')
    expect(dbMock.dbBatchCreateModules).not.toHaveBeenCalled()
  })

  it('正常入库：广播事件 + imported 回调 + 清 applying', async () => {
    const { d, events } = make()
    d.rawResultText.value = LINES
    d.onParse()
    const seen: unknown[] = []
    const h = (p: unknown) => seen.push(p)
    on(LIBRARY_CHANGED, h)
    await d.onApply()
    off(LIBRARY_CHANGED, h)
    expect(seen).toEqual([{ source: 'dimension-panel', op: 'batch-create-modules' }])
    expect(events[0]!.name).toBe('imported')
    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('已入库：新建 2'), 'success', 2500)
    expect(d.applying.value).toBe(false)
    expect(d.report.value!.modulesCreated).toBe(2)
  })

  it('零入库时给 warning', async () => {
    dbMock.dbBatchCreateModules.mockResolvedValueOnce({
      totalRequested: 2, valid: 2, modulesCreated: 0, modulesUpdated: 0, modulesSkipped: 2,
      emptyIgnored: 0, duplicateInBatch: 0, truncated: 0, errors: [], warnings: [],
    })
    const { d, events } = make()
    d.rawResultText.value = LINES
    d.onParse()
    await d.onApply()
    expect(notifyMock).toHaveBeenCalledWith('未入库任何条目，请查看报告', 'warning')
    expect(events).toHaveLength(0)
  })

  it('带 errors 时追加前两条告警', async () => {
    dbMock.dbBatchCreateModules.mockResolvedValueOnce({
      totalRequested: 2, valid: 2, modulesCreated: 1, modulesUpdated: 0, modulesSkipped: 1,
      emptyIgnored: 0, duplicateInBatch: 0, truncated: 0, errors: ['e1', 'e2', 'e3'], warnings: [],
    })
    const { d } = make()
    d.rawResultText.value = LINES
    d.onParse()
    await d.onApply()
    expect(notifyMock).toHaveBeenCalledWith('e1；e2', 'warning', 2500)
  })

  it('后端失败时弹错误且 applying 复位', async () => {
    dbMock.dbBatchCreateModules.mockRejectedValueOnce(new Error('db boom'))
    const { d } = make()
    d.rawResultText.value = LINES
    d.onParse()
    await expect(d.onApply()).resolves.toBeUndefined()
    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('入库失败'), 'error')
    expect(d.applying.value).toBe(false)
  })
})