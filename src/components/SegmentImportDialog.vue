<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useToast } from '@/composables/useToast'
import { dbGetDimensions, dbImportSegments } from '@/lib/db'
import type { SegmentImportPayload } from '@/lib/db'
import { parseAndValidate, toSegmentsJson } from '@/lib/segmentParse'
import type { ParsedBatch, ParsedPrompt } from '@/lib/segmentParse'
import { buildSegmentInstructionPrompt, copyInstructionPrompt, estimatePromptTokens } from '@/lib/segmentPrompt'
import type { Dimension } from '@/engine/models'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'imported'): void }>()


const { push } = useToast()

// Step 1 — raw prompts
const rawText = ref('')
const rawPrompts = computed(() => rawText.value.split('\n').map(s => s.trim()).filter(Boolean))
const dimensions = ref<Dimension[]>([])
const dimensionsLoading = ref(false)
const dimensionsError = ref('')
const instructionText = ref('')
const activeStep = ref<1 | 2 | 3>(1)

// Step 2 — LLM output
const llmOutput = ref('')
const parsed = ref<ParsedBatch | null>(null)
const llmFileName = ref('')
const rawFileName = ref('')
const rawFileInput = ref<HTMLInputElement | null>(null)
const llmFileInput = ref<HTMLInputElement | null>(null)

// Step 3 — preview & import
const filter = ref<'all' | 'needs_review' | 'unassigned' | 'error'>('all')
const currentPage = ref(1)
const pageSize = 10
const unassignedStrategy = ref<'ignore' | 'to_camera' | 'prompt_new'>('ignore')
const importMode = ref<'skip' | 'overwrite'>('skip')
const selectedKeys = ref<Set<string>>(new Set())
const importing = ref(false)
const report = ref<null | { modulesCreated: number; modulesUpdated: number; modulesSkipped: number; segmentsImported: number; segmentsSkipped: number; segmentsIgnoredUnassigned: number; errors: string[]; warnings: string[] }>(null)

const tokenEstimate = computed(() => instructionText.value ? estimatePromptTokens(instructionText.value) : 0)

const filteredPrompts = computed<ParsedPrompt[]>(() => {
  if (!parsed.value) return []
  const all = parsed.value.prompts
  if (filter.value === 'all') return all
  if (filter.value === 'needs_review') return all.filter(p => p.status === 'needs_review')
  if (filter.value === 'unassigned') return all.filter(p => p.stats.unassigned > 0)
  return all.filter(p => p.status === 'error')
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
      // needs_review / unassigned / unknown remain unchecked by default per spec
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
  } finally {
    dimensionsLoading.value = false
  }
}

watch(() => props.open, (open) => {
  if (open) {
    activeStep.value = 1
    if (dimensions.value.length === 0) void loadDimensions()
  } else {
    // reset transient state on close handled in onClose
  }
}, { immediate: true })

function onClose(): void {
  emit('update:open', false)
}

async function onGenerateInstruction(): Promise<void> {
  if (rawPrompts.value.length === 0) {
    push('请先粘贴至少一条原始 Prompt', 'warning')
    return
  }
  if (dimensions.value.length === 0) {
    await loadDimensions()
    if (dimensions.value.length === 0) {
      push('无法读取维度，请重试', 'error')
      return
    }
  }
  try {
    const text = buildSegmentInstructionPrompt({ dimensions: dimensions.value, rawPrompts: rawPrompts.value })
    instructionText.value = text
    const ok = await copyInstructionPrompt(text)
    if (ok) push('解析指令已复制到剪贴板', 'success', 2000)
    else push('解析指令已生成，请手动复制', 'info', 2500)
  } catch (e) {
    push(`生成失败: ${String(e)}`, 'error')
  }
}

async function onCopyInstruction(): Promise<void> {
  if (!instructionText.value) {
    await onGenerateInstruction()
    return
  }
  const ok = await copyInstructionPrompt(instructionText.value)
  push(ok ? '已复制' : '复制失败，请手动选择复制', ok ? 'success' : 'warning')
}

