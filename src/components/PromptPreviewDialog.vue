<script setup lang="ts">
import { ref, computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useToast } from '@/composables/useToast'
import { exportSingleCsv } from '@/lib/export'
import type { PromptIR } from '@/engine/models'

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
const { push } = useToast()

const isEmpty = computed(() => !props.prompt?.trim())
const hasWarnings = computed(() => (props.warnings?.length ?? 0) > 0)

const badgeText = computed(() => {
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
  } catch {
    return String(props.ir)
  }
})

function onClose(): void {
  emit('update:open', false)
  emit('close')
}

function toggleExpanded(): void {
  expanded.value = !expanded.value
}

function onToggleIr(): void {
  showIr.value = !showIr.value
}

async function onCopy(): Promise<void> {
  if (!props.prompt?.trim()) {
    push('暂无可复制的 Prompt', 'warning')
    return
  }
  try {
    await navigator.clipboard.writeText(props.prompt)
    push('已复制到剪贴板', 'success', 1500)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = props.prompt
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
  if (!props.prompt?.trim()) {
    push('暂无可导出的 Prompt', 'warning')
    return
  }
  if (!props.ir) {
    const fakeIr = { segments: [{ dimensionKey: '', text: props.prompt, weight: 1, sourceModuleId: '' }], warnings: props.warnings ?? [] } as PromptIR
    exportSingleCsv(fakeIr, props.prompt)
    push('已导出 CSV', 'success', 1500)
    return
  }
  exportSingleCsv(props.ir, props.prompt)
  push('已导出 CSV', 'success', 1500)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') onClose()
}
</script>

<template>
  <div
    v-if="open"
    data-testid="preview-dialog-overlay"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    @click.self="onClose"
    @keydown="onKeydown"
  >
    <Card
      data-testid="preview-dialog"
      class="flex max-h-[min(78vh,720px)] w-[min(720px,92vw)] flex-col p-4 shadow-xl"
      @click.stop
    >
      <!-- 标题行 -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-semibold">预览</h3>
          <Badge :variant="hasWarnings ? 'destructive' : 'secondary'" data-testid="preview-badge">{{ badgeText }}</Badge>
        </div>
        <div class="flex items-center gap-1">
          <Button data-testid="preview-copy-btn" variant="outline" size="sm" class="h-7 text-xs" :disabled="isEmpty" @click="onCopy">复制</Button>
          <Button data-testid="preview-export-btn" variant="outline" size="sm" class="h-7 text-xs" :disabled="isEmpty" @click="onExport">导出</Button>
          <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="onClose">✕</Button>
        </div>
      </div>

      <!-- Prompt 全文 -->
      <div class="mt-3 rounded-md border bg-muted/30 p-3">
        <p v-if="isEmpty" data-testid="preview-empty" class="font-mono text-sm text-muted-foreground">暂无拼装 — 从左侧添加词条后此处实时预览</p>
        <template v-else>
          <p data-testid="preview-prompt" class="font-mono text-sm whitespace-pre-wrap break-words" :class="expanded ? '' : 'line-clamp-4'">{{ prompt }}</p>
          <div class="mt-2 flex items-center justify-between">
            <span class="text-xs text-muted-foreground">{{ prompt.length }} 字符 · {{ ir?.segments.length ?? 0 }} 段</span>
            <Button v-if="prompt.length > 400" data-testid="preview-expand-btn" variant="ghost" size="sm" class="h-6 text-xs" @click="toggleExpanded">{{ expanded ? '折叠' : '展开' }}</Button>
          </div>
        </template>
      </div>

      <!-- IR 审阅 -->
      <div data-testid="preview-ir-area" class="mt-3 flex min-h-0 flex-1 flex-col rounded-md border bg-muted/20 p-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-muted-foreground">PromptIR — 中间表示</span>
          <Button data-testid="preview-ir-toggle" variant="ghost" size="sm" class="h-6 text-xs" @click="onToggleIr">{{ showIr ? '隐藏 IR' : '显示 IR' }}</Button>
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
        <Button data-testid="preview-close-btn" variant="outline" size="sm" class="h-7 text-xs" @click="onClose">关闭</Button>
      </div>
    </Card>
  </div>
</template>
