import { ref, computed, watch } from 'vue'
import { logger } from '@/lib/logger'
import { notify } from '@/lib/notify'
import { emit, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import { dbBatchCreateModules, type BatchCreateReport } from '@/lib/db'
import {
  GENERATE_COUNT_DEFAULT,
  GENERATE_COUNT_OPTIONS,
  GENERATE_EXAMPLE_COUNT_DEFAULT,
  GENERATE_EXAMPLE_COUNT_OPTIONS,
  GENERATE_LS_COUNT,
  GENERATE_LS_EXAMPLE_COUNT,
  GENERATE_LS_EXCLUDE,
  GENERATE_LS_STEP,
  GENERATE_LS_TENDENCY,
  GENERATE_TENDENCY_MAX_LEN,
  buildFragmentGeneratePrompt,
  buildGenerateExportContent,
  buildGenerateExportFilename,
  estimateFragmentTokens,
  sampleExamples,
  sanitizeTendency,
} from '@/lib/fragmentGeneratePrompt'
import {
  countDetectedContentEn,
  detectFragmentFormat,
  parseFragmentText,
  toBatchCreatePayload,
  type ParsedFragmentBatch,
} from '@/lib/fragmentGenerateParse'
import type { Dimension, Module } from '@/engine/models'
import type { GenerateFilter } from '@/components/generate/GenerateStep3.vue'

export interface GenerateDialogProps {
  open: boolean
  dimension: Dimension | null
  modules: Module[]
}

export type GenerateDialogEmit = {
  (e: 'update:open', v: boolean): void
  (e: 'imported', report: BatchCreateReport): void
}

/** DimensionGenerateDialog 全量逻辑（EP 化：无 ui/* 引用，空 catch 收敛为 logger） */
export function useGenerateDialog(props: GenerateDialogProps, emitDlg: GenerateDialogEmit) {

  function loadTendency(): string {
    try { return localStorage.getItem(GENERATE_LS_TENDENCY) ?? '' } catch (err) { logger.warn('Generate', 'loadTendency', err); return '' }
  }
  function loadCount(): number {
    try {
      const v = Number(localStorage.getItem(GENERATE_LS_COUNT))
      if ((GENERATE_COUNT_OPTIONS as readonly number[]).includes(v)) return v
    } catch (err) { logger.warn('Generate', 'loadCount', err) }
    return GENERATE_COUNT_DEFAULT
  }
  function loadExampleCount(): number {
    try {
      const v = Number(localStorage.getItem(GENERATE_LS_EXAMPLE_COUNT))
      if ((GENERATE_EXAMPLE_COUNT_OPTIONS as readonly number[]).includes(v)) return v
    } catch (err) { logger.warn('Generate', 'loadExampleCount', err) }
    return GENERATE_EXAMPLE_COUNT_DEFAULT
  }
  function loadExclude(): boolean {
    try {
      const v = localStorage.getItem(GENERATE_LS_EXCLUDE)
      if (v == null) return true
      return v !== 'false'
    } catch (err) { logger.warn('Generate', 'loadExclude', err); return true }
  }
  function loadStep(): 1 | 2 | 3 {
    try {
      const v = Number(localStorage.getItem(GENERATE_LS_STEP))
      if (v === 1 || v === 2 || v === 3) return v as 1 | 2 | 3
    } catch (err) { logger.warn('Generate', 'loadStep', err) }
    return 1
  }

  const tendency = ref<string>(loadTendency())
  const count = ref<number>(loadCount())
  const exampleCount = ref<number>(loadExampleCount())
  const excludeExisting = ref<boolean>(loadExclude())
  const activeStep = ref<1 | 2 | 3>(loadStep())
  const seed = ref<number>(Date.now() % 100000)
  const promptText = ref('')
  const promptBuilt = ref(false)

  watch(tendency, (v) => { try { localStorage.setItem(GENERATE_LS_TENDENCY, v) } catch (err) { logger.warn('Generate', 'persistTendency', err) } })
  watch(count, (v) => { try { localStorage.setItem(GENERATE_LS_COUNT, String(v)) } catch (err) { logger.warn('Generate', 'persistCount', err) } })
  watch(exampleCount, (v) => { try { localStorage.setItem(GENERATE_LS_EXAMPLE_COUNT, String(v)) } catch (err) { logger.warn('Generate', 'persistExampleCount', err) } })
  watch(excludeExisting, (v) => { try { localStorage.setItem(GENERATE_LS_EXCLUDE, String(v)) } catch (err) { logger.warn('Generate', 'persistExclude', err) } })
  watch(activeStep, (v) => { try { localStorage.setItem(GENERATE_LS_STEP, String(v)) } catch (err) { logger.warn('Generate', 'persistStep', err) } })

  const rawResultText = ref('')
  const resultFileInput = ref<HTMLInputElement | null>(null)
  const parsed = ref<ParsedFragmentBatch | null>(null)
  const applying = ref(false)
  const report = ref<BatchCreateReport | null>(null)

  // Step3: filter/search/pagination/selection
  const filter = ref<GenerateFilter>('all')
  const search = ref('')
  const curPage = ref(1)
  const pageSize = 50
  const importMode = ref<'skip' | 'overwrite'>('skip')
  const importWeight = ref<number>(1.0)
  const importNsfw = ref<boolean>(false)

  const existingCount = computed(() => props.modules.length)
  const tendencySanitized = computed(() => sanitizeTendency(tendency.value))
  const tendencyEmpty = computed(() => tendencySanitized.value.text.length === 0)
  const sampledExamples = computed(() => {
    if (!props.dimension) return []
    return sampleExamples(props.modules, exampleCount.value, seed.value)
  })
  const promptTokens = computed(() => promptText.value ? estimateFragmentTokens(promptText.value) : 0)
  const exportContent = computed(() => {
    if (!props.dimension || !promptText.value) return ''
    return buildGenerateExportContent(
      {
        dimension: props.dimension,
        existing: props.modules,
        tendency: tendency.value,
        count: count.value,
        exampleCount: exampleCount.value,
        seed: seed.value,
        excludeExisting: excludeExisting.value,
      },
      promptText.value,
    )
  })
  const detectedCount = computed(() => countDetectedContentEn(rawResultText.value))
  const firstParseError = computed(() => (parsed.value && parsed.value.errors.length ? (parsed.value.errors[0] ?? null) : null))

  const filteredRows = computed(() => {
    if (!parsed.value) return []
    let rows = parsed.value.rows
    if (filter.value === 'ok') rows = rows.filter((r) => r.status === 'ok')
    else if (filter.value === 'dupDb') rows = rows.filter((r) => r.status === 'duplicate_in_db')
    else if (filter.value === 'dupBatch') rows = rows.filter((r) => r.status === 'duplicate_in_batch')
    else if (filter.value === 'tooLong') rows = rows.filter((r) => r.tooLong)
    const kw = search.value.trim().toLowerCase()
    if (kw) {
      rows = rows.filter((r) =>
        r.contentEn.toLowerCase().includes(kw)
        || r.displayName.toLowerCase().includes(kw),
      )
    }
    return rows
  })
  const totalPages = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / pageSize)))
  const pagedRows = computed(() => {
    const start = (curPage.value - 1) * pageSize
    return filteredRows.value.slice(start, start + pageSize)
  })
  const selectedCount = computed(() => parsed.value ? parsed.value.rows.filter((r) => r.selected).length : 0)
  const canApply = computed(() => selectedCount.value > 0 && !applying.value)

  watch([filter, search], () => { curPage.value = 1 })
  watch(() => props.open, (o) => {
    if (o) { curPage.value = 1 }
  })

  function onClose(): void { emitDlg('update:open', false) }
  function onClearRaw(): void {
    rawResultText.value = ''
    parsed.value = null
    report.value = null
    if (resultFileInput.value) resultFileInput.value.value = ''
  }
  function onClearAll(): void {
    onClearRaw()
    promptText.value = ''
    promptBuilt.value = false
    activeStep.value = 1
  }

  function onBuildPrompt(): void {
    if (!props.dimension) { notify('维度不存在', 'error'); return }
    if (tendencyEmpty.value) { notify('请先填写倾向，或点 chips 追加', 'warning'); return }
    if (tendencySanitized.value.truncated) notify(`倾向已截断至 ${GENERATE_TENDENCY_MAX_LEN} 字`, 'warning')
    try {
      promptText.value = buildFragmentGeneratePrompt({
        dimension: props.dimension,
        existing: props.modules,
        tendency: tendency.value,
        count: count.value,
        exampleCount: exampleCount.value,
        seed: seed.value,
        excludeExisting: excludeExisting.value && props.modules.length > 0,
      })
      promptBuilt.value = true
    } catch (e) {
      notify(`生成提示词失败: ${String(e)}`, 'error')
    }
  }

  function onReshuffle(): void {
    seed.value = Math.floor(Math.random() * 100000)
    if (promptBuilt.value) onBuildPrompt()
  }

  function appendChip(chip: string): void {
    tendency.value = tendency.value ? `${tendency.value}、${chip}` : chip
  }

  async function copyText(text: string): Promise<boolean> {
    try { await navigator.clipboard.writeText(text); return true } catch (err) {
      logger.warn('Generate', 'clipboard降级', err)
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
      } catch (err2) { logger.warn('Generate', 'clipboard降级失败', err2); return false }
    }
  }

  async function onCopyPrompt(): Promise<void> {
    if (!promptText.value) { notify('请先生成提示词', 'warning'); return }
    const ok = await copyText(promptText.value)
    notify(ok ? `已复制生成提示词（约 ${promptTokens.value} tokens），去任意 LLM 粘贴即可` : '复制失败，请手动选择复制', ok ? 'success' : 'warning', 2000)
  }

  function onDownload(): void {
    if (!props.dimension) return
    if (!exportContent.value) { notify('请先生成提示词', 'warning'); return }
    const name = buildGenerateExportFilename(props.dimension.key)
    const blob = new Blob([exportContent.value], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    notify('已下载', 'success', 1500)
  }

  async function onResultFileSelected(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const text = await file.text()
    rawResultText.value = rawResultText.value ? `${rawResultText.value}\n${text}` : text
    notify(`已读取 ${file.name}`, 'info', 1500)
    input.value = ''
  }

  function doParse(jump: boolean): void {
    if (!rawResultText.value.trim()) { notify('请先粘贴 LLM 返回的结果', 'warning'); return }
    if (!props.dimension) { notify('维度不存在', 'error'); return }
    const fmt = detectFragmentFormat(rawResultText.value)
    if (fmt === 'unknown') {
      parsed.value = parseFragmentText(rawResultText.value, { dimension: props.dimension, modules: props.modules })
      report.value = null
      curPage.value = 1
      notify('未能识别格式，请确认 LLM 返回了 JSON 或一行一条文本', 'warning')
      return
    }
    const batch = parseFragmentText(rawResultText.value, { dimension: props.dimension, modules: props.modules })
    parsed.value = batch
    report.value = null
    curPage.value = 1
    if (batch.errors.length && batch.stats.valid === 0) {
      notify(`解析失败：${batch.errors[0]}`, 'warning')
      return
    }
    if (jump) activeStep.value = 3
    const s = batch.stats
    notify(`解析完成：共 ${s.total} 条 · 可入库 ${s.valid} · 库内重复 ${s.dupDb}`, batch.errors.length ? 'warning' : 'success', 2000)
  }

  function onParse(): void { doParse(true) }
  function onValidate(): void {
    if (!rawResultText.value.trim()) { notify('请先粘贴 LLM 返回的结果', 'warning'); return }
    if (!props.dimension) { notify('维度不存在', 'error'); return }
    const batch = parseFragmentText(rawResultText.value, { dimension: props.dimension, modules: props.modules })
    const s = batch.stats
    notify(`校验：共 ${s.total} 条 · 可入库 ${s.valid} · 库内重复 ${s.dupDb} · 批内重复 ${s.dupBatch} · 超长 ${s.tooLong}`, 'info', 2500)
  }

  function setRowSelected(index: number, v: boolean): void {
    if (!parsed.value) return
    const r = parsed.value.rows.find((x) => x.index === index)
    if (r && (r.status === 'ok' || !v)) r.selected = v
    parsed.value = { ...parsed.value, rows: [...parsed.value.rows] }
  }
  function selectAllValid(): void {
    if (!parsed.value) return
    for (const r of parsed.value.rows) if (r.status === 'ok') r.selected = true
    parsed.value = { ...parsed.value, rows: [...parsed.value.rows] }
  }
  function deselectAll(): void {
    if (!parsed.value) return
    for (const r of parsed.value.rows) r.selected = false
    parsed.value = { ...parsed.value, rows: [...parsed.value.rows] }
  }
  function selectCurrentPage(): void {
    if (!parsed.value) return
    for (const r of pagedRows.value) if (r.status === 'ok') r.selected = true
    parsed.value = { ...parsed.value, rows: [...parsed.value.rows] }
  }
  function invertSelection(): void {
    if (!parsed.value) return
    for (const r of parsed.value.rows) {
      if (r.status !== 'ok') continue
      r.selected = !r.selected
    }
    parsed.value = { ...parsed.value, rows: [...parsed.value.rows] }
  }

  async function onApply(): Promise<void> {
    if (!props.dimension) { notify('维度不存在', 'error'); return }
    if (!parsed.value) { notify('请先解析', 'warning'); return }
    const payload = toBatchCreatePayload(parsed.value.rows, props.dimension, {
      mode: importMode.value,
      weight: importWeight.value,
      isNsfw: importNsfw.value,
    })
    if (payload.items.length === 0) { notify('请至少勾选一条可入库结果', 'warning'); return }
    applying.value = true
    try {
      const rep = await dbBatchCreateModules(payload)
      report.value = rep
      if (rep.modulesCreated > 0 || rep.modulesUpdated > 0) {
        emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: 'batch-create-modules' })
        emitDlg('imported', rep)
        notify(`已入库：新建 ${rep.modulesCreated} · 更新 ${rep.modulesUpdated} · 跳过 ${rep.modulesSkipped}`, 'success', 2500)
      } else {
        notify('未入库任何条目，请查看报告', 'warning')
      }
      if (rep.errors.length) notify(rep.errors.slice(0, 2).join('；'), 'warning', 2500)
    } catch (e) {
      notify(`入库失败: ${String(e)}`, 'error')
    } finally {
      applying.value = false
    }
  }

  function onCountChange(e: Event): void {
    const v = Number((e.target as HTMLSelectElement).value)
    if ((GENERATE_COUNT_OPTIONS as readonly number[]).includes(v)) count.value = v
  }
  function onExampleCountChange(e: Event): void {
    const v = Number((e.target as HTMLSelectElement).value)
    if ((GENERATE_EXAMPLE_COUNT_OPTIONS as readonly number[]).includes(v)) exampleCount.value = v
  }

  return {
    tendency, count, exampleCount, excludeExisting, activeStep, seed, promptText, promptBuilt,
    rawResultText, resultFileInput, parsed, applying, report,
    filter, search, curPage, pageSize, importMode, importWeight, importNsfw,
    existingCount, tendencyEmpty, sampledExamples, promptTokens, detectedCount, firstParseError,
    filteredRows, totalPages, pagedRows, selectedCount, canApply,
    onClose, onClearRaw, onClearAll, onBuildPrompt, onReshuffle, appendChip,
    onCopyPrompt, onDownload, onResultFileSelected, onParse, onValidate,
    setRowSelected, selectAllValid, deselectAll, selectCurrentPage, invertSelection,
    onApply, onCountChange, onExampleCountChange,
  }
}