function onDownloadInstruction(): void {
  if (!instructionText.value) {
    push('请先生成解析指令', 'warning')
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
  push('指令已下载', 'success', 1500)
}

function onParse(): void {
  if (!llmOutput.value.trim()) {
    push('请先粘贴 LLM 输出', 'warning')
    return
  }
  const batch = parseAndValidate(llmOutput.value, dimensions.value)
  parsed.value = batch
  selectedKeys.value = defaultSelectedFromParsed(batch)
  currentPage.value = 1
  activeStep.value = 3
  if (batch.errors.length > 0) {
    push(`解析完成：${batch.errors.length} 个错误，请检查`, 'warning')
  } else if (batch.prompts.length === 0) {
    push('未解析到任何 Prompt', 'warning')
  } else {
    push(`解析完成：${batch.prompts.length} prompts · ${batch.stats.segments} segments`, 'success', 1800)
  }
}

function onToJson(): void {
  if (!parsed.value) {
    // try to parse tagged and show json
    const batch = parseAndValidate(llmOutput.value, dimensions.value)
    if (batch.prompts.length === 0) {
      push('当前内容无法转为 JSON', 'warning')
      return
    }
    llmOutput.value = toSegmentsJson(batch)
    push('已转为 pmf-segments JSON', 'success', 1500)
    return
  }
  llmOutput.value = toSegmentsJson(parsed.value)
  push('已转为 pmf-segments JSON', 'success', 1500)
}

async function onRawFileSelected(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  rawFileName.value = file.name
  const text = await file.text()
  // CSV: first column is prompt
  if (file.name.toLowerCase().endsWith('.csv')) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    // simple: if first line looks like header, skip
    const start = lines[0]?.toLowerCase().includes('prompt') ? 1 : 0
    const prompts = lines.slice(start).map(l => {
      // naive CSV split on first comma, handling quoted
      if (l.startsWith('"')) {
        const end = l.indexOf('",')
        if (end !== -1) return l.slice(1, end).replace(/""/g, '"')
        return l.replace(/^"|"$/g, '').replace(/""/g, '"')
      }
      const comma = l.indexOf(',')
      if (comma !== -1 && lines.length > 1) {
        // treat as CSV with multiple columns: take first non-empty
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
      else if (Array.isArray((json as Record<string, unknown>)['prompts'])) rawText.value = ((json as Record<string, unknown>)['prompts'] as string[]).join('\n')
      else rawText.value = text
    } catch {
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
  const p = parsed.value.prompts.find(x => x.id === promptId)
  if (!p) return
  const seg = p.segments[segIdx]
  if (!seg) return
  seg.dimensionKey = newKey.toLowerCase()
  seg.warnings = seg.warnings.filter(w => !w.startsWith('未知维度'))
  if (!dimKeyToDim.value.has(newKey.toLowerCase()) && newKey.toLowerCase() !== 'unassigned') {
    seg.warnings.push(`未知维度 '${newKey}'`)
    seg.status = 'warning'
  } else {
    if (seg.status === 'warning' && seg.warnings.length === 0) seg.status = 'ok'
    if (seg.status === 'error' && seg.contentEn.trim()) seg.status = 'ok'
  }
  // force reactivity
  parsed.value = { ...parsed.value, prompts: [...parsed.value.prompts] }
}

async function onImport(): Promise<void> {
  if (!parsed.value || parsed.value.prompts.length === 0) {
    push('暂无可导入的解析结果', 'warning')
    return
  }
  const promptsForImport = parsed.value.prompts.map(p => {
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
  }).filter(p => p.segments.length > 0)

  if (promptsForImport.length === 0) {
    push('请至少勾选一个片段后再导入', 'warning')
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
    push(`已导入 ${r.modulesCreated} 新增 · ${r.modulesUpdated} 更新 · ${r.modulesSkipped} 跳过`, 'success', 2500)
    emit('imported')
  } catch (e) {
    push(`导入失败: ${String(e)}`, 'error')
  } finally {
    importing.value = false
  }
}

async function onValidateOnly(): Promise<void> {
  if (!parsed.value) {
    push('请先解析 LLM 输出', 'warning')
    return
  }
  const errs = parsed.value.errors.length + parsed.value.prompts.filter(p => p.status === 'error').length
  const warns = parsed.value.warnings.length + parsed.value.prompts.reduce((a, p) => a + p.warnings.length + p.segments.reduce((b, s) => b + s.warnings.length, 0), 0)
  push(`校验完成：错误 ${errs} · 警告 ${warns} · ${parsed.value.stats.prompts} prompts`, errs ? 'warning' : 'success')
}

const previewStats = computed(() => {
  if (!parsed.value) return null
  const total = parsed.value.stats.segments
  const unassigned = parsed.value.stats.unassigned
  const needsReview = parsed.value.prompts.filter(p => p.status === 'needs_review').length
  const errors = parsed.value.prompts.filter(p => p.status === 'error').length + parsed.value.errors.length
  // estimate new vs existing would require DB hit; we show counts from parse only
  return { total, unassigned, needsReview, errors, prompts: parsed.value.stats.prompts }
})

const selectedCount = computed(() => selectedKeys.value.size)
</script>

<template>
  <div
    data-testid="segment-import-dialog"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    @click.self="onClose"
  >
    <div
      data-testid="segment-import-overlay"
      class="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border bg-background shadow-xl"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b px-4 py-3">
        <h2 class="text-base font-semibold">分段导入</h2>
        <Button data-testid="segment-import-close" variant="ghost" size="sm" @click="onClose">✕</Button>
      </div>

      <!-- Step tabs -->
      <div class="flex shrink-0 items-center gap-1 border-b px-2 py-2 text-xs">
        <button
          data-testid="segment-step-1"
          class="rounded px-3 py-1.5 font-medium"
          :class="activeStep === 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'"
          @click="activeStep = 1"
        >① 输入原始串</button>
        <span class="text-muted-foreground">→</span>
        <button
          data-testid="segment-step-2"
          class="rounded px-3 py-1.5 font-medium"
          :class="activeStep === 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'"
          @click="activeStep = 2"
        >② 粘贴 LLM 输出</button>
        <span class="text-muted-foreground">→</span>
        <button
          data-testid="segment-step-3"
          class="rounded px-3 py-1.5 font-medium"
          :class="activeStep === 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'"
          @click="activeStep = 3"
        >③ 预览与导入</button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <!-- Step 1 -->
        <section v-if="activeStep === 1" data-testid="segment-step1" class="space-y-3">
          <div class="flex items-center justify-between">
            <p class="text-sm font-medium">① 输入原始提示词</p>
            <span class="text-xs text-muted-foreground" title="说明">每行一条完整 Prompt，也可粘贴多行</span>
          </div>
          <textarea
            data-testid="segment-raw-textarea"
            :value="rawText"
            placeholder="每行一条完整 Prompt，也可粘贴多行&#10;例：slim waist, long legs, oval face with natural..."
            class="min-h-[120px] w-full rounded-md border bg-background p-2 text-sm"
            rows="5"
            @input="rawText = ($event.target as HTMLTextAreaElement).value"
          />
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <input ref="rawFileInput" data-testid="segment-raw-file-input" type="file" accept=".txt,.csv,.json,text/plain" class="hidden" @change="onRawFileSelected" />
            <Button variant="outline" size="sm" class="h-7 text-xs" @click="rawFileInput?.click()">
              选择 .txt/.csv
            </Button>
            <Button variant="ghost" size="sm" class="h-7 text-xs" @click="rawText = ''; rawFileName = ''">清空</Button>
            <span data-testid="segment-raw-count" class="text-muted-foreground">已读 {{ rawPrompts.length }} 条</span>
            <span v-if="rawFileName" class="truncate text-muted-foreground">{{ rawFileName }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="text-muted-foreground">维度 {{ dimensions.length || '—' }} · 已启用 {{ dimensions.filter(d=>d.isEnabled).length }}</span>
            <span v-if="dimensionsError" class="text-red-500">无法读取维度：{{ dimensionsError }}</span>
            <span v-if="dimensionsLoading" class="text-muted-foreground">加载中…</span>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button data-testid="segment-generate-btn" size="sm" @click="onGenerateInstruction">生成解析指令</Button>
            <Button data-testid="segment-copy-instruction-btn" variant="outline" size="sm" @click="onCopyInstruction">复制指令</Button>
            <Button data-testid="segment-download-instruction-btn" variant="outline" size="sm" @click="onDownloadInstruction">下载指令 .md</Button>
          </div>
          <Card v-if="instructionText" data-testid="segment-instruction-preview" class="max-h-64 overflow-auto p-3">
            <pre class="whitespace-pre-wrap break-words text-xs">{{ instructionText }}</pre>
            <p class="mt-2 text-xs text-muted-foreground">预估 token：约 {{ tokenEstimate }}</p>
          </Card>
          <p class="text-xs text-muted-foreground">提示：复制指令后粘贴到任意 LLM，令其“只输出 JSON”</p>
        </section>

        <!-- Step 2 -->
        <section v-if="activeStep === 2" data-testid="segment-step2" class="space-y-3">
          <p class="text-sm font-medium">② 粘贴 LLM 输出（pmf-segments JSON 或 Tagged）</p>
          <textarea
            data-testid="segment-llm-textarea"
            :value="llmOutput"
            placeholder="粘贴 LLM 返回的 JSON，或 [body] ... 形式的 Tagged 文本"
            class="min-h-[160px] w-full rounded-md border bg-background p-2 font-mono text-xs"
            rows="8"
            @input="llmOutput = ($event.target as HTMLTextAreaElement).value"
          />
          <div class="flex flex-wrap items-center gap-2">
            <input ref="llmFileInput" data-testid="segment-llm-file-input" type="file" accept=".json,.txt" class="hidden" @change="onLlmFileSelected" />
            <Button variant="outline" size="sm" class="h-7 text-xs" @click="llmFileInput?.click()">选择 .json/.txt</Button>
            <Button data-testid="segment-to-json-btn" variant="outline" size="sm" class="h-7 text-xs" @click="onToJson">转为 JSON</Button>
            <Button variant="ghost" size="sm" class="h-7 text-xs" @click="llmOutput = ''; llmFileName = ''; parsed = null">清空</Button>
            <span v-if="llmFileName" class="text-xs text-muted-foreground">{{ llmFileName }}</span>
          </div>
          <div v-if="parsed" data-testid="segment-detect-badge" class="flex flex-wrap gap-2 text-xs">
            <span class="rounded bg-muted px-2 py-1">探测：{{ parsed.kind === 'tagged' ? 'Tagged ✓' : 'JSON ✓' }}</span>
            <span class="rounded bg-muted px-2 py-1">{{ parsed.stats.prompts }} prompts · {{ parsed.stats.segments }} segments</span>
            <span v-if="parsed.errors.length" class="rounded bg-red-100 px-2 py-1 text-red-700">错误：{{ parsed.errors.length }}</span>
            <span v-if="parsed.warnings.length" class="rounded bg-amber-100 px-2 py-1 text-amber-800">警告：{{ parsed.warnings.length }}</span>
          </div>
          <p v-if="parsed && parsed.errors.length" class="text-xs text-red-500">{{ parsed.errors[0] }}</p>
          <Button data-testid="segment-parse-btn" size="sm" @click="onParse">解析并预览 →</Button>
        </section>

        <!-- Step 3 -->
        <section v-if="activeStep === 3" data-testid="segment-step3" class="space-y-3">
          <div class="flex items-center justify-between">
            <p class="text-sm font-medium">③ 预览与导入</p>
            <select data-testid="segment-filter" :value="filter" class="rounded border bg-background px-2 py-1 text-xs" @change="filter = ($event.target as HTMLSelectElement).value as typeof filter; currentPage = 1">
              <option value="all">全部</option>
              <option value="needs_review">待复核</option>
              <option value="unassigned">未分配</option>
              <option value="error">错误</option>
            </select>
          </div>

          <div v-if="previewStats" data-testid="segment-stats" class="rounded-md border bg-muted/30 p-2 text-xs">
            统计：{{ previewStats.prompts }} prompts · {{ previewStats.total }} segments · {{ previewStats.unassigned }} unassigned · {{ previewStats.needsReview }} 待复核 · {{ previewStats.errors }} 错误 · 已勾选 {{ selectedCount }}
          </div>
          <div v-if="previewStats" class="flex flex-wrap gap-1 text-xs">
            <button class="rounded bg-muted px-2 py-1 hover:bg-accent" :class="filter === 'all' ? 'bg-primary text-primary-foreground' : ''" @click="filter = 'all'; currentPage = 1">全部</button>
            <button class="rounded bg-muted px-2 py-1 hover:bg-accent" :class="filter === 'needs_review' ? 'bg-primary text-primary-foreground' : ''" @click="filter = 'needs_review'; currentPage = 1">待复核</button>
            <button class="rounded bg-muted px-2 py-1 hover:bg-accent" :class="filter === 'unassigned' ? 'bg-primary text-primary-foreground' : ''" @click="filter = 'unassigned'; currentPage = 1">未分配</button>
            <button class="rounded bg-muted px-2 py-1 hover:bg-accent" :class="filter === 'error' ? 'bg-primary text-primary-foreground' : ''" @click="filter = 'error'; currentPage = 1">错误</button>
          </div>

          <div data-testid="segment-preview" class="space-y-2">
            <p v-if="!parsed || parsed.prompts.length === 0" class="py-6 text-center text-xs text-muted-foreground">暂无预览 — 请先在第 2 步粘贴并解析 LLM 输出</p>
            <template v-else>
              <div
                v-for="p in pagedPrompts"
                :key="p.id"
                :data-testid="`segment-prompt-card-${p.id}`"
                class="rounded-md border p-2"
                :class="p.status === 'error' ? 'border-red-300 bg-red-50 dark:bg-red-950/30' : p.status === 'needs_review' ? 'border-amber-200 bg-amber-50/50 dark:bg-amber-950/20' : 'bg-card'"
              >
                <p class="truncate text-xs text-muted-foreground" :title="p.raw">raw: {{ p.raw.slice(0, 120) }}{{ p.raw.length > 120 ? '…' : '' }}</p>
                <p v-if="p.warnings.length" class="mt-1 text-xs text-amber-700">{{ p.warnings.join('；') }}</p>
                <p v-if="p.errors.length" class="mt-1 text-xs text-red-600">{{ p.errors.join('；') }}</p>
                <div class="mt-2 space-y-1">
                  <div
                    v-for="(s, idx) in p.segments"
                    :key="idx"
                    :data-testid="`segment-row-${p.id}-${idx}`"
                    class="flex items-center gap-2 rounded px-2 py-1 text-xs"
                    :class="s.dimensionKey === 'unassigned' ? 'bg-amber-100 dark:bg-amber-950/40' : s.status === 'error' ? 'bg-red-100 dark:bg-red-950/40' : s.status === 'warning' ? 'bg-amber-50 dark:bg-amber-950/20' : 'bg-muted/40'"
                  >
                    <input
                      :data-testid="`segment-row-checkbox-${p.id}-${idx}`"
                      type="checkbox"
                      :checked="isSegmentSelected(p.id, idx)"
                      @change="toggleSegment(p.id, idx)"
                    />
                    <span class="rounded bg-background px-1.5 py-0.5 font-mono text-[11px]">[{{ s.dimensionKey }}]</span>
                    <span class="min-w-0 flex-1 truncate" :title="s.contentEn">{{ s.contentEn }}</span>
                    <span v-if="s.weight != null && s.weight !== 1" class="shrink-0 text-muted-foreground">w{{ s.weight }}</span>
                    <span v-if="s.isNsfw" class="h-2 w-2 shrink-0 rounded-full bg-red-500" title="NSFW" />
                    <span v-if="s.warnings.length" class="shrink-0 text-amber-600" :title="s.warnings.join('；')">⚠</span>
                    <select
                      v-if="s.status === 'warning' || s.status === 'error'"
                      class="max-w-[110px] shrink-0 rounded border bg-background px-1 py-0.5 text-[11px]"
                      :value="s.dimensionKey"
                      @change="remapDimension(p.id, idx, ($event.target as HTMLSelectElement).value)"
                    >
                      <option v-for="d in dimensions" :key="d.key" :value="d.key">{{ d.key }}</option>
                      <option value="unassigned">unassigned</option>
                    </select>
                  </div>
                </div>
                <p class="mt-1 text-xs text-muted-foreground">维度未知：{{ p.stats.unknownDimension }} · 未分配：{{ p.stats.unassigned }}</p>
              </div>
              <div v-if="filteredPrompts.length > pageSize" class="flex items-center justify-center gap-2 text-xs">
                <Button variant="outline" size="sm" class="h-7" :disabled="currentPage <= 1" @click="currentPage--">‹</Button>
                <span>{{ currentPage }} / {{ totalPages }}</span>
                <Button variant="outline" size="sm" class="h-7" :disabled="currentPage >= totalPages" @click="currentPage++">›</Button>
                <span class="text-muted-foreground">每页 {{ pageSize }} prompts</span>
              </div>
            </template>
          </div>

          <div class="space-y-2 rounded-md border bg-muted/20 p-2 text-xs">
            <div class="flex flex-wrap items-center gap-3">
              <span class="font-medium">未分配处理：</span>
              <label class="flex items-center gap-1"><input type="radio" value="ignore" :checked="unassignedStrategy === 'ignore'" data-testid="segment-unassigned-ignore" @change="unassignedStrategy = 'ignore'" /> 忽略</label>
              <label class="flex items-center gap-1"><input type="radio" value="to_camera" :checked="unassignedStrategy === 'to_camera'" data-testid="segment-unassigned-to-camera" @change="unassignedStrategy = 'to_camera'" /> 归入 camera</label>
              <label class="flex items-center gap-1"><input type="radio" value="prompt_new" :checked="unassignedStrategy === 'prompt_new'" data-testid="segment-unassigned-prompt-new" @change="unassignedStrategy = 'prompt_new'" /> 提示新建维度</label>
            </div>
            <div class="flex flex-wrap items-center gap-3" data-testid="segment-import-mode">
              <span class="font-medium">去重命中“已存在”的词条：</span>
              <label class="flex items-center gap-1"><input type="radio" value="skip" :checked="importMode === 'skip'" data-testid="segment-mode-skip" @change="importMode = 'skip'" /> 跳过</label>
              <label class="flex items-center gap-1"><input type="radio" value="overwrite" :checked="importMode === 'overwrite'" data-testid="segment-mode-overwrite" @change="importMode = 'overwrite'" /> 覆盖更新</label>
            </div>
          </div>

          <div class="flex gap-2">
            <Button data-testid="segment-validate-btn" variant="outline" size="sm" @click="onValidateOnly">仅校验</Button>
            <Button data-testid="segment-import-btn" size="sm" :disabled="importing || selectedCount === 0" @click="onImport">
              {{ importing ? '导入中…' : `导入勾选项 ${selectedCount} 条` }}
            </Button>
          </div>

          <div v-if="report" data-testid="segment-report" class="rounded-md border bg-muted/30 p-3 text-xs">
            <p class="font-medium">导入报告</p>
            <p data-testid="segment-report-modules">词条：新增 {{ report.modulesCreated }} · 更新 {{ report.modulesUpdated }} · 跳过 {{ report.modulesSkipped }}</p>
            <p>片段：导入 {{ report.segmentsImported }} · 跳过 {{ report.segmentsSkipped }} · 已忽略未分配 {{ report.segmentsIgnoredUnassigned }}</p>
            <p v-if="report.errors.length" data-testid="segment-report-errors" class="mt-1 text-red-600">错误：{{ report.errors.slice(0, 3).join('；') }}{{ report.errors.length > 3 ? ` …（共 ${report.errors.length} 条）` : '' }}</p>
            <p v-if="report.warnings.length" class="mt-1 text-amber-700">警告：{{ report.warnings.slice(0, 3).join('；') }}{{ report.warnings.length > 3 ? ` …（共 ${report.warnings.length} 条）` : '' }}</p>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
