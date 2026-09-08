<script setup lang="ts">
/**
 * need02 IR 冲突编辑器（05/06 唯一口径）
 * 受控对话框：open 由父控，内部 draft 深拷贝，关闭时脏检查。
 * 左段表 + 右冲突/tabs + 底预览三区。
 */
import { ref, computed, watch, nextTick } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useToast } from '@/composables/useToast'
import { dimColor } from '@/lib/utils'
import { calcPopoverPos } from '@/lib/need05Position'
import { adaptToModel } from '@/engine/adapters'
import { evaluateRules, summarizeFindings } from '@/engine/ruleEngine'
import { IR_SNAPSHOT_VERSION, PromptIR, type AssemblyConfig, type Finding, type IRSegment } from '@/engine/models'
import {
  cloneSegments, updateSegmentText, updateSegmentWeight, removeSegment,
  moveSegment, appendEmptySegment, applyFindingFix, toSelectedItems, shortHash,
} from '@/lib/irEdit'
import { useRulesStore } from '@/stores/rules'
import { useAssemblyStore } from '@/stores/assembly'
import { useLibraryStore } from '@/stores/library'
import { useHistoryStore } from '@/stores/history'
import { exportSingleCsv } from '@/lib/export'
import { dbUpdateModule } from '@/lib/db'
import { emit, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import RuleListPanel from './RuleListPanel.vue'
import SaveDialog from './SaveDialog.vue'

const props = withDefaults(defineProps<{
  open: boolean
  ir?: PromptIR | null
  config?: AssemblyConfig | null
  title?: string
}>(), {
  ir: null,
  config: null,
  title: 'IR 冲突编辑器',
})

const emitEv = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'applied', payload: { ir: PromptIR; finalPrompt: string }): void
  (e: 'close'): void
}>()

defineExpose({ refresh })

const { push } = useToast()
const rulesStore = useRulesStore()
const assembly = useAssemblyStore()
const library = useLibraryStore()
const historyStore = useHistoryStore()

const draft = ref<IRSegment[]>([])
const lockedIndexes = ref<Set<number>>(new Set())
const ignoredIds = ref<Set<string>>(new Set())
const dirty = ref(false)
const tab = ref('findings')
const expandedPreview = ref(false)
const expandedSeg = ref<number | null>(null)
const highlightIdx = ref<number | null>(null)
const fixingId = ref<string | null>(null)
const undoStack = ref<IRSegment[][]>([])
const previewProfile = ref('sd')
const previewSeparator = ref(', ')
const previewBrackets = ref(true)
const textDrafts = ref<Record<number, string>>({})
const showSaveDialog = ref(false)
const weightIdx = ref<number | null>(null)
const weightVal = ref(1.0)
const weightPos = ref({ top: 0, left: 0 })
let debounceTimer: number | null = null
let initializedFor: unknown = null

const defaultConfig: AssemblyConfig = { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }

function refresh(): void {
  void rulesStore.fetchAll().catch(() => { /* 冲突区展示 loadError，段编辑不受影响 */ })
}

function snapshotKey(): unknown {
  return props.open ? (props.ir ? props.ir.hash() + JSON.stringify(props.config ?? null) : 'empty') : null
}

function ensureInit(): void {
  if (!props.open) return
  const key = snapshotKey()
  if (initializedFor !== key) {
    initializedFor = key
    const segs = props.ir ? cloneSegments(props.ir.segments) : []
    draft.value = segs
    lockedIndexes.value = new Set()
    ignoredIds.value = new Set()
    dirty.value = false
    undoStack.value = []
    fixingId.value = null
    expandedSeg.value = null
    textDrafts.value = {}
    const cfg = props.config ?? defaultConfig
    previewProfile.value = cfg.modelProfile
    previewSeparator.value = cfg.separator
    previewBrackets.value = cfg.useWeightBrackets
    if (rulesStore.loaded === false) refresh()
  }
}

const engineRules = computed(() => rulesStore.toEngineRules())

