import { ref, computed, nextTick } from 'vue'
import { dimColor } from '@/lib/utils'
import { calcPopoverPos } from '@/lib/need05Position'
import { adaptToModel } from '@/engine/adapters'
import { evaluateRules, summarizeFindings } from '@/engine/ruleEngine'
import { IR_SNAPSHOT_VERSION, PromptIR, type AssemblyConfig, type Finding, type IRSegment } from '@/engine/models'
import {
  cloneSegments, updateSegmentText, updateSegmentWeight, removeSegment,
  moveSegment, appendEmptySegment, applyFindingFix, shortHash,
} from '@/lib/irEdit'
import { useRulesStore } from '@/stores/rules'
import { useLibraryStore } from '@/stores/library'
import { notify } from '@/lib/notify'
import { logger } from '@/lib/logger'

export interface IrEditorProps {
  open: boolean
  ir?: PromptIR | null
  config?: AssemblyConfig | null
}

const defaultConfig: AssemblyConfig = { separator: ', ', useWeightBrackets: true, modelProfile: 'sd', sortBy: 'dimensionOrder' }

/** IrConflictEditor 段表 + 冲突判定逻辑（展示层在 ir/ 下，动作层留父组件） */
export function useIrEditor(props: IrEditorProps) {
  const rulesStore = useRulesStore()
  const library = useLibraryStore()

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

  function refresh(): void {
    void rulesStore.fetchAll().catch((err) => { logger.warn('IrEditor', '规则加载失败，仅预览', err) })
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
    return dimColor(key || 'unknown')
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
    notify('已移除一段，可继续编辑', 'info', 1200)
  }

  function onDragEnd(evt: { oldIndex?: number; newIndex?: number }): void {
    const { oldIndex, newIndex } = evt
    if (oldIndex == null || newIndex == null || oldIndex === newIndex) return
    pushUndo()
    draft.value = moveSegment(draft.value, oldIndex, newIndex)
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
    notify('已应用修复', 'success', 1200)
  }

  const ruleDims = computed(() => library.dimensions.map((d) => ({ id: d.id, key: d.key, nameCn: d.nameCn })))
   const loadError = computed(() => rulesStore.loadError as string | null)
  const ruleModulesByDimId = computed(() => {
    const out: Record<string, { id: string; displayName: string }[]> = {}
    for (const [key, mods] of Object.entries(library.modulesByDim)) {
      const dim = library.dimensions.find((d) => d.key === key)
      if (dim) out[dim.id] = mods.map((m) => ({ id: m.id, displayName: m.displayName }))
    }
    return out
  })

  return {
    draft, lockedIndexes, ignoredIds, dirty, tab, expandedPreview, expandedSeg,
    highlightIdx, fixingId, undoStack, previewProfile, previewSeparator, previewBrackets,
    textDrafts, showSaveDialog, weightIdx, weightVal, weightPos,
    engineRules, findings, activeFindings, summary, badgeText, previewConfig,
     finalPreview, previewIr, hashShort, hasLocks, ruleDims, ruleModulesByDimId, loadError,
    refresh, ensureInit, segBg, dimNameOf, markDirty,
    onUndo, onAddSeg, onTextInput, confirmText, onWeightFloat, confirmWeightFloat, cancelWeightFloat,
    onToggleLock, onUnlockAll, onDeleteSeg, onDragEnd, locateSegment,
    onIgnore, onUnignore, onIgnoreAll, onApplyFix,
  }
}
