import { ref, computed, watch } from 'vue'
import { logger } from '@/lib/logger'
import { notify } from '@/lib/notify'
import { emit, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import { dbBatchUpdateDisplayNames } from '@/lib/db'
import type { TranslationUpdateReport } from '@/lib/db'
import {
  buildAllTranslationPrompts,
  buildTranslationExportContent,
  buildTranslationExportFilename,
  estimateTranslationTokens,
  TRANSLATION_CHUNK_SIZE_DEFAULT,
  TRANSLATION_LS_CHUNK_SIZE,
  TRANSLATION_LS_STEP,
} from '@/lib/translationPrompt'
import {
  parseTranslationText,
  validateTranslationBatch,
  type ParsedTranslation,
  type TranslationRow,
} from '@/lib/translationParse'
import type { Dimension, Module } from '@/engine/models'
import type { TranslateFilter } from '@/components/translate/TranslateStep3.vue'

export interface TranslateDialogProps {
  open: boolean
  dimension: Dimension | null
  modules: Module[]
}

export type TranslateDialogEmit = {
  (e: 'update:open', v: boolean): void
  (e: 'applied', report: TranslationUpdateReport): void
}

/** DimensionTranslateDialog 全量逻辑（EP 化：无 ui/* 引用，空 catch 收敛为 logger） */
export function useTranslateDialog(props: TranslateDialogProps, emitDlg: TranslateDialogEmit) {

  function loadChunkSize(): number {
    try {
      const v = Number(localStorage.getItem(TRANSLATION_LS_CHUNK_SIZE))
      if (v === 30 || v === 50) return v
    } catch (err) { logger.warn('Translate', 'loadChunkSize', err) }
    return TRANSLATION_CHUNK_SIZE_DEFAULT
  }
  function loadStep(): 1 | 2 | 3 {
    try {
      const v = Number(localStorage.getItem(TRANSLATION_LS_STEP))
      if (v === 1 || v === 2 || v === 3) return v as 1 | 2 | 3
    } catch (err) { logger.warn('Translate', 'loadStep', err) }
    return 1
  }

  const chunkSize = ref<number>(loadChunkSize())
  const activeStep = ref<1 | 2 | 3>(loadStep())
  watch(chunkSize, (v) => { try { localStorage.setItem(TRANSLATION_LS_CHUNK_SIZE, String(v)) } catch (err) { logger.warn('Translate', 'persistChunkSize', err) } })
  watch(activeStep, (v) => { try { localStorage.setItem(TRANSLATION_LS_STEP, String(v)) } catch (err) { logger.warn('Translate', 'persistStep', err) } })

  const previewChunkIndex = ref(0)
  const rawResultText = ref('')
  const resultFileInput = ref<HTMLInputElement | null>(null)
  const parsed = ref<ParsedTranslation | null>(null)
  const applying = ref(false)
  const report = ref<TranslationUpdateReport | null>(null)

  // filter/search/pagination for Step3 preview
  const filter = ref<TranslateFilter>('all')
  const search = ref('')
  const curPage = ref(1)
  const pageSize = 20

  // inline edit state
  const editingId = ref<string | null>(null)
  const editingValue = ref('')

  const promptsData = computed(() => {
    if (!props.dimension) return { prompts: [] as string[], chunks: [] as ReturnType<typeof buildAllTranslationPrompts>['chunks'] }
    return buildAllTranslationPrompts(props.dimension, props.modules, chunkSize.value)
  })
  const prompts = computed(() => promptsData.value.prompts)
  const chunks = computed(() => promptsData.value.chunks)
  const totalChunks = computed(() => chunks.value.length)

  const previewText = computed(() => {
    if (!prompts.value.length) return ''
    return prompts.value[previewChunkIndex.value] ?? prompts.value[0] ?? ''
  })
  const previewTokens = computed(() => previewText.value ? estimateTranslationTokens(previewText.value) : 0)
  const exportContent = computed(() => {
    if (!props.dimension) return ''
    return buildTranslationExportContent(props.dimension, props.modules, chunkSize.value, prompts.value)
  })

  const detectedBlocks = computed(() => {
    const t = rawResultText.value
    if (!t.trim()) return 0
    // cheap count via extract-like: count occurrences of '"zh"'
    const m = t.match(/"zh"\s*:/g)
    return m ? m.length : 0
  })
  const firstParseError = computed(() => (parsed.value && parsed.value.errors.length ? (parsed.value.errors[0] ?? null) : null))

  const filteredRows = computed<TranslationRow[]>(() => {
    if (!parsed.value) return []
    let rows = parsed.value.rows
    if (filter.value !== 'all') {
      if (filter.value === 'ok') rows = rows.filter((r) => r.status === 'ok')
      else if (filter.value === 'unknown') rows = rows.filter((r) => r.status === 'unknownId')
      else if (filter.value === 'empty') rows = rows.filter((r) => r.status === 'emptyZh')
      else if (filter.value === 'duplicate') rows = rows.filter((r) => r.status === 'duplicate')
    }
    const kw = search.value.trim().toLowerCase()
    if (kw) {
      rows = rows.filter((r) =>
        r.id.toLowerCase().includes(kw)
        || r.contentEn.toLowerCase().includes(kw)
        || r.oldDisplayName.toLowerCase().includes(kw)
        || r.newZh.toLowerCase().includes(kw),
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

  watch(() => props.open, (o) => {
    if (o) {
      if (chunks.value.length > 0 && previewChunkIndex.value >= chunks.value.length) previewChunkIndex.value = 0
    }
  })
  watch([filter, search], () => { curPage.value = 1 })

  function onClose(): void { emitDlg('update:open', false) }
  function onClearRaw(): void { rawResultText.value = ''; parsed.value = null; report.value = null; if (resultFileInput.value) resultFileInput.value.value = '' }
  function onClearAll(): void { onClearRaw(); parsed.value = null; report.value = null; activeStep.value = 1 }

  async function copyText(text: string): Promise<boolean> {
    try { await navigator.clipboard.writeText(text); return true } catch (err) {
      logger.warn('Translate', 'clipboard降级', err)
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
      } catch (err2) { logger.warn('Translate', 'clipboard降级失败', err2); return false }
    }
  }

  async function onCopyChunk(cId: string): Promise<void> {
    const idx = chunks.value.findIndex((c) => c.chunkId === cId)
    const text = prompts.value[idx] ?? ''
    if (!text) { notify('该片无内容', 'warning'); return }
    const ok = await copyText(text)
    notify(ok ? `已复制片 ${cId}` : '复制失败，请手动选择复制', ok ? 'success' : 'warning', 1500)
  }
  async function onCopyAll(): Promise<void> {
    if (!exportContent.value) { notify('暂无可复制内容', 'warning'); return }
    const ok = await copyText(exportContent.value)
    notify(ok ? `已复制全部 ${totalChunks.value} 片` : '复制失败', ok ? 'success' : 'warning', 1500)
  }
  function onDownload(): void {
    if (!props.dimension) return
    if (!exportContent.value) { notify('暂无可下载内容', 'warning'); return }
    const name = buildTranslationExportFilename(props.dimension.key)
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
  function onParse(): void {
    if (!rawResultText.value.trim()) { notify('请先粘贴 LLM 返回的 JSON', 'warning'); return }
    if (!props.dimension) { notify('维度不存在', 'error'); return }
    const merge = parseTranslationText(rawResultText.value)
    if (merge.blocks.length === 0 && merge.errors.length > 0) {
      // still produce empty parsed with errors
      const validatedEmpty: ParsedTranslation = {
        rows: [],
        stats: { totalUnique: 0, hit: 0, unknown: 0, duplicate: merge.stats.duplicateIds, empty: 0 },
        errors: merge.errors,
        warnings: merge.warnings,
      }
      parsed.value = validatedEmpty
      report.value = null
      curPage.value = 1
      activeStep.value = 3
      notify(`解析失败：${merge.errors[0]}`, 'warning')
      return
    }
    const validated = validateTranslationBatch(merge, { dimension: props.dimension, modules: props.modules })
    parsed.value = validated
    report.value = null
    curPage.value = 1
    activeStep.value = 3
    const hit = validated.stats.hit
    const total = validated.stats.totalUnique
    if (validated.errors.length) notify(`解析完成：${validated.errors.length} 个错误`, 'warning')
    else notify(`解析完成：${total} 唯一 id · 命中 ${hit}`, 'success', 1800)
  }

  function setRowSelected(id: string, v: boolean): void {
    if (!parsed.value) return
    const r = parsed.value.rows.find((x) => x.id === id)
    if (r) r.selected = v
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

  function startEdit(row: TranslationRow): void {
    editingId.value = row.id
    editingValue.value = row.newZh
  }
  function startEditById(id: string): void {
    const row = parsed.value?.rows.find((x) => x.id === id)
    if (row && row.status === 'ok') startEdit(row)
  }
  function confirmEdit(row: TranslationRow): void {
    const v = editingValue.value.trim()
    if (!v) { notify('中文不能为空', 'warning'); return }
    const truncated = [...v].length > 500 ? [...v].slice(0, 500).join('') : v
    row.newZh = truncated
    if ([...v].length > 500) notify('已截断至 500 字符', 'warning')
    // re-validate empty
    if (!row.newZh.trim()) { row.status = 'emptyZh'; row.selected = false }
    else if (row.status === 'emptyZh') { row.status = 'ok'; row.selected = true }
    editingId.value = null
    if (parsed.value) parsed.value = { ...parsed.value, rows: [...parsed.value.rows] }
  }
  function confirmEditById(id: string): void {
    const row = parsed.value?.rows.find((x) => x.id === id)
    if (row) confirmEdit(row)
  }
  function cancelEdit(): void { editingId.value = null }

  async function onApply(): Promise<void> {
    if (!props.dimension) { notify('维度不存在', 'error'); return }
    if (!parsed.value) { notify('请先解析', 'warning'); return }
    const items = parsed.value.rows.filter((r) => r.selected && r.status === 'ok').map((r) => ({ id: r.id, displayName: r.newZh.trim() })).filter((i) => i.displayName.length > 0)
    if (items.length === 0) { notify('请至少勾选一条合法结果', 'warning'); return }
    if (items.length > 1000) { notify('单次更新不超过 1000 条，请取消部分勾选后分批', 'warning'); return }
    applying.value = true
    try {
      const rep = await dbBatchUpdateDisplayNames({ dimensionId: props.dimension.id, items })
      report.value = rep
      if (rep.updated > 0) {
        emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: 'batch-update-display-names' })
        emitDlg('applied', rep)
        notify(`已更新 ${rep.updated} 条中文描述`, 'success', 2000)
      } else {
        notify('未更新任何条目，请查看报告', 'warning')
      }
      if (rep.errors.length) notify(rep.errors.slice(0, 2).join('；'), 'warning', 2500)
    } catch (e) {
      notify(`回填失败: ${String(e)}`, 'error')
    } finally {
      applying.value = false
    }
  }

  function onChunkSizeChange(e: Event): void {
    const v = Number((e.target as HTMLSelectElement).value)
    if (v === 30 || v === 50) { chunkSize.value = v; previewChunkIndex.value = 0 }
  }
  function onPreviewChunk(cId: string): void {
    const idx = chunks.value.findIndex((x) => x.chunkId === cId)
    if (idx >= 0) previewChunkIndex.value = idx
  }

  return {
    chunkSize, activeStep, previewChunkIndex, rawResultText, resultFileInput, parsed, applying, report,
    filter, search, curPage, pageSize, editingId, editingValue,
    prompts, chunks, totalChunks, previewText, previewTokens, detectedBlocks, firstParseError,
    filteredRows, totalPages, pagedRows, selectedCount, canApply,
    onClose, onClearRaw, onClearAll, onCopyChunk, onCopyAll, onDownload,
    onResultFileSelected, onParse, setRowSelected, selectAllValid, deselectAll, selectCurrentPage, invertSelection,
    startEditById, confirmEditById, cancelEdit, onApply, onChunkSizeChange, onPreviewChunk,
  }
}