const findings = computed<Finding[]>(() => {
  const all = evaluateRules({
    segments: draft.value,
    rules: engineRules.value,
    lockedIndexes: lockedIndexes.value,
    dimKeyToName: rulesStore.dimKeyToName,
  })
  return all.map((f) => (ignoredIds.value.has(f.ruleId) ? { ...f, ignored: true } : f))
})

const activeFindings = computed(() => findings.value.filter((f) => !f.ignored))
const summary = computed(() => summarizeFindings(findings.value))

const badgeText = computed(() => {
  if (summary.value.errors > 0) return `⛔ ${summary.value.errors + summary.value.warnings} 错误`
  if (summary.value.warnings > 0) return `⚠ ${summary.value.warnings} 冲突`
  return '✓ 无冲突'
})

const previewConfig = computed<AssemblyConfig>(() => ({
  separator: previewSeparator.value,
  useWeightBrackets: previewBrackets.value,
  modelProfile: previewProfile.value as AssemblyConfig['modelProfile'],
  sortBy: props.config?.sortBy ?? 'dimensionOrder',
}))

const finalPreview = computed(() => {
  const ir = new PromptIR(draft.value.filter((s) => s.text.trim()).map((s) => ({ ...s })), [], [], IR_SNAPSHOT_VERSION)
  return adaptToModel(ir, previewProfile.value, previewConfig.value)
})

const previewIr = computed(() => new PromptIR(cloneSegments(draft.value), activeFindings.value.map((f) => f.message), activeFindings.value, IR_SNAPSHOT_VERSION))
const hashShort = computed(() => shortHash(previewIr.value))
const hasLocks = computed(() => lockedIndexes.value.size > 0)
const dimNameOf = (key: string): string => rulesStore.dimKeyToName[key] ?? key

function segBg(key: string): string {
  const c = dimColor(key || 'unknown')
  return c
}

function pushUndo(): void {
  undoStack.value.push(cloneSegments(draft.value))
  if (undoStack.value.length > 30) undoStack.value.shift()
}

function markDirty(): void {
  dirty.value = true
}

function onUndo(): void {
  const prev = undoStack.value.pop()
  if (!prev) return
  draft.value = prev
  lockedIndexes.value = new Set([...lockedIndexes.value].filter((i) => i < prev.length))
  fixingId.value = null
  markDirty()
}

function onAddSeg(): void {
  pushUndo()
  draft.value = appendEmptySegment(draft.value)
  expandedSeg.value = draft.value.length - 1
  textDrafts.value[draft.value.length - 1] = ''
  markDirty()
  nextTick(() => {
    const el = document.querySelector<HTMLElement>(`[data-testid="ir-editor-seg-expand-${draft.value.length - 1}"] input`)
    el?.focus()
  })
}

function onTextInput(index: number, value: string): void {
  textDrafts.value[index] = value
  if (debounceTimer) window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => {
    draft.value = updateSegmentText(draft.value, index, value)
    markDirty()
  }, 300)
}

function confirmText(index: number): void {
  if (debounceTimer) { window.clearTimeout(debounceTimer); debounceTimer = null }
  const v = textDrafts.value[index]
  if (v !== undefined) {
    draft.value = updateSegmentText(draft.value, index, v)
    markDirty()
  }
}

function hasCjk(text: string): boolean {
  return /[一-鿿]/.test(text)
}

function onWeightFloat(index: number, evt?: MouseEvent): void {
  weightIdx.value = index
  weightVal.value = draft.value[index]?.weight ?? 1
  const el = (evt?.currentTarget as HTMLElement) ?? document.querySelector<HTMLElement>(`[data-testid="ir-editor-seg-weight-${index}"]`)
  const rect = el?.getBoundingClientRect?.() ?? null
  if (rect) {
    weightPos.value = calcPopoverPos(rect, 224, 150, window.innerWidth, window.innerHeight)
    nextTick(() => {
      const pop = document.querySelector<HTMLElement>('[data-testid="ir-editor-weight-popover"]')
      const h = pop?.getBoundingClientRect().height || 150
      weightPos.value = calcPopoverPos(rect, 224, h, window.innerWidth, window.innerHeight)
      pop?.querySelector<HTMLElement>('input')?.focus()
    })
  }
}

