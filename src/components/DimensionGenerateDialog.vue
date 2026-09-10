<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/composables/useToast'
import { emit, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import { dbBatchCreateModules, type BatchCreateReport } from '@/lib/db'
import {
  GENERATE_COUNT_DEFAULT,
  GENERATE_COUNT_OPTIONS,
  GENERATE_EXAMPLE_COUNT_DEFAULT,
  GENERATE_EXAMPLE_COUNT_OPTIONS,
  GENERATE_EXISTING_LIST_LIMIT,
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

const props = defineProps<{
  open: boolean
  dimension: Dimension | null
  modules: Module[]
}>()
const emitDlg = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'imported', report: BatchCreateReport): void
}>()

const { push } = useToast()

const TENDENCY_CHIPS = ['复古', '街头', '极简', '户外', '派对', '职场', '胶片感', '宽松廓形', '棉麻', '少荧光色']

function loadTendency(): string {
  try { return localStorage.getItem(GENERATE_LS_TENDENCY) ?? '' } catch { return '' }
}
function loadCount(): number {
  try {
    const v = Number(localStorage.getItem(GENERATE_LS_COUNT))
    if ((GENERATE_COUNT_OPTIONS as readonly number[]).includes(v)) return v
  } catch {}
  return GENERATE_COUNT_DEFAULT
}
function loadExampleCount(): number {
  try {
    const v = Number(localStorage.getItem(GENERATE_LS_EXAMPLE_COUNT))
    if ((GENERATE_EXAMPLE_COUNT_OPTIONS as readonly number[]).includes(v)) return v
  } catch {}
  return GENERATE_EXAMPLE_COUNT_DEFAULT
}
function loadExclude(): boolean {
  try {
    const v = localStorage.getItem(GENERATE_LS_EXCLUDE)
    if (v == null) return true
    return v !== 'false'
  } catch { return true }
}
function loadStep(): 1 | 2 | 3 {
  try {
    const v = Number(localStorage.getItem(GENERATE_LS_STEP))
    if (v === 1 || v === 2 || v === 3) return v as 1 | 2 | 3
  } catch {}
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

watch(tendency, (v) => { try { localStorage.setItem(GENERATE_LS_TENDENCY, v) } catch {} })
watch(count, (v) => { try { localStorage.setItem(GENERATE_LS_COUNT, String(v)) } catch {} })
watch(exampleCount, (v) => { try { localStorage.setItem(GENERATE_LS_EXAMPLE_COUNT, String(v)) } catch {} })
watch(excludeExisting, (v) => { try { localStorage.setItem(GENERATE_LS_EXCLUDE, String(v)) } catch {} })
watch(activeStep, (v) => { try { localStorage.setItem(GENERATE_LS_STEP, String(v)) } catch {} })

const rawResultText = ref('')
const resultFileInput = ref<HTMLInputElement | null>(null)
const parsed = ref<ParsedFragmentBatch | null>(null)
const applying = ref(false)
const report = ref<BatchCreateReport | null>(null)

// Step3: filter/search/pagination/selection
const filter = ref<'all' | 'ok' | 'dupDb' | 'dupBatch' | 'tooLong'>('all')
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
  if (!props.dimension) { push('维度不存在', 'error'); return }
  if (tendencyEmpty.value) { push('请先填写倾向，或点 chips 追加', 'warning'); return }
  if (tendencySanitized.value.truncated) push(`倾向已截断至 ${GENERATE_TENDENCY_MAX_LEN} 字`, 'warning')
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
    push(`生成提示词失败: ${String(e)}`, 'error')
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

async function onCopyPrompt(): Promise<void> {
  if (!promptText.value) { push('请先生成提示词', 'warning'); return }
  const ok = await copyText(promptText.value)
  push(ok ? `已复制生成提示词（约 ${promptTokens.value} tokens），去任意 LLM 粘贴即可` : '复制失败，请手动选择复制', ok ? 'success' : 'warning', 2000)
}

function onDownload(): void {
  if (!props.dimension) return
  if (!exportContent.value) { push('请先生成提示词', 'warning'); return }
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

function doParse(jump: boolean): void {
  if (!rawResultText.value.trim()) { push('请先粘贴 LLM 返回的结果', 'warning'); return }
  if (!props.dimension) { push('维度不存在', 'error'); return }
  const fmt = detectFragmentFormat(rawResultText.value)
  if (fmt === 'unknown') {
    parsed.value = parseFragmentText(rawResultText.value, { dimension: props.dimension, modules: props.modules })
    report.value = null
    curPage.value = 1
    push('未能识别格式，请确认 LLM 返回了 JSON 或一行一条文本', 'warning')
    return
  }
  const batch = parseFragmentText(rawResultText.value, { dimension: props.dimension, modules: props.modules })
  parsed.value = batch
  report.value = null
  curPage.value = 1
  if (batch.errors.length && batch.stats.valid === 0) {
    push(`解析失败：${batch.errors[0]}`, 'warning')
    return
  }
  if (jump) activeStep.value = 3
  const s = batch.stats
  push(`解析完成：共 ${s.total} 条 · 可入库 ${s.valid} · 库内重复 ${s.dupDb}`, batch.errors.length ? 'warning' : 'success', 2000)
}

function onParse(): void { doParse(true) }
function onValidate(): void {
  if (!rawResultText.value.trim()) { push('请先粘贴 LLM 返回的结果', 'warning'); return }
  if (!props.dimension) { push('维度不存在', 'error'); return }
  const batch = parseFragmentText(rawResultText.value, { dimension: props.dimension, modules: props.modules })
  const s = batch.stats
  push(`校验：共 ${s.total} 条 · 可入库 ${s.valid} · 库内重复 ${s.dupDb} · 批内重复 ${s.dupBatch} · 超长 ${s.tooLong}`, 'info', 2500)
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

function rowPill(r: { status: string; tooLong: boolean }): string {
  if (r.status === 'ok') return r.tooLong ? '待入库·已截断' : '待入库'
  if (r.status === 'duplicate_in_db') return '库内重复'
  if (r.status === 'duplicate_in_batch') return '批内重复'
  if (r.status === 'empty') return '空行'
  return '异常'
}

async function onApply(): Promise<void> {
  if (!props.dimension) { push('维度不存在', 'error'); return }
  if (!parsed.value) { push('请先解析', 'warning'); return }
  const payload = toBatchCreatePayload(parsed.value.rows, props.dimension, {
    mode: importMode.value,
    weight: importWeight.value,
    isNsfw: importNsfw.value,
  })
  if (payload.items.length === 0) { push('请至少勾选一条可入库结果', 'warning'); return }
  applying.value = true
  try {
    const rep = await dbBatchCreateModules(payload)
    report.value = rep
    if (rep.modulesCreated > 0 || rep.modulesUpdated > 0) {
      emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: 'batch-create-modules' })
      emitDlg('imported', rep)
      push(`已入库：新建 ${rep.modulesCreated} · 更新 ${rep.modulesUpdated} · 跳过 ${rep.modulesSkipped}`, 'success', 2500)
    } else {
      push('未入库任何条目，请查看报告', 'warning')
    }
    if (rep.errors.length) push(rep.errors.slice(0, 2).join('；'), 'warning', 2500)
  } catch (e) {
    push(`入库失败: ${String(e)}`, 'error')
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
</script>

<template>
  <div
    v-if="open"
    data-testid="generate-dialog"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    @click.self="onClose"
  >
    <div class="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-lg border bg-background shadow-xl">
      <!-- Header -->
      <div class="flex items-center justify-between border-b px-4 py-3">
        <h2 class="text-sm font-semibold">
          批量生成 — {{ dimension ? `${dimension.nameCn} / ${dimension.key}` : '—' }}
          <span class="ml-2 text-xs font-normal text-muted-foreground">{{ existingCount }} 条已有 · 本次 ≤50 条</span>
        </h2>
        <Button data-testid="generate-close" variant="ghost" size="sm" @click="onClose">✕</Button>
      </div>

      <!-- Step tabs -->
      <div class="flex shrink-0 items-center gap-1 border-b px-2 py-2 text-xs">
        <button class="rounded px-3 py-1.5 font-medium" :class="activeStep === 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'" @click="activeStep = 1">① 描述倾向并生成提示词</button>
        <span class="text-muted-foreground">→</span>
        <button class="rounded px-3 py-1.5 font-medium" :class="activeStep === 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'" @click="activeStep = 2">② 粘贴 LLM 结果</button>
        <span class="text-muted-foreground">→</span>
        <button class="rounded px-3 py-1.5 font-medium" :class="activeStep === 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'" @click="activeStep = 3">③ 预览与入库</button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <!-- Step 1 -->
        <section v-if="activeStep === 1" data-testid="generate-step-1" class="space-y-3">
          <p class="text-sm font-medium">① 描述倾向并生成提示词</p>
          <p class="text-xs text-muted-foreground">提示词会自动附上：格式要求、随机示例（K 条）、已有清单（可选）。倾向文本原样直通，仅做去围栏与截断，不改写语义。</p>

          <div>
            <label class="mb-1 block text-xs font-medium">期望倾向 / 风格</label>
            <textarea
              data-testid="generate-tendency"
              :value="tendency"
              placeholder="例如：偏复古胶片感、80-90 年代港风，宽松廓形为主，多棉麻牛仔材质，少荧光色；避开已有基础款白衬衫……（≤500字，原样交给 LLM）"
              class="min-h-[96px] w-full rounded-md border bg-background p-2 text-xs"
              rows="4"
              @input="tendency = ($event.target as HTMLTextAreaElement).value"
            />
            <div class="mt-1 flex flex-wrap items-center gap-1 text-xs">
              <span v-for="chip in TENDENCY_CHIPS" :key="chip" class="cursor-pointer rounded-full bg-muted px-2 py-0.5 hover:bg-accent" @click="appendChip(chip)">{{ chip }}</span>
              <span class="ml-auto text-muted-foreground">{{ [...tendency].length }} / {{ GENERATE_TENDENCY_MAX_LEN }}字</span>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3 text-xs">
            <label class="flex items-center gap-1">
              <span class="text-muted-foreground">生成数量</span>
              <select data-testid="generate-count" :value="String(count)" class="rounded border bg-background px-2 py-1 text-xs" @change="onCountChange">
                <option v-for="o in GENERATE_COUNT_OPTIONS" :key="o" :value="String(o)">{{ o }} 条</option>
              </select>
            </label>
            <label class="flex items-center gap-1">
              <span class="text-muted-foreground">示例条数</span>
              <select data-testid="generate-example-count" :value="String(exampleCount)" class="rounded border bg-background px-2 py-1 text-xs" @change="onExampleCountChange">
                <option v-for="o in GENERATE_EXAMPLE_COUNT_OPTIONS" :key="o" :value="String(o)">{{ o }} 条</option>
              </select>
            </label>
            <span class="flex items-center gap-1 text-muted-foreground">
              种子 {{ seed }}
              <Button data-testid="generate-reshuffle" variant="ghost" size="sm" class="h-6 px-2 text-xs" @click="onReshuffle">换一批</Button>
            </span>
            <label class="flex items-center gap-1" :title="existingCount === 0 ? '该维度暂无词条，无需附清单' : `附前 ${GENERATE_EXISTING_LIST_LIMIT} 条已有清单，要求 LLM 避重`">
              <input data-testid="generate-exclude" type="checkbox" :checked="excludeExisting" :disabled="existingCount === 0" @change="excludeExisting = ($event.target as HTMLInputElement).checked" />
              <span :class="existingCount === 0 ? 'text-muted-foreground' : ''">附已有清单避重</span>
            </label>
          </div>

          <div class="flex flex-wrap gap-2 text-xs">
            <Button data-testid="generate-build-btn" size="sm" :disabled="tendencyEmpty" @click="onBuildPrompt">生成提示词</Button>
            <template v-if="promptBuilt">
              <Button data-testid="generate-copy" variant="outline" size="sm" @click="onCopyPrompt">复制全文</Button>
              <Button data-testid="generate-download" variant="outline" size="sm" @click="onDownload">下载 .md</Button>
              <Button variant="ghost" size="sm" @click="activeStep = 2">下一步 →</Button>
            </template>
          </div>
          <p v-if="tendencyEmpty" class="text-xs text-amber-700">请先填写倾向，或点 chips 追加</p>

          <Card v-if="promptBuilt" data-testid="generate-prompt-preview" class="max-h-64 overflow-auto p-3">
            <pre class="whitespace-pre-wrap break-words text-xs">{{ promptText }}</pre>
            <p class="mt-2 text-xs text-muted-foreground">预估 token：约 {{ promptTokens }}</p>
            <p v-if="existingCount === 0" class="text-xs text-muted-foreground">该维度暂无词条，将使用内置示例</p>
            <p v-else class="text-xs text-muted-foreground">示例 {{ sampledExamples.length }} 条（种子 {{ seed }})</p>
          </Card>
        </section>

        <!-- Step 2 -->
        <section v-if="activeStep === 2" data-testid="generate-step-2" class="space-y-3">
          <p class="text-sm font-medium">② 粘贴 LLM 结果（支持一次粘贴：含 fence、含多余解释、扁平数组、纯行文本（一行一条））</p>
          <textarea
            data-testid="generate-result-textarea"
            :value="rawResultText"
            placeholder="粘贴 LLM 返回的 JSON（含 ```json fence、含多余解释均可）或一行一条的纯英文文本"
            class="min-h-[160px] w-full rounded-md border bg-background p-2 font-mono text-xs"
            rows="8"
            @input="rawResultText = ($event.target as HTMLTextAreaElement).value"
          />
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <input ref="resultFileInput" data-testid="generate-result-file-input" type="file" accept=".json,.txt,text/plain" class="hidden" @change="onResultFileSelected" />
            <Button variant="outline" size="sm" class="h-7 text-xs" @click="resultFileInput?.click()">选择 .json/.txt</Button>
            <Button variant="ghost" size="sm" class="h-7 text-xs" @click="onClearRaw">清空</Button>
            <span class="rounded bg-muted px-2 py-1">已粘贴 {{ rawResultText.length }} 字符 · 探测到约 {{ detectedCount }} 个 contentEn 字段</span>
          </div>
          <div class="flex gap-2">
            <Button data-testid="generate-parse-btn" size="sm" @click="onParse">解析并预览 →</Button>
            <Button data-testid="generate-validate-btn" variant="outline" size="sm" @click="onValidate">校验</Button>
          </div>
          <p class="text-xs text-muted-foreground">支持一次粘贴：含 ```json fence、含多余解释、扁平数组、纯行文本（一行一条）</p>
          <p v-if="parsed && parsed.errors.length" class="text-xs text-red-600">{{ parsed.errors[0] }}</p>
        </section>

        <!-- Step 3 -->
        <section v-if="activeStep === 3" data-testid="generate-step-3" class="space-y-3">
          <div class="flex items-center justify-between">
            <p class="text-sm font-medium">③ 预览与入库</p>
            <span v-if="parsed" data-testid="generate-stats" class="rounded bg-muted px-2 py-1 text-xs">
              共 {{ parsed.stats.total }} 条 · 可入库 {{ parsed.stats.valid }} · 库内重复 {{ parsed.stats.dupDb }} · 批内重复 {{ parsed.stats.dupBatch }} · 超长 {{ parsed.stats.tooLong }}
            </span>
          </div>

          <div v-if="!parsed" class="py-6 text-center text-xs text-muted-foreground">
            暂无预览 — 请先在第 2 步粘贴并解析 LLM 输出
            <div class="mt-2"><Button variant="outline" size="sm" @click="activeStep = 1">返回 Step1 复制提示词</Button></div>
          </div>
          <template v-else>
            <div class="flex flex-wrap items-center gap-2">
              <div data-testid="generate-filter" class="flex gap-1 text-xs">
                <button class="rounded px-2 py-1" :class="filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="filter = 'all'">全部</button>
                <button class="rounded px-2 py-1" :class="filter === 'ok' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="filter = 'ok'">待入库</button>
                <button class="rounded px-2 py-1" :class="filter === 'dupDb' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="filter = 'dupDb'">库内重复</button>
                <button class="rounded px-2 py-1" :class="filter === 'dupBatch' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="filter = 'dupBatch'">批内重复</button>
                <button class="rounded px-2 py-1" :class="filter === 'tooLong' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="filter = 'tooLong'">超长</button>
              </div>
              <Input v-model="search" placeholder="搜索 英文 / 中文…" class="h-7 max-w-[200px] text-xs" />
            </div>

            <div class="flex flex-wrap gap-1 text-xs">
              <Button variant="outline" size="sm" class="h-7" @click="selectAllValid">全选合法</Button>
              <Button variant="outline" size="sm" class="h-7" @click="deselectAll">取消全选</Button>
              <Button variant="outline" size="sm" class="h-7" @click="selectCurrentPage">仅选当前页</Button>
              <Button variant="outline" size="sm" class="h-7" @click="invertSelection">反选</Button>
              <span class="px-2 py-1 text-muted-foreground">已选 {{ selectedCount }} 条</span>
            </div>

            <div data-testid="generate-preview" class="max-h-[320px] overflow-auto rounded border">
              <p v-if="filteredRows.length === 0" class="py-6 text-center text-xs text-muted-foreground">无匹配行</p>
              <template v-else>
                <div
                  v-for="r in pagedRows"
                  :key="r.index"
                  :data-testid="`generate-row-${r.index}`"
                  class="flex items-center gap-2 border-b px-2 py-1.5 text-xs last:border-0"
                  :class="r.status === 'duplicate_in_db' ? 'bg-amber-50/70 dark:bg-amber-950/20' : r.status !== 'ok' ? 'bg-muted/30' : 'bg-card'"
                >
                  <input
                    :data-testid="`generate-row-checkbox-${r.index}`"
                    type="checkbox"
                    :checked="r.selected"
                    :disabled="r.status !== 'ok'"
                    @change="setRowSelected(r.index, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="min-w-0 flex-1 truncate font-medium" :title="r.contentEn">{{ r.contentEn || '—' }}</span>
                  <span class="hidden max-w-[140px] truncate text-muted-foreground sm:inline" :title="r.displayName">{{ r.displayName }}</span>
                  <span
                    class="shrink-0 rounded px-1.5 py-0.5 text-[11px]"
                    :class="r.status === 'ok' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-100' : r.status === 'duplicate_in_db' ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground'"
                  >{{ rowPill(r) }}</span>
                  <span v-if="r.warnings.length" class="shrink-0 text-amber-600" :title="r.warnings.join('；')">⚠</span>
                </div>
                <div v-if="filteredRows.length > pageSize" class="flex items-center justify-center gap-2 p-2 text-xs">
                  <Button variant="outline" size="sm" class="h-7" :disabled="curPage <= 1" @click="curPage--">‹</Button>
                  <span>{{ curPage }} / {{ totalPages }}</span>
                  <Button variant="outline" size="sm" class="h-7" :disabled="curPage >= totalPages" @click="curPage++">›</Button>
                </div>
              </template>
            </div>

            <div class="flex flex-wrap items-center gap-3 rounded border bg-muted/20 p-2 text-xs">
              <label class="flex items-center gap-1" title="skip：精确英文去重，库内已有则跳过；overwrite：覆盖同英文词条。大小写敏感以后端为准">
                <span class="text-muted-foreground">去重模式</span>
                <select :value="importMode" class="rounded border bg-background px-2 py-1 text-xs" @change="importMode = ($event.target as HTMLSelectElement).value as 'skip' | 'overwrite'">
                  <option value="skip">skip 去重跳过</option>
                  <option value="overwrite">overwrite 覆盖同英文</option>
                </select>
              </label>
              <label class="flex items-center gap-1">
                <span class="text-muted-foreground">默认权重</span>
                <input v-model.number="importWeight" type="number" min="0.5" max="2.0" step="0.1" class="w-16 rounded border bg-background px-1 py-0.5 text-xs" />
              </label>
              <label class="flex items-center gap-1">
                <input v-model="importNsfw" type="checkbox" />
                <span class="text-muted-foreground">NSFW</span>
              </label>
              <span class="text-muted-foreground">精确英文去重，大小写敏感以后端为准</span>
            </div>

            <div class="flex gap-2">
              <Button data-testid="generate-apply-btn" size="sm" :disabled="!canApply" @click="onApply">{{ applying ? '入库中…' : `应用到词库（${selectedCount} 条）` }}</Button>
              <Button variant="outline" size="sm" @click="activeStep = 2">返回修改</Button>
              <Button variant="ghost" size="sm" @click="onClearAll">清空重来</Button>
              <Button v-if="report && (report.modulesCreated > 0 || report.modulesUpdated > 0)" data-testid="generate-done-btn" variant="outline" size="sm" @click="onClose">完成并关闭</Button>
            </div>

            <div v-if="parsed.warnings.length" class="text-xs text-amber-700">警告：{{ parsed.warnings.slice(0, 3).join('；') }}</div>
            <div v-if="parsed.errors.length" class="text-xs text-red-600">错误：{{ parsed.errors.slice(0, 3).join('；') }}</div>

            <div v-if="report" data-testid="generate-report" class="rounded-md border bg-muted/30 p-3 text-xs">
              <p class="font-medium">入库报告</p>
              <p>成功 {{ report.modulesCreated }} · 更新 {{ report.modulesUpdated }} · 跳过 {{ report.modulesSkipped }} · 请求 {{ report.totalRequested }}</p>
              <p v-if="report.warnings.length" class="mt-1 text-amber-700">警告：{{ report.warnings.slice(0, 3).join('；') }}</p>
              <p v-if="report.errors.length" class="mt-1 text-red-600">错误：{{ report.errors.slice(0, 3).join('；') }}{{ report.errors.length > 3 ? ` …（共 ${report.errors.length} 条）` : '' }}</p>
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
