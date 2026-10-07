<script setup lang="ts">
import { ref, computed } from 'vue'
import { notify } from '@/lib/notify'
import { exportSingleCsv } from '@/lib/export'
import { evaluateRules } from '@/engine/ruleEngine'
import { useRulesStore } from '@/stores/rules'
import type { PromptIR } from '@/engine/models'
import { logger } from '@/lib/logger'
 import { useOverlayClose } from '@/composables/useOverlayClose'
import IrConflictEditorDialog from './IrConflictEditorDialog.vue'

const props = withDefaults(defineProps<{
  open: boolean
  prompt?: string
  warnings?: string[]
  ir?: PromptIR | null
}>(), {
  prompt: '',
  warnings: () => [],
  ir: null,
})

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'close'): void
}>()

const expanded = ref(false)
const showIr = ref(false)
const showIrEditor = ref(false)

let rulesStore: ReturnType<typeof useRulesStore> | null = null
function getRulesStore(): ReturnType<typeof useRulesStore> | null {
  try {
    rulesStore ??= useRulesStore()
    return rulesStore
  } catch (err) {
    logger.warn('PromptPreview', 'getRulesStore', err)
    return null
  }
}

const liveFindings = computed(() => {
  if (!props.ir) return []
  try {
    const store = getRulesStore()
    const rules = store ? store.toEngineRules() : []
    if (rules.length === 0) return props.ir.findings ?? []
    return evaluateRules({ segments: props.ir.segments, rules })
  } catch (err) {
    logger.warn('PromptPreview', 'liveFindings', err)
    return props.ir.findings ?? []
  }
})

const badgeType = computed(() => {
  if (liveFindings.value.some((f) => f.severity === 'error')) return 'danger' as const
  if (liveFindings.value.length > 0 || hasWarnings.value) return 'warning' as const
  return 'info' as const
})

const isEmpty = computed(() => !props.prompt?.trim())
const hasWarnings = computed(() => (props.warnings?.length ?? 0) > 0)

const badgeText = computed(() => {
  const live = liveFindings.value
  if (live.some((f) => f.severity === 'error')) return `⛔ ${live.length} 错误`
  if (live.length > 0) return `⚠ ${live.length} 冲突`
  const n = props.warnings?.length ?? 0
  if (n === 0) return '✓ 无冲突'
  const first = props.warnings![0] ?? ''
  if (first.includes('套装')) return `⚠ ${n} 套装互斥`
  if (first.includes('裸足')) return `⚠ ${n} 裸足冲突`
  if (first.includes('室内')) return `⚠ ${n} 室内外冲突`
  return `⚠ ${n} 冲突`
})

const irJson = computed(() => {
  if (!props.ir) return '—'
  try {
    return JSON.stringify({ segments: props.ir.segments, warnings: props.ir.warnings }, null, 2)
  } catch (err) {
    logger.warn('PromptPreview', 'irJson', err)
    return String(props.ir)
  }
})

function onClose(): void {
  emit('update:open', false)
  emit('close')
}
 
 const oc = useOverlayClose(() => { if (showIrEditor.value) return; onClose() }, { open: computed(() => props.open) })

function toggleExpanded(): void {
  expanded.value = !expanded.value
}

function onToggleIr(): void {
  showIr.value = !showIr.value
}

async function onCopy(): Promise<void> {
  if (!props.prompt?.trim()) {
    notify('暂无可复制的 Prompt', 'warning')
    return
  }
  try {
    await navigator.clipboard.writeText(props.prompt)
    notify('已复制到剪贴板', 'success', 1500)
  } catch (err) {
    logger.warn('PromptPreview', 'copy降级', err)
    const ta = document.createElement('textarea')
    ta.value = props.prompt
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    notify('已复制到剪贴板', 'success', 1500)
  }
}

function onExport(): void {
  if (!props.prompt?.trim()) {
    notify('暂无可导出的 Prompt', 'warning')
    return
  }
  if (!props.ir) {
    const fakeIr = { segments: [{ dimensionKey: '', text: props.prompt, weight: 1, sourceModuleId: '' }], warnings: props.warnings ?? [] } as PromptIR
    exportSingleCsv(fakeIr, props.prompt)
    notify('已导出 CSV', 'success', 1500)
    return
  }
  exportSingleCsv(props.ir, props.prompt)
  notify('已导出 CSV', 'success', 1500)
}