function confirmWeightFloat(): void {
  if (weightIdx.value == null) return
  draft.value = updateSegmentWeight(draft.value, weightIdx.value, weightVal.value)
  weightIdx.value = null
  markDirty()
}

function cancelWeightFloat(): void {
  weightIdx.value = null
}

function onToggleLock(index: number): void {
  const next = new Set(lockedIndexes.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  lockedIndexes.value = next
  markDirty()
}

function onUnlockAll(): void {
  lockedIndexes.value = new Set()
  markDirty()
}

function onDeleteSeg(index: number): void {
  pushUndo()
  draft.value = removeSegment(draft.value, index)
  lockedIndexes.value = new Set([...lockedIndexes.value].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)))
  markDirty()
  push('已移除一段，可继续编辑', 'info', 1200)
}

function onDragEnd(evt: { oldIndex?: number; newIndex?: number }): void {
  const { oldIndex, newIndex } = evt
  if (oldIndex == null || newIndex == null || oldIndex === newIndex) return
  pushUndo()
  draft.value = moveSegment(draft.value, oldIndex, newIndex)
  // 锁定跟随段移动
  const locks = [...lockedIndexes.value]
  const movedWasLocked = locks.includes(oldIndex)
  const next = locks.filter((i) => i !== oldIndex).map((i) => {
    if (oldIndex < newIndex) return i > oldIndex && i <= newIndex ? i - 1 : i
    return i >= newIndex && i < oldIndex ? i + 1 : i
  })
  if (movedWasLocked) next.push(newIndex)
  lockedIndexes.value = new Set(next)
  markDirty()
}

function locateSegment(index: number): void {
  highlightIdx.value = index
  nextTick(() => {
    document.querySelector<HTMLElement>(`[data-testid="ir-editor-seg-row-${index}"]`)?.scrollIntoView({ block: 'nearest' })
  })
  window.setTimeout(() => { if (highlightIdx.value === index) highlightIdx.value = null }, 1200)
}

function onIgnore(f: Finding): void {
  ignoredIds.value = new Set([...ignoredIds.value, f.ruleId])
  markDirty()
}

function onUnignore(f: Finding): void {
  const next = new Set(ignoredIds.value)
  next.delete(f.ruleId)
  ignoredIds.value = next
  markDirty()
}

function onIgnoreAll(): void {
  ignoredIds.value = new Set([...ignoredIds.value, ...findings.value.filter((f) => f.severity !== 'error').map((f) => f.ruleId)])
  markDirty()
}

function chipsFor(f: Finding): { index: number; label: string }[] {
  return f.involvedIndexes.map((i) => ({ index: i, label: `#${i + 1} ${draft.value[i]?.dimensionKey || '空段'}` }))
}

function fixChips(f: Finding): { remove: { index: number; label: string }[]; keep: { index: number; label: string }[] } {
  const label = (i: number): string => `#${i + 1} ${draft.value[i]?.dimensionKey || '空段'}`
  return {
    remove: (f.fix?.removeIndexes ?? []).map((i) => ({ index: i, label: label(i) })),
    keep: (f.fix?.keepIndexes ?? []).map((i) => ({ index: i, label: label(i) })),
  }
}

function onApplyFix(f: Finding): void {
  if (!f.fix) return
  pushUndo()
  draft.value = applyFindingFix(draft.value, f.fix)
  lockedIndexes.value = new Set([...lockedIndexes.value].filter((i) => !f.fix!.removeIndexes.includes(i)).map((i) => {
    let shift = 0
    for (const r of [...f.fix!.removeIndexes].sort((a, b) => a - b)) if (r < i) shift++
    return i - shift
  }))
  ignoredIds.value = new Set([...ignoredIds.value].filter((id) => id !== f.ruleId))
  fixingId.value = null
  markDirty()
  push('已应用修复', 'success', 1200)
}

