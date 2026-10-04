import { ref, computed, watch } from 'vue'
import { notify } from '@/lib/notify'
import { logger } from '@/lib/logger'
import { dbGetDimensions, dbImportSegments } from '@/lib/db'
import type { SegmentImportPayload, SegmentImportReport } from '@/lib/db'
import { parseAndValidate, toSegmentsJson } from '@/lib/segmentParse'
import type { ParsedBatch, ParsedPrompt } from '@/lib/segmentParse'
import { buildSegmentInstructionPrompt, copyInstructionPrompt, estimatePromptTokens } from '@/lib/segmentPrompt'
import type { Dimension } from '@/engine/models'

export type SegmentFilter = 'all' | 'needs_review' | 'unassigned' | 'error'
export type UnassignedStrategy = 'ignore' | 'to_camera' | 'prompt_new'
export type SegmentImportMode = 'skip' | 'overwrite'

/** 需03 S4：分段导入的导入报告（由后端 SegmentImportReport 裁剪） */
export type SegmentImportSummary = Omit<SegmentImportReport, 'prompts' | 'segmentsTotal'> & {
  errors: string[]
  warnings: string[]
}

const PAGE_SIZE = 10

export function useSegmentImport(
  props: { open: boolean },
  emit: (e: 'update:open', v: boolean) => void,
  emitImported: (e: 'imported') => void,
) {
  /* ---------------- Step 1 — 原始提示词 ---------------- */
  const rawText = ref('')
  const rawFileName = ref('')
  const rawPrompts = computed(() => rawText.value.split('\n').map((s) => s.trim()).filter(Boolean))
  const dimensions = ref<Dimension[]>([])
  const dimensionsLoading = ref(false)
  const dimensionsError = ref('')
  const instructionText = ref('')
  const activeStep = ref<1 | 2 | 3>(1)

  /* ---------------- Step 2 — LLM 输出 ---------------- */
  const llmOutput = ref('')
  const parsed = ref<ParsedBatch | null>(null)
  const llmFileName = ref('')

  /* ---------------- Step 3 — 预览与导入 ---------------- */
  const filter = ref<SegmentFilter>('all')
  const currentPage = ref(1)
  const pageSize = PAGE_SIZE
  const unassignedStrategy = ref<UnassignedStrategy>('ignore')
  const importMode = ref<SegmentImportMode>('skip')
  const selectedKeys = ref<Set<string>>(new Set())
  const importing = ref(false)
  const report = ref<SegmentImportSummary | null>(null)

  const tokenEstimate = computed(() => (instructionText.value ? estimatePromptTokens(instructionText.value) : 0))

  const filteredPrompts = computed<ParsedPrompt[]>(() => {
    if (!parsed.value) return []
    const all = parsed.value.prompts
    if (filter.value === 'all') return all
    if (filter.value === 'needs_review') return all.filter((p) => p.status === 'needs_review')
    if (filter.value === 'unassigned') return all.filter((p) => p.stats.unassigned > 0)
    return all.filter((p) => p.status === 'error')
  })

  const pagedPrompts = computed(() => {
    const start = (currentPage.value - 1) * pageSize
    return filteredPrompts.value.slice(start, start + pageSize)
  })

  const totalPages = computed(() => Math.max(1, Math.ceil(filteredPrompts.value.length / pageSize)))

  const dimKeyToDim = computed(() => {
    const m = new Map<string, Dimension>()
    for (const d of dimensions.value) m.set(d.key.toLowerCase(), d)
    return m
  })

  const previewStats = computed(() => {
    if (!parsed.value) return null
    const needsReview = parsed.value.prompts.filter((p) => p.status === 'needs_review').length
    const errors = parsed.value.prompts.filter((p) => p.status === 'error').length + parsed.value.errors.length
    return {
      total: parsed.value.stats.segments,
      unassigned: parsed.value.stats.unassigned,
      needsReview,
      errors,
      prompts: parsed.value.stats.prompts,
    }
  })

  const selectedCount = computed(() => selectedKeys.value.size)

  function segmentKey(promptId: string, idx: number): string {
    return `${promptId}::${idx}`
  }

  function isSegmentSelected(promptId: string, idx: number): boolean {
    return selectedKeys.value.has(segmentKey(promptId, idx))
  }

  function toggleSegment(promptId: string, idx: number): void {
    const k = segmentKey(promptId, idx)
    const next = new Set(selectedKeys.value)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    selectedKeys.value = next
  }

  function defaultSelectedFromParsed(batch: ParsedBatch): Set<string> {
    const s = new Set<string>()
    for (const p of batch.prompts) {
      for (let i = 0; i < p.segments.length; i++) {
        const seg = p.segments[i]!
        if (seg.status === 'ok') s.add(segmentKey(p.id, i))
        // needs_review / unassigned / unknown 默认不勾选
      }
    }
    return s
  }

  async function loadDimensions(): Promise<void> {
    dimensionsLoading.value = true
    dimensionsError.value = ''
    try {
      dimensions.value = await dbGetDimensions()
    } catch (e) {
      dimensionsError.value = String(e)
      logger.warn('segmentImport', '读取维度失败：', e)
    } finally {
      dimensionsLoading.value = false
    }
  }

  watch(
    () => props.open,
    (open) => {
      if (open) {
        activeStep.value = 1
        if (dimensions.value.length === 0) void loadDimensions()
      }
    },
    { immediate: true },
  )

  function onClose(): void {
    emit('update:open', false)
  }

  async function onGenerateInstruction(): Promise<void> {
    if (rawPrompts.value.length === 0) {
      notify('请先粘贴至少一条原始 Prompt', 'warning')
      return
    }
    if (dimensions.value.length === 0) {
      await loadDimensions()
      if (dimensions.value.length === 0) {
        notify('无法读取维度，请重试', 'error')
        return
      }
    }
    try {
      const text = buildSegmentInstructionPrompt({ dimensions: dimensions.value, rawPrompts: rawPrompts.value })
      instructionText.value = text
      const ok = await copyInstructionPrompt(text)
      if (ok) notify('解析指令已复制到剪贴板', 'success', 2000)
      else notify('解析指令已生成，请手动复制', 'info', 2500)
    } catch (e) {
      logger.fail('segmentImport', `生成失败: ${String(e)}`, e)
    }
  }

  async function onCopyInstruction(): Promise<void> {
    if (!instructionText.value) {
      await onGenerateInstruction()
      return
    }
    const ok = await copyInstructionPrompt(instructionText.value)
    notify(ok ? '已复制' : '复制失败，请手动选择复制', ok ? 'success' : 'warning')
  }

  function onDownloadInstruction(): void {
    if (!instructionText.value) {
      notify('请先生成解析指令', 'warning')
      return
    }
    const blob = new Blob([instructionText.value], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const d = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    a.href = url
    a.download = `pmf-segment-instruction-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    notify('指令已下载', 'success', 1500)
  }

  function onParse(): void {
    if (!llmOutput.value.trim()) {
      notify('请先粘贴 LLM 输出', 'warning')
      return
    }
    const batch = parseAndValidate(llmOutput.value, dimensions.value)
    parsed.value = batch
    selectedKeys.value = defaultSelectedFromParsed(batch)
    currentPage.value = 1
    activeStep.value = 3
    if (batch.errors.length > 0) {
      notify(`解析完成：${batch.errors.length} 个错误，请检查`, 'warning')
    } else if (batch.prompts.length === 0) {
      notify('未解析到任何 Prompt', 'warning')
    } else {
      notify(`解析完成：${batch.prompts.length} prompts · ${batch.stats.segments} segments`, 'success', 1800)
    }
  }

  function onToJson(): void {
    if (!parsed.value) {
      const batch = parseAndValidate(llmOutput.value, dimensions.value)
      if (batch.prompts.length === 0) {
        notify('当前内容无法转为 JSON', 'warning')
        return
      }
      llmOutput.value = toSegmentsJson(batch)
      notify('已转为 pmf-segments JSON', 'success', 1500)
      return
    }
    llmOutput.value = toSegmentsJson(parsed.value)
    notify('已转为 pmf-segments JSON', 'success', 1500)
  }

  function clearRaw(): void {
    rawText.value = ''
    rawFileName.value = ''
  }

  function clearLlm(): void {
    llmOutput.value = ''
    llmFileName.value = ''
    parsed.value = null
  }

  async function onRawFileSelected(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    rawFileName.value = file.name
    const text = await file.text()
    if (file.name.toLowerCase().endsWith('.csv')) {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      const start = lines[0]?.toLowerCase().includes('prompt') ? 1 : 0
      const prompts = lines.slice(start).map((l) => {
        if (l.startsWith('"')) {
          const end = l.indexOf('",')
          if (end !== -1) return l.slice(1, end).replace(/""/g, '"')
          return l.replace(/^"|"$/g, '').replace(/""/g, '"')
        }
        const comma = l.indexOf(',')
        if (comma !== -1 && lines.length > 1) {
          const first = l.slice(0, comma).trim()
          if (first) return first.replace(/^"|"$/g, '')
        }
        return l
      }).filter(Boolean)
      rawText.value = prompts.join('\n')
    } else if (file.name.toLowerCase().endsWith('.json')) {
      try {
        const json = JSON.parse(text)
        if (Array.isArray(json)) rawText.value = (json as string[]).join('\n')
        else if (Array.isArray((json as Record<string, unknown>)['prompts'])) {
          rawText.value = ((json as Record<string, unknown>)['prompts'] as string[]).join('\n')
        } else rawText.value = text
      } catch (e) {
        logger.warn('segmentImport', 'JSON 原始文件解析失败，按纯文本处理：', e)
        rawText.value = text
      }
    } else {
      rawText.value = text
    }
    input.value = ''
  }

  async function onLlmFileSelected(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    llmFileName.value = file.name
    llmOutput.value = await file.text()
    input.value = ''
  }

  function remapDimension(promptId: string, segIdx: number, newKey: string): void {
    if (!parsed.value) return
    const p = parsed.value.prompts.find((x) => x.id === promptId)
    if (!p) return
    const seg = p.segments[segIdx]
    if (!seg) return
    seg.dimensionKey = newKey.toLowerCase()
    seg.warnings = seg.warnings.filter((w) => !w.startsWith('未知维度'))
    if (!dimKeyToDim.value.has(newKey.toLowerCase()) && newKey.toLowerCase() !== 'unassigned') {
      seg.warnings.push(`未知维度 '${newKey}'`)
      seg.status = 'warning'
    } else {
      if (seg.status === 'warning' && seg.warnings.length === 0) seg.status = 'ok'
      if (seg.status === 'error' && seg.contentEn.trim()) seg.status = 'ok'
    }
    parsed.value = { ...parsed.value, prompts: [...parsed.value.prompts] }
  }

  async function onImport(): Promise<void> {
    if (!parsed.value || parsed.value.prompts.length === 0) {
      notify('暂无可导入的解析结果', 'warning')
      return
    }
    const promptsForImport = parsed.value.prompts.map((p) => {
      const segs = p.segments
        .map((s, idx) => ({ s, idx }))
        .filter(({ s, idx }) => selectedKeys.value.has(segmentKey(p.id, idx)) && s.contentEn.trim())
        .map(({ s }) => ({
          dimensionKey: s.dimensionKey,
          dimensionId: s.dimensionId ?? null,
          contentEn: s.contentEn.trim(),
          displayName: s.displayName ?? null,
          weight: s.weight ?? null,
          isNsfw: s.isNsfw ?? false,
          notes: s.notes ?? null,
        }))
      return { id: p.id, raw: p.raw, segments: segs }
    }).filter((p) => p.segments.length > 0)

    if (promptsForImport.length === 0) {
      notify('请至少勾选一个片段后再导入', 'warning')
      return
    }

    const payload: SegmentImportPayload = {
      format: 'pmf-segments',
      formatVersion: 1,
      prompts: promptsForImport,
      unassignedStrategy: unassignedStrategy.value,
      mode: importMode.value,
    }

    importing.value = true
    try {
      const r = await dbImportSegments(payload)
      report.value = {
        modulesCreated: r.modulesCreated,
        modulesUpdated: r.modulesUpdated,
        modulesSkipped: r.modulesSkipped,
        segmentsImported: r.segmentsImported,
        segmentsSkipped: r.segmentsSkipped,
        segmentsIgnoredUnassigned: r.segmentsIgnoredUnassigned,
        errors: r.errors,
        warnings: r.warnings,
      }
      notify(`已导入 ${r.modulesCreated} 新增 · ${r.modulesUpdated} 更新 · ${r.modulesSkipped} 跳过`, 'success', 2500)
      emitImported('imported')
    } catch (e) {
      logger.fail('segmentImport', `导入失败: ${String(e)}`, e)
    } finally {
      importing.value = false
    }
  }

  function onValidateOnly(): void {
    if (!parsed.value) {
      notify('请先解析 LLM 输出', 'warning')
      return
    }
    const errs = parsed.value.errors.length + parsed.value.prompts.filter((p) => p.status === 'error').length
    const warns =
      parsed.value.warnings.length +
      parsed.value.prompts.reduce((a, p) => a + p.warnings.length + p.segments.reduce((b, s) => b + s.warnings.length, 0), 0)
    notify(`校验完成：错误 ${errs} · 警告 ${warns} · ${parsed.value.stats.prompts} prompts`, errs ? 'warning' : 'success')
  }

  return {
    // state
    rawText, rawFileName, rawPrompts, dimensions, dimensionsLoading, dimensionsError,
    instructionText, tokenEstimate, activeStep,
    llmOutput, parsed, llmFileName,
    filter, currentPage, pageSize, unassignedStrategy, importMode, selectedKeys, importing, report,
    filteredPrompts, pagedPrompts, totalPages, previewStats, selectedCount,
    // actions
    onClose, loadDimensions, isSegmentSelected, toggleSegment, remapDimension,
    onGenerateInstruction, onCopyInstruction, onDownloadInstruction,
    onParse, onToJson, clearRaw, clearLlm, onRawFileSelected, onLlmFileSelected,
    onImport, onValidateOnly,
  }
}