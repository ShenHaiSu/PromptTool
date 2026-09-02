<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/composables/useToast'
import { emit, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import { dbBatchUpdateDisplayNames } from '@/lib/db'
import type { TranslationUpdateReport } from '@/lib/db'
import {
  buildAllTranslationPrompts,
  buildTranslationExportContent,
  buildTranslationExportFilename,
  estimateTranslationTokens,
  TRANSLATION_CHUNK_SIZE_DEFAULT,
  TRANSLATION_CHUNK_SIZE_OPTIONS,
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

const props = defineProps<{
  open: boolean
  dimension: Dimension | null
  modules: Module[]
}>()
const emitDlg = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'applied', report: TranslationUpdateReport): void
}>()

const { push } = useToast()

function loadChunkSize(): number {
  try {
    const v = Number(localStorage.getItem(TRANSLATION_LS_CHUNK_SIZE))
    if (v === 30 || v === 50) return v
  } catch {}
  return TRANSLATION_CHUNK_SIZE_DEFAULT
}
function loadStep(): 1 | 2 | 3 {
  try {
    const v = Number(localStorage.getItem(TRANSLATION_LS_STEP))
    if (v === 1 || v === 2 || v === 3) return v as 1 | 2 | 3
  } catch {}
  return 1
}

const chunkSize = ref<number>(loadChunkSize())
const activeStep = ref<1 | 2 | 3>(loadStep())
watch(chunkSize, (v) => { try { localStorage.setItem(TRANSLATION_LS_CHUNK_SIZE, String(v)) } catch {} })
watch(activeStep, (v) => { try { localStorage.setItem(TRANSLATION_LS_STEP, String(v)) } catch {} })

const previewChunkIndex = ref(0)
const rawResultText = ref('')
const resultFileInput = ref<HTMLInputElement | null>(null)
const parsed = ref<ParsedTranslation | null>(null)
const applying = ref(false)
const report = ref<TranslationUpdateReport | null>(null)

// filter/search/pagination for Step3 preview
const filter = ref<'all' | 'ok' | 'unknown' | 'empty' | 'duplicate'>('all')
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
  try { await navigator.clipboard.writeText(text); return true } catch {
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
    } catch { return false }
  }
}

async function onCopyChunk(cId: string): Promise<void> {
  const idx = chunks.value.findIndex((c) => c.chunkId === cId)
  const text = prompts.value[idx] ?? ''
  if (!text) { push('该片无内容', 'warning'); return }
  const ok = await copyText(text)
  push(ok ? `已复制片 ${cId}` : '复制失败，请手动选择复制', ok ? 'success' : 'warning', 1500)
}
async function onCopyAll(): Promise<void> {
  if (!exportContent.value) { push('暂无可复制内容', 'warning'); return }
  const ok = await copyText(exportContent.value)
  push(ok ? `已复制全部 ${totalChunks.value} 片` : '复制失败', ok ? 'success' : 'warning', 1500)
}
function onDownload(): void {
  if (!props.dimension) return
  if (!exportContent.value) { push('暂无可下载内容', 'warning'); return }
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
  push('已下载', 'success', 1500)
}
async function onResultFileSelected(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const text = await file.text()
  rawResultText.value = rawResultText.value ? `${rawResultText.value}\n${text}` : text
  push(`已读取 ${file.name}`, 'info', 1500)
  input.value = ''
}
function onParse(): void {
  if (!rawResultText.value.trim()) { push('请先粘贴 LLM 返回的 JSON', 'warning'); return }
  if (!props.dimension) { push('维度不存在', 'error'); return }
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
    push(`解析失败：${merge.errors[0]}`, 'warning')
    return
  }
  const validated = validateTranslationBatch(merge, { dimension: props.dimension, modules: props.modules })
  parsed.value = validated
  report.value = null
  curPage.value = 1
  activeStep.value = 3
  const hit = validated.stats.hit
  const total = validated.stats.totalUnique
  if (validated.errors.length) push(`解析完成：${validated.errors.length} 个错误`, 'warning')
  else push(`解析完成：${total} 唯一 id · 命中 ${hit}`, 'success', 1800)
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
function confirmEdit(row: TranslationRow): void {
  const v = editingValue.value.trim()
  if (!v) { push('中文不能为空', 'warning'); return }
  const truncated = [...v].length > 500 ? [...v].slice(0, 500).join('') : v
  row.newZh = truncated
  if ([...v].length > 500) push('已截断至 500 字符', 'warning')
  // re-validate empty
  if (!row.newZh.trim()) { row.status = 'emptyZh'; row.selected = false }
  else if (row.status === 'emptyZh') { row.status = 'ok'; row.selected = true }
  editingId.value = null
  if (parsed.value) parsed.value = { ...parsed.value, rows: [...parsed.value.rows] }
}
function cancelEdit(): void { editingId.value = null }