function onClose(): void {
  if (dirty.value) {
    const ok = window.confirm('改动未应用，确定关闭？')
    if (!ok) return
  }
  emitEv('update:open', false)
  emitEv('close')
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (weightIdx.value != null) { cancelWeightFloat(); return }
    onClose()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) {
    e.preventDefault()
    onUndo()
  }
}

function buildSelected() {
  const dimKeyToId: Record<string, string> = {}
  for (const d of library.dimensions) dimKeyToId[d.key] = d.id
  return toSelectedItems(draft.value, { lockedIndexes: lockedIndexes.value, dimKeyToId })
}

function onApplyToCanvas(): void {
  const items = buildSelected()
  if (assembly.selectedItems.length > 0) {
    const ok = window.confirm('覆盖当前画布？')
    if (!ok) return
  }
  assembly.setSelected(items)
  emitEv('applied', { ir: previewIr.value, finalPrompt: finalPreview.value })
  dirty.value = false
  emitEv('update:open', false)
  push('已应用到画布', 'success', 1500)
}

function onSaveAs(): void {
  showSaveDialog.value = true
}

async function onSaveConfirm(payload: { name: string; desc: string | null }): Promise<void> {
  try {
    const irJson = JSON.stringify(previewIr.value.toJSON())
    await historyStore.save(payload.name || null, irJson, finalPreview.value, previewConfig.value, buildSelected(), false)
    showSaveDialog.value = false
    push('已另存方案', 'success', 1500)
  } catch (e) {
    push(`另存失败: ${String(e)}`, 'error')
  }
}

async function onCopy(): Promise<void> {
  const text = finalPreview.value
  if (!text.trim()) { push('暂无可复制的 Prompt', 'warning'); return }
  try {
    await navigator.clipboard.writeText(text)
    push('已复制到剪贴板', 'success', 1500)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    push('已复制到剪贴板', 'success', 1500)
  }
}

function onExport(): void {
  if (!finalPreview.value.trim()) { push('暂无可导出的 Prompt', 'warning'); return }
  exportSingleCsv(previewIr.value, finalPreview.value)
  push('已导出 CSV', 'success', 1500)
}

async function onWritebackWeight(index: number): Promise<void> {
  const s = draft.value[index]
  if (!s?.sourceModuleId) return
  const ok = window.confirm(`将词条默认权重写为 ${s.weight.toFixed(1)}？`)
  if (!ok) return
  try {
    const mod = Object.values(library.modulesByDim).flat().find((m) => m.id === s.sourceModuleId)
    if (!mod) { push('库中找不到该条目', 'warning'); return }
    await dbUpdateModule({ ...mod, weight: s.weight })
    emit(LIBRARY_CHANGED, { source: 'ir-editor', op: 'update-module-weight' })
    push('已写回词条默认权重', 'success', 1500)
  } catch (e) {
    push(`写回失败: ${String(e)}`, 'error')
  }
}

const ruleDims = computed(() => library.dimensions.map((d) => ({ id: d.id, key: d.key, nameCn: d.nameCn })))
const ruleModulesByDimId = computed(() => {
  const out: Record<string, { id: string; displayName: string }[]> = {}
  for (const [key, mods] of Object.entries(library.modulesByDim)) {
    const dim = library.dimensions.find((d) => d.key === key)
    if (dim) out[dim.id] = mods.map((m) => ({ id: m.id, displayName: m.displayName }))
  }
  return out
})

watch(() => props.open, (v) => { if (v) { tab.value = 'findings'; ensureInit() } })
</script>

