<script setup lang="ts">
import { ref, computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/composables/useToast'
import type { PromptIR } from '@/engine/models'

const props = withDefaults(defineProps<{
  prompt?: string
  warnings?: string[]
  ir?: PromptIR | null
}>(), {
  prompt: '',
  warnings: () => [],
  ir: null,
})

const expanded = ref(false)
const showIr = ref(false)

const { push } = useToast()

const hasWarnings = computed(() => (props.warnings?.length ?? 0) > 0)
const badgeText = computed(() => {
  const n = props.warnings?.length ?? 0
  if (n === 0) return '✓ 无冲突'
  // 取首条警告做简述，或显示计数
  const first = props.warnings![0] ?? ''
  // 尝试提取关键信息
  if (first.includes('套装')) return `⚠ ${n} 套装互斥`
  if (first.includes('裸足')) return `⚠ ${n} 裸足冲突`
  if (first.includes('室内')) return `⚠ ${n} 室内外冲突`
  return `⚠ ${n} 冲突`
})

const isEmpty = computed(() => !props.prompt || props.prompt.trim().length === 0)

function toggleExpanded(): void {
  expanded.value = !expanded.value
}

function onToggleIr(): void {
  showIr.value = !showIr.value
}

async function onCopy(): Promise<void> {
  const text = props.prompt ?? ''
  if (!text) {
    push('暂无可复制的 Prompt', 'warning')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    push('已复制到剪贴板', 'success', 1500)
  } catch {
    // fallback: textarea
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
  const text = props.prompt ?? ''
  if (!text) {
    push('暂无可导出的 Prompt', 'warning')
    return
  }
  // 阶段三占位：前端 CSV 导出；阶段六接 Rust db_export_csv
  const csv = '\uFEFFprompt,warnings\n' + `"${text.replace(/"/g, '""')}","${(props.warnings ?? []).join('; ').replace(/"/g, '""')}"\n`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pmf-prompt-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
  push('已导出 CSV', 'success', 1500)
}

const irJson = computed(() => {
  if (!props.ir) return '—'
  try {
    return JSON.stringify({ segments: props.ir.segments, warnings: props.ir.warnings }, null, 2)
  } catch {
    return String(props.ir)
  }
})
</script>

<template>
  <header
    data-testid="topbar"
    class="flex w-full shrink-0 flex-col border-b bg-card transition-all duration-200"
    :style="{ height: expanded ? '168px' : '88px' }"
    :class="expanded ? 'h-[168px]' : 'h-[88px]'"
  >
    <!-- 主行 88px -->
    <div class="flex h-[88px] shrink-0 items-center gap-3 px-4 md:px-6">
      <!-- badge 120px -->
      <div class="flex w-[120px] shrink-0 items-center">
        <Badge
          data-testid="topbar-badge"
          :variant="hasWarnings ? 'destructive' : 'secondary'"
          class="max-w-[120px] truncate"
          :class="hasWarnings ? 'bg-amber-500 text-white hover:bg-amber-600 border-transparent' : ''"
          :title="warnings?.join('\n')"
        >
          {{ badgeText }}
        </Badge>
      </div>

      <!-- prompt flex-1 truncate -->
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <p
          v-if="isEmpty"
          data-testid="topbar-empty"
          class="truncate font-mono text-sm text-muted-foreground"
        >
          暂无拼装 — 从左侧添加词条后此处实时预览
        </p>
        <p
          v-else
          data-testid="topbar-prompt"
          class="min-w-0 flex-1 font-mono text-sm"
          :class="expanded ? 'whitespace-pre-wrap break-words overflow-y-auto max-h-24' : 'truncate'"
          :title="prompt"
        >
          {{ prompt }}
        </p>
        <Button
          v-if="!isEmpty"
          data-testid="topbar-expand-btn"
          variant="ghost"
          size="sm"
          class="shrink-0"
          @click="toggleExpanded"
        >
          {{ expanded ? '折叠' : '展开' }}
        </Button>
      </div>

      <!-- actions 160px -->
      <div class="flex w-[160px] shrink-0 items-center justify-end gap-2">
        <Button data-testid="topbar-copy-btn" variant="outline" size="sm" @click="onCopy">
          复制
        </Button>
        <Button data-testid="topbar-export-btn" variant="outline" size="sm" @click="onExport">
          导出
        </Button>
      </div>
    </div>

    <!-- IR 折叠区 80px (展开时可见) -->
    <div
      v-if="expanded"
      data-testid="topbar-ir-area"
      class="flex min-h-0 flex-1 flex-col border-t bg-muted/20 px-4 py-2 md:px-6"
    >
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-muted-foreground">PromptIR — 中间表示</span>
        <Button variant="ghost" size="sm" class="h-6 px-2 text-xs" data-testid="topbar-ir-toggle" @click="onToggleIr">
          {{ showIr ? '隐藏 IR' : '显示 IR' }}
        </Button>
      </div>
      <div v-if="showIr" class="mt-1 flex min-h-0 flex-1 gap-3 overflow-hidden">
        <pre
          data-testid="topbar-ir-json"
          class="max-h-20 flex-1 overflow-auto rounded bg-muted p-2 font-mono text-xs"
        >{{ irJson }}</pre>
        <div v-if="warnings && warnings.length" data-testid="topbar-warnings" class="w-[280px] shrink-0 overflow-auto rounded bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <p class="font-medium">Warnings</p>
          <ul class="mt-1 list-disc pl-4">
            <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
          </ul>
        </div>
      </div>
      <div v-else class="mt-1 flex-1">
        <p
          v-if="warnings && warnings.length"
          data-testid="topbar-warnings-collapsed"
          class="truncate text-xs text-amber-600 dark:text-amber-400"
          :title="warnings.join('\n')"
        >
          {{ warnings.join('；') }}
        </p>
        <p v-else class="text-xs text-muted-foreground">无警告 · IR 已就绪</p>
      </div>
    </div>
  </header>
</template>