async function onApply(): Promise<void> {
  if (!props.dimension) { push('维度不存在', 'error'); return }
  if (!parsed.value) { push('请先解析', 'warning'); return }
  const items = parsed.value.rows.filter((r) => r.selected && r.status === 'ok').map((r) => ({ id: r.id, displayName: r.newZh.trim() })).filter((i) => i.displayName.length > 0)
  if (items.length === 0) { push('请至少勾选一条合法结果', 'warning'); return }
  if (items.length > 1000) { push('单次更新不超过 1000 条，请取消部分勾选后分批', 'warning'); return }
  applying.value = true
  try {
    const rep = await dbBatchUpdateDisplayNames({ dimensionId: props.dimension.id, items })
    report.value = rep
    if (rep.updated > 0) {
      emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: 'batch-update-display-names' })
      emitDlg('applied', rep)
      push(`已更新 ${rep.updated} 条中文描述`, 'success', 2000)
    } else {
      push('未更新任何条目，请查看报告', 'warning')
    }
    if (rep.errors.length) push(rep.errors.slice(0, 2).join('；'), 'warning', 2500)
  } catch (e) {
    push(`回填失败: ${String(e)}`, 'error')
  } finally {
    applying.value = false
  }
}

function onChunkSizeChange(e: Event): void {
  const v = Number((e.target as HTMLSelectElement).value)
  if (v === 30 || v === 50) { chunkSize.value = v; previewChunkIndex.value = 0 }
}
</script>