<template>
  <div
    v-if="open"
    data-testid="ir-editor-overlay"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    @click.self="onClose"
    @keydown="onKeydown"
  >
    {{ ensureInit() }}
    <Card data-testid="ir-editor-dialog" class="flex max-h-[min(84vh,800px)] w-[min(1120px,94vw)] flex-col p-4 shadow-xl" @click.stop>
      <!-- 标题行 -->
      <div class="flex h-9 items-center justify-between">
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-semibold">{{ title }}</h3>
          <Badge data-testid="ir-editor-badge" :variant="summary.errors > 0 ? 'destructive' : summary.warnings > 0 ? 'outline' : 'secondary'">{{ badgeText }}</Badge>
        </div>
        <div class="flex items-center gap-1">
          <Button data-testid="ir-editor-undo" variant="ghost" size="sm" class="h-7 text-xs" title="撤销段表操作（Ctrl+Z）" aria-label="撤销" :disabled="undoStack.length === 0" @click="onUndo">↩ 撤销</Button>
          <Button data-testid="ir-editor-close" variant="ghost" size="sm" class="h-7 w-7 p-0" title="关闭" aria-label="关闭" @click="onClose">✕</Button>
        </div>
      </div>

      <!-- 工具行 -->
      <div class="mt-2 flex items-center gap-2">
        <Button data-testid="ir-editor-add-seg" variant="outline" size="sm" class="h-7 text-xs" @click="onAddSeg">+ 添加空段</Button>
        <Button v-if="hasLocks" data-testid="ir-editor-unlock-all" variant="ghost" size="sm" class="h-7 text-xs" @click="onUnlockAll">全部解锁</Button>
        <div class="ml-auto flex items-center gap-2">
          <select v-model="previewProfile" data-testid="ir-editor-profile" class="h-7 rounded-md border bg-background px-2 text-xs" title="模型配置">
            <option value="sd">SD</option>
            <option value="mj">MJ</option>
            <option value="flux">Flux</option>
          </select>
          <select v-model="previewSeparator" data-testid="ir-editor-separator" class="h-7 rounded-md border bg-background px-2 text-xs" title="分隔符">
            <option value=", ">, 逗号</option>
            <option value=" ">空格</option>
            <option value="\n">换行</option>
          </select>
          <label class="flex items-center gap-1 text-xs text-muted-foreground">
            <input v-model="previewBrackets" data-testid="ir-editor-brackets" type="checkbox" class="accent-primary" />
            <span>权重括号</span>
          </label>
        </div>
      </div>

      <!-- 左右区 -->
      <div class="mt-2 flex min-h-0 flex-1 gap-3 max-[900px]:flex-col">
        <!-- 左区段表 -->
        <section class="flex min-h-0 flex-[58] flex-col overflow-hidden" aria-label="IR 段表">
          <ScrollArea class="flex-1">
            <div v-if="draft.length === 0" data-testid="ir-editor-seg-list" class="flex min-h-[160px] flex-col items-center justify-center gap-2 p-6 text-center">
              <div class="text-lg text-muted-foreground">◈</div>
              <p class="text-xs font-medium">暂无段落</p>
              <p class="text-[11px] text-muted-foreground">点“+ 添加空段”手动写 Prompt 片</p>
            </div>
            <VueDraggable
              v-else
              v-model="draft"
              data-testid="ir-editor-seg-list"
              class="flex flex-col gap-2 p-1"
              :animation="150"
              ghost-class="opacity-40"
              handle=".drag-handle"
              role="list"
              @end="onDragEnd"
            >
              <div
                v-for="(s, i) in draft"
                :key="`${s.sourceModuleId || 'seg'}-${i}`"
                :data-testid="`ir-editor-seg-row-${i}`"
                role="listitem"
                class="flex flex-col gap-1 rounded-md border px-3 py-2 shadow-sm hover:shadow"
                :class="[(lockedIndexes.has(i) ? 'ring-1 ring-primary' : ''), highlightIdx === i ? 'ring-2 ring-primary' : '']"
                :style="{ borderLeftColor: dimColor(s.dimensionKey || 'unknown'), borderLeftWidth: '4px', background: `color-mix(in srgb, ${segBg(s.dimensionKey)} 8%, transparent)` }"
              >
                <div class="flex items-center gap-1.5">
                  <span class="drag-handle cursor-grab select-none text-muted-foreground hover:text-foreground" title="拖拽排序" aria-label="拖拽排序">⋮⋮</span>
                  <span class="h-2 w-2 shrink-0 rounded-full" :style="{ background: dimColor(s.dimensionKey || 'unknown') }" />
                  <span class="shrink-0 rounded bg-background/60 px-1 py-0.5 font-mono text-[11px]">{{ s.dimensionKey || '未分类' }}</span>
                  <button
                    :data-testid="`ir-editor-seg-text-${i}`"
                    class="min-w-0 flex-1 cursor-text truncate text-left font-mono text-xs"
                    :title="s.text || '（空段，点击展开编辑）'"
                    @click="expandedSeg = expandedSeg === i ? null : i"
                  >{{ s.text || '（空段）' }}</button>
                  <button :data-testid="`ir-editor-seg-weight-${i}`" class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent" :title="`权重 ${s.weight.toFixed(1)}，点击微调`" @click="onWeightFloat(i, $event)">w{{ s.weight.toFixed(1) }}</button>
                  <button :data-testid="`ir-editor-seg-lock-${i}`" class="rounded px-1 hover:bg-accent" :title="lockedIndexes.has(i) ? '已锁定：自动修复不会移除' : '锁定：自动修复不会移除'" :aria-label="`锁定段 ${i + 1}`" @click="onToggleLock(i)">{{ lockedIndexes.has(i) ? '🔒' : '🔓' }}</button>
                  <button :data-testid="`ir-editor-seg-del-${i}`" class="rounded px-1 hover:bg-accent hover:text-destructive" title="删除该段" :aria-label="`删除段 ${i + 1}`" @click="onDeleteSeg(i)">✕</button>
                </div>
                <div v-if="expandedSeg === i" :data-testid="`ir-editor-seg-expand-${i}`" class="ml-6 flex flex-col gap-1.5">
                  <Input
                    :model-value="textDrafts[i] ?? s.text"
                    class="h-7 font-mono text-xs"
                    placeholder="英文片段，如 red slip dress"
                    @input="onTextInput(i, ($event.target as HTMLInputElement).value)"
                    @change="confirmText(i)"
                    @keydown.enter="confirmText(i)"
                  />
                  <p v-if="hasCjk(textDrafts[i] ?? s.text)" class="text-[11px] text-amber-600 dark:text-amber-400">检测到中文，拼入的 Prompt 通常为英文，请确认</p>
                  <p v-if="!(s.text || '').trim()" class="text-[11px] text-amber-600 dark:text-amber-400" title="文本为空，该段不会拼入预览">文本为空，该段不会拼入预览</p>
                  <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span class="truncate font-mono" :title="s.sourceModuleId || '无来源模块'">{{ s.sourceModuleId ? `src:${s.sourceModuleId}` : '无来源模块' }}</span>
                    <span>{{ dimNameOf(s.dimensionKey) }}</span>
                    <span class="ml-auto flex items-center gap-1">
                      <button :data-testid="`ir-editor-seg-writeback-${i}`" class="rounded px-1 hover:bg-accent hover:text-foreground" :disabled="!s.sourceModuleId" :title="s.sourceModuleId ? '写回词条默认权重' : '无来源模块，不可写回权重'" @click="onWritebackWeight(i)">写回权重</button>
                    </span>
                  </div>
                </div>
              </div>
            </VueDraggable>
          </ScrollArea>
        </section>

        <!-- 右区 Tabs -->
        <section class="flex min-h-0 flex-[42] flex-col overflow-hidden max-[900px]:max-h-[38vh]" aria-label="冲突与规则">
          <Tabs v-model="tab" default-value="findings" data-testid="ir-editor-tabs" class="flex min-h-0 flex-1 flex-col">
            <TabsList class="shrink-0">
              <TabsTrigger value="findings" data-testid="ir-editor-tab-findings">冲突（{{ activeFindings.length }}）</TabsTrigger>
              <TabsTrigger value="rules" data-testid="ir-editor-tab-rules">规则管理</TabsTrigger>
            </TabsList>
            <TabsContent value="findings" class="flex min-h-0 flex-1 flex-col">
              <div class="flex shrink-0 items-center justify-between py-1">
                <span class="text-[11px] text-muted-foreground">{{ rulesStore.loadError ? `规则加载失败，仅预览：${rulesStore.loadError}` : `${engineRules.length} 条规则参与判定` }}</span>
                <div class="flex items-center gap-1">
                  <Button v-if="rulesStore.loadError" size="sm" variant="ghost" class="h-6 text-xs" @click="refresh">重试</Button>
                  <button class="rounded px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground" @click="onIgnoreAll">全部忽略</button>
                </div>
              </div>
              <ScrollArea class="min-h-0 flex-1">
                <div v-if="findings.length === 0" class="flex min-h-[120px] flex-col items-center justify-center gap-1 p-4 text-center">
                  <p class="text-xs font-medium">✓ 暂无冲突</p>
                  <p class="text-[11px] text-muted-foreground">改段、改权重或开关规则会实时重算</p>
                </div>
                <ul v-else class="flex flex-col gap-2 p-1" role="list">
                  <li
                    v-for="f in findings"
                    :key="f.ruleId"
                    :data-testid="`ir-editor-finding-row-${f.ruleId}`"
                    role="listitem"
                    class="rounded-md border p-2"
                    :class="f.ignored ? 'opacity-60' : ''"
                  >
                    <div class="flex items-center gap-1.5">
                      <span class="h-2 w-2 shrink-0 rounded-full" :class="f.severity === 'error' ? 'bg-red-500' : 'bg-amber-500'" />
                      <span class="truncate text-xs font-semibold" :title="f.ruleName">{{ f.ruleName }}</span>
                      <span class="rounded bg-muted px-1 text-[10px] text-muted-foreground">{{ f.type }}</span>
                      <span v-if="f.ignored" class="rounded bg-muted px-1 text-[10px]">已忽略</span>
                    </div>
                    <p class="mt-1 line-clamp-2 text-xs text-muted-foreground" :title="f.message">{{ f.message }}</p>
                    <div class="mt-1 flex flex-wrap gap-1">
                      <button
                        v-for="c in chipsFor(f)"
                        :key="c.index"
                        :data-testid="`ir-editor-goto-${c.index}`"
                        class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] hover:bg-accent"
                        :title="`定位到第 ${c.index + 1} 段`"
                        @click="locateSegment(c.index)"
                      >{{ c.label }}</button>
                    </div>
                    <div class="mt-1.5 flex items-center gap-1.5">
                      <template v-if="!f.ignored">
                        <Button v-if="f.fix" :data-testid="`ir-editor-fix-${f.ruleId}`" size="sm" class="h-6 text-xs" @click="fixingId = fixingId === f.ruleId ? null : f.ruleId">自动修复</Button>
                        <Button v-else :data-testid="`ir-editor-locate-${f.ruleId}`" size="sm" variant="ghost" class="h-6 text-xs" @click="locateSegment(f.involvedIndexes[0] ?? 0)">定位</Button>
                        <Button :data-testid="`ir-editor-ignore-${f.ruleId}`" size="sm" variant="ghost" class="h-6 text-xs" @click="onIgnore(f)">忽略</Button>
                      </template>
                      <Button v-else size="sm" variant="ghost" class="h-6 text-xs" @click="onUnignore(f)">取消忽略</Button>
                    </div>
                    <div v-if="fixingId === f.ruleId && f.fix && !f.ignored" class="mt-1.5 rounded-md border bg-muted/30 p-2">
                      <p class="text-[11px]">{{ f.fix.reason }}</p>
                      <div class="mt-1 flex flex-wrap gap-1">
                        <span class="text-[11px] text-muted-foreground">将移除：</span>
                        <span v-for="c in fixChips(f).remove" :key="c.index" class="rounded border border-destructive/50 px-1.5 py-0.5 font-mono text-[10px] text-destructive">{{ c.label }}</span>
                      </div>
                      <div class="mt-1 flex flex-wrap gap-1">
                        <span class="text-[11px] text-muted-foreground">将保留：</span>
                        <span v-for="c in fixChips(f).keep" :key="c.index" class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{{ c.label }}</span>
                      </div>
                      <div class="mt-1.5 flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" class="h-6 text-xs" @click="fixingId = null">取消</Button>
                        <Button :data-testid="`ir-editor-fix-confirm-${f.ruleId}`" size="sm" :variant="f.severity === 'error' ? 'destructive' : 'default'" class="h-6 text-xs" @click="onApplyFix(f)">{{ f.severity === 'error' ? `仍要应用（将清空 ${f.fix.removeIndexes.length} 段）` : '确认应用' }}</Button>
                      </div>
                    </div>
                  </li>
                </ul>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="rules" class="flex min-h-0 flex-1 flex-col">
              <RuleListPanel :dimensions="ruleDims" :modules-by-dim-id="ruleModulesByDimId" />
            </TabsContent>
          </Tabs>
        </section>
      </div>

      <!-- 底栏预览 -->
      <div class="mt-2 rounded-md border bg-muted/20 p-2.5">
        <p data-testid="ir-editor-preview" class="font-mono text-xs whitespace-pre-wrap break-words" :class="expandedPreview ? '' : 'line-clamp-3'">{{ finalPreview || '（空预览：段表为空或全为空文本）' }}</p>
        <div class="mt-1.5 flex items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            <span>{{ draft.length }} 段 · {{ finalPreview.length }} 字符</span>
            <span data-testid="ir-editor-hash" class="font-mono" :title="`IR hash ${previewIr.hash()}`">#{{ hashShort }}</span>
            <Button v-if="finalPreview.length > 400" data-testid="ir-editor-preview-expand" variant="ghost" size="sm" class="h-6 text-xs" @click="expandedPreview = !expandedPreview">{{ expandedPreview ? '折叠' : '展开' }}</Button>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <Button data-testid="ir-editor-copy" variant="outline" size="sm" class="h-7 text-xs" :disabled="!finalPreview.trim()" @click="onCopy">复制全文</Button>
            <Button data-testid="ir-editor-export" variant="outline" size="sm" class="h-7 text-xs" :disabled="!finalPreview.trim()" @click="onExport">导出 CSV</Button>
            <Button data-testid="ir-editor-save" variant="outline" size="sm" class="h-7 text-xs" :disabled="!finalPreview.trim()" @click="onSaveAs">另存方案</Button>
            <Button data-testid="ir-editor-apply" size="sm" class="h-7 text-xs" :disabled="draft.length === 0" @click="onApplyToCanvas">应用到画布</Button>
          </div>
        </div>
      </div>
    </Card>

    <!-- 权重浮窗 -->
    <Teleport to="body">
      <div
        v-if="weightIdx != null"
        data-testid="ir-editor-weight-popover"
        class="fixed z-[70] flex w-56 flex-col gap-2 rounded-md border bg-popover p-3 shadow-xl"
        :style="{ top: weightPos.top + 'px', left: weightPos.left + 'px' }"
        @click.stop
      >
        <p class="text-xs font-medium">权重 0.5 – 2.0 · 步进 0.1</p>
        <div class="flex items-center gap-2">
          <input type="range" min="0.5" max="2.0" step="0.1" :value="String(weightVal)" class="flex-1 accent-primary" @input="weightVal = parseFloat(($event.target as HTMLInputElement).value)" />
          <span class="w-8 text-center font-mono text-xs">{{ weightVal.toFixed(1) }}</span>
        </div>
        <div class="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" class="h-7 text-xs" @click="cancelWeightFloat">取消</Button>
          <Button size="sm" class="h-7 text-xs" @click="confirmWeightFloat">确定</Button>
        </div>
      </div>
    </Teleport>

    <SaveDialog :open="showSaveDialog" mode="assembly" @update:open="showSaveDialog = $event" @confirm="onSaveConfirm" />
  </div>
</template>