function onOpenIrEditor(): void {
  const store = getRulesStore()
  if (store && !store.loaded) void store.fetchAll().catch((err: unknown) => logger.warn('PromptPreview', 'fetchAll', err))
  showIrEditor.value = true
}
</script>

<template>
  <div
    v-if="open"
    data-testid="preview-dialog-overlay"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
     @mousedown="oc.onMouseDown" @click="oc.onClick"
  >
    <div
      data-testid="preview-dialog"
      role="dialog"
      aria-label="预览"
      class="flex max-h-[86vh] w-[720px] max-w-full flex-col rounded-lg border bg-card p-4 shadow-xl"
      @click.stop
    >
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold">预览</span>
        <el-tag size="small" :type="badgeType" data-testid="preview-badge">{{ badgeText }}</el-tag>
      </div>
      <div class="mt-2 flex items-center gap-1">
        <el-button data-testid="preview-copy-btn" plain size="small" :disabled="isEmpty" @click="onCopy">复制</el-button>
        <el-button data-testid="preview-export-btn" plain size="small" :disabled="isEmpty" @click="onExport">导出</el-button>
        <el-button data-testid="ir-editor-open" plain size="small" :disabled="!ir" title="打开 IR 冲突编辑器：分段改字/改权重/删段/排序，一键修复冲突" @click="onOpenIrEditor">冲突编辑</el-button>
        <el-button text size="small" @click="onClose">✕</el-button>
      </div>
      <div class="mt-3 rounded-md border bg-muted/30 p-3">
        <p v-if="isEmpty" data-testid="preview-empty" class="font-mono text-sm text-muted-foreground">暂无拼装 — 从左侧添加词条后此处实时预览</p>
        <template v-else>
          <p data-testid="preview-prompt" class="font-mono text-sm whitespace-pre-wrap break-words" :class="expanded ? '' : 'line-clamp-4'">{{ prompt }}</p>
          <div class="mt-2 flex items-center justify-between">
            <span class="text-xs text-muted-foreground">{{ prompt.length }} 字符 · {{ ir?.segments.length ?? 0 }} 段</span>
            <el-button v-if="prompt.length > 400" data-testid="preview-expand-btn" text size="small" @click="toggleExpanded">{{ expanded ? '折叠' : '展开' }}</el-button>
          </div>
        </template>
      </div>
      <div data-testid="preview-ir-area" class="mt-3 flex min-h-0 flex-1 flex-col rounded-md border bg-muted/20 p-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-muted-foreground">PromptIR — 中间表示</span>
          <el-button data-testid="preview-ir-toggle" text size="small" @click="onToggleIr">{{ showIr ? '隐藏 IR' : '显示 IR' }}</el-button>
        </div>
        <div v-if="showIr" class="mt-2 flex min-h-0 flex-1 gap-3 overflow-hidden">
          <pre data-testid="preview-ir-json" class="max-h-[22vh] flex-1 overflow-auto rounded bg-muted p-2 font-mono text-xs">{{ irJson }}</pre>
          <div v-if="warnings?.length" data-testid="preview-warnings" class="w-[280px] shrink-0 overflow-auto rounded bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <p class="font-medium">Warnings</p>
            <ul class="mt-1 list-disc pl-4"><li v-for="(w,i) in warnings" :key="i">{{ w }}</li></ul>
          </div>
        </div>
        <div v-else class="mt-2">
          <p v-if="warnings?.length" data-testid="preview-warnings-collapsed" class="truncate text-xs text-amber-600 dark:text-amber-400" :title="warnings.join('\n')">{{ warnings.join('；') }}</p>
          <p v-else class="text-xs text-muted-foreground">无警告 · IR 已就绪</p>
        </div>
      </div>
      <div class="mt-3 flex justify-end">
        <el-button data-testid="preview-close-btn" plain size="small" @click="onClose">关闭</el-button>
      </div>
    </div>
    <IrConflictEditorDialog :open="showIrEditor" :ir="ir" @update:open="showIrEditor = $event" />
  </div>
</template>