<template>
  <div
    v-if="open"
    data-testid="translate-dialog"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    @click.self="onClose"
  >
    <div
      data-testid="translate-dialog-overlay"
      class="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-lg border bg-background shadow-xl"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b px-4 py-3">
        <h2 class="text-sm font-semibold">
          批量翻译 — {{ dimension ? `${dimension.nameCn} / ${dimension.key}` : '—' }}
          <span class="ml-2 text-xs font-normal text-muted-foreground">{{ modules.length }} 条 · 分 {{ totalChunks }} 片（{{ chunkSize }}/片）</span>
        </h2>
        <Button data-testid="translate-close" variant="ghost" size="sm" @click="onClose">✕</Button>
      </div>

      <!-- Step tabs -->
      <div class="flex shrink-0 items-center gap-1 border-b px-2 py-2 text-xs">
        <button class="rounded px-3 py-1.5 font-medium" :class="activeStep === 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'" @click="activeStep = 1">① 生成聚合提示词</button>
        <span class="text-muted-foreground">→</span>
        <button class="rounded px-3 py-1.5 font-medium" :class="activeStep === 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'" @click="activeStep = 2">② 粘贴 LLM 结果</button>
        <span class="text-muted-foreground">→</span>
        <button class="rounded px-3 py-1.5 font-medium" :class="activeStep === 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'" @click="activeStep = 3">③ 预览与回填</button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <!-- Step 1 -->
        <section v-if="activeStep === 1" data-testid="translate-step-1" class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm font-medium">① 生成聚合提示词</p>
            <div class="flex items-center gap-2 text-xs">
              <span class="text-muted-foreground">分片尺寸</span>
              <select data-testid="translate-chunk-size" :value="String(chunkSize)" class="rounded border bg-background px-2 py-1 text-xs" @change="onChunkSizeChange">
                <option v-for="o in TRANSLATION_CHUNK_SIZE_OPTIONS" :key="o" :value="String(o)">{{ o }} / 片</option>
              </select>
              <span class="text-muted-foreground">仅本维度</span>
            </div>
          </div>

          <div v-if="modules.length === 0" class="rounded-md border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
            该维度暂无词条，无需翻译
          </div>
          <template v-else>
            <div class="flex flex-wrap gap-2 text-xs">
              <Button data-testid="translate-copy-all" variant="outline" size="sm" class="h-7" @click="onCopyAll">复制全部 {{ totalChunks }} 片</Button>
              <Button data-testid="translate-download" variant="outline" size="sm" class="h-7" @click="onDownload">下载全部</Button>
              <Button variant="ghost" size="sm" class="h-7" @click="activeStep = 2">下一步 →</Button>
            </div>

            <div class="space-y-1">
              <div
                v-for="c in chunks"
                :key="c.chunkId"
                :data-testid="`translate-chunk-row-${c.chunkId}`"
                class="flex items-center justify-between rounded border px-3 py-2 text-xs"
              >
                <span>片 {{ c.chunkId }}/{{ totalChunks }} — {{ c.modules.length }} 条 — 预估 {{ estimateTranslationTokens(prompts[chunks.findIndex(x=>x.chunkId===c.chunkId)] ?? '') }} tokens</span>
                <span class="flex gap-1">
                  <Button :data-testid="`translate-copy-chunk-${c.chunkId}`" variant="ghost" size="sm" class="h-6 px-2 text-xs" @click="onCopyChunk(c.chunkId)">复制本片</Button>
                  <Button variant="ghost" size="sm" class="h-6 px-2 text-xs" @click="previewChunkIndex = chunks.findIndex(x=>x.chunkId===c.chunkId);">预览</Button>
                </span>
              </div>
            </div>

            <Card v-if="previewText" data-testid="translate-prompt-preview" class="max-h-64 overflow-auto p-3">
              <pre class="whitespace-pre-wrap break-words text-xs">{{ previewText }}</pre>
              <p class="mt-2 text-xs text-muted-foreground">预估 token：约 {{ previewTokens }}</p>
            </Card>
          </template>
        </section>

        <!-- Step 2 -->
        <section v-if="activeStep === 2" data-testid="translate-step-2" class="space-y-3">
          <p class="text-sm font-medium">② 粘贴 LLM 结果（支持一次贴多片、含 ```json fence、含多余解释）</p>
          <textarea
            data-testid="translate-result-textarea"
            :value="rawResultText"
            placeholder="粘贴 LLM 返回的 JSON（支持一次贴多片、含 ```json fence、含多余解释）"
            class="min-h-[160px] w-full rounded-md border bg-background p-2 font-mono text-xs"
            rows="8"
            @input="rawResultText = ($event.target as HTMLTextAreaElement).value"
          />
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <input ref="resultFileInput" data-testid="translate-result-file-input" type="file" accept=".json,.txt,text/plain" class="hidden" @change="onResultFileSelected" />
            <Button variant="outline" size="sm" class="h-7 text-xs" @click="resultFileInput?.click()">选择 .json/.txt</Button>
            <Button variant="ghost" size="sm" class="h-7 text-xs" @click="onClearRaw">清空</Button>
            <span class="rounded bg-muted px-2 py-1">已粘贴 {{ rawResultText.length }} 字符 · 探测到约 {{ detectedBlocks }} 个 zh 字段</span>
          </div>
          <div class="flex gap-2">
            <Button data-testid="translate-parse-btn" size="sm" @click="onParse">解析并预览 →</Button>
            <Button data-testid="translate-validate-btn" variant="outline" size="sm" @click="onParse">校验</Button>
          </div>
          <p v-if="parsed && parsed.errors.length" class="text-xs text-red-600">{{ parsed.errors[0] }}</p>
        </section>

        <!-- Step 3 -->
        <section v-if="activeStep === 3" data-testid="translate-step-3" class="space-y-3">
          <div class="flex items-center justify-between">
            <p class="text-sm font-medium">③ 预览与回填</p>
            <span v-if="parsed" data-testid="translate-stats" class="rounded bg-muted px-2 py-1 text-xs">
              共 {{ parsed.stats.totalUnique }} 唯一 id · 本维度命中 {{ parsed.stats.hit }} · 非本维度 {{ parsed.stats.unknown }} · 重复 {{ parsed.stats.duplicate }} · 空中文 {{ parsed.stats.empty }}
            </span>
          </div>

          <div v-if="!parsed" class="py-6 text-center text-xs text-muted-foreground">暂无预览 — 请先在第 2 步粘贴并解析 LLM 输出</div>
          <template v-else>
            <div class="flex flex-wrap items-center gap-2">
              <div data-testid="translate-filter" class="flex gap-1 text-xs">
                <button class="rounded px-2 py-1" :class="filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="filter = 'all'">全部</button>
                <button class="rounded px-2 py-1" :class="filter === 'ok' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="filter = 'ok'">待复核</button>
                <button class="rounded px-2 py-1" :class="filter === 'unknown' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="filter = 'unknown'">非本维度</button>
                <button class="rounded px-2 py-1" :class="filter === 'duplicate' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="filter = 'duplicate'">重复</button>
                <button class="rounded px-2 py-1" :class="filter === 'empty' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="filter = 'empty'">空值</button>
              </div>
              <Input v-model="search" placeholder="搜索 id / 英文 / 中文…" class="h-7 max-w-[200px] text-xs" />
            </div>

            <div class="flex flex-wrap gap-1 text-xs">
              <Button variant="outline" size="sm" class="h-7" @click="selectAllValid">全选合法</Button>
              <Button variant="outline" size="sm" class="h-7" @click="deselectAll">取消全选</Button>
              <Button variant="outline" size="sm" class="h-7" @click="selectCurrentPage">仅选当前页</Button>
              <Button variant="outline" size="sm" class="h-7" @click="invertSelection">反选</Button>
              <span class="px-2 py-1 text-muted-foreground">已选 {{ selectedCount }} 条</span>
            </div>

            <div data-testid="translate-preview" class="max-h-[320px] overflow-auto rounded border">
              <p v-if="filteredRows.length === 0" class="py-6 text-center text-xs text-muted-foreground">无匹配行</p>
              <template v-else>
                <div
                  v-for="r in pagedRows"
                  :key="r.id"
                  :data-testid="`translate-row-${r.id}`"
                  class="flex items-center gap-2 border-b px-2 py-1.5 text-xs last:border-0"
                  :class="r.status === 'unknownId' ? 'bg-amber-50/70 dark:bg-amber-950/20' : r.status === 'emptyZh' ? 'bg-red-50 dark:bg-red-950/20' : 'bg-card'"
                >
                  <input
                    :data-testid="`translate-row-checkbox-${r.id}`"
                    type="checkbox"
                    :checked="r.selected"
                    :disabled="r.status !== 'ok'"
                    @change="setRowSelected(r.id, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="w-28 shrink-0 truncate font-mono text-[11px]" :title="r.id">[{{ r.id }}]</span>
                  <span class="min-w-0 flex-1 truncate text-muted-foreground" :title="r.contentEn">{{ r.contentEn || '—' }}</span>
                  <span class="text-muted-foreground">→</span>
                  <span v-if="editingId !== r.id" class="min-w-0 flex-1 truncate font-medium" :title="r.newZh" @click="r.status === 'ok' && startEdit(r)">{{ r.newZh }}</span>
                  <Input
                    v-else
                    :model-value="editingValue"
                    class="h-6 flex-1 text-xs"
                    @update:model-value="editingValue = String($event)"
                    @keydown.enter="confirmEdit(r)"
                    @keydown.escape="cancelEdit()"
                    @blur="confirmEdit(r)"
                  />
                  <span class="hidden max-w-[120px] truncate text-[11px] text-muted-foreground sm:inline" :title="r.oldDisplayName">{{ r.oldDisplayName }}</span>
                  <span
                    class="shrink-0 rounded px-1.5 py-0.5 text-[11px]"
                    :class="r.status === 'ok' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-100' : r.status === 'unknownId' ? 'bg-amber-100 text-amber-800' : r.status === 'emptyZh' ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground'"
                  >{{ r.status === 'ok' ? '待回填' : r.status === 'unknownId' ? '非本维度' : r.status === 'emptyZh' ? '空值' : '重复' }}</span>
                  <span v-if="r.warnings.length" class="shrink-0 text-amber-600" :title="r.warnings.join('；')">⚠</span>
                </div>
                <div v-if="filteredRows.length > pageSize" class="flex items-center justify-center gap-2 p-2 text-xs">
                  <Button variant="outline" size="sm" class="h-7" :disabled="curPage <= 1" @click="curPage--">‹</Button>
                  <span>{{ curPage }} / {{ totalPages }}</span>
                  <Button variant="outline" size="sm" class="h-7" :disabled="curPage >= totalPages" @click="curPage++">›</Button>
                </div>
              </template>
            </div>

            <div class="flex gap-2">
              <Button data-testid="translate-apply-btn" size="sm" :disabled="!canApply" @click="onApply">{{ applying ? '应用中…' : `应用到词库（${selectedCount} 条）` }}</Button>
              <Button variant="outline" size="sm" @click="activeStep = 2">返回修改</Button>
              <Button variant="ghost" size="sm" @click="onClearAll">清空重来</Button>
            </div>

            <div v-if="parsed.warnings.length" class="text-xs text-amber-700">警告：{{ parsed.warnings.slice(0, 3).join('；') }}</div>
            <div v-if="parsed.errors.length" class="text-xs text-red-600">错误：{{ parsed.errors.slice(0, 3).join('；') }}</div>

            <div v-if="report" data-testid="translate-report" class="rounded-md border bg-muted/30 p-3 text-xs">
              <p class="font-medium">回填报告</p>
              <p>成功 {{ report.updated }} · 跳过 {{ report.skipped }} · 请求 {{ report.totalRequested }}</p>
              <p v-if="report.warnings.length" class="mt-1 text-amber-700">警告：{{ report.warnings.slice(0, 3).join('；') }}</p>
              <p v-if="report.errors.length" data-testid="translate-report-errors" class="mt-1 text-red-600">错误：{{ report.errors.slice(0, 3).join('；') }}{{ report.errors.length > 3 ? ` …（共 ${report.errors.length} 条）` : '' }}</p>
            </div>
          </template>
        </section>
      </div>

      <div class="flex justify-end gap-2 border-t px-4 py-3">
        <Button variant="ghost" size="sm" @click="onClose">关闭</Button>
      </div>
    </div>
  </div>
</template>
