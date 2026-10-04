<script setup lang="ts">
import type { ParsedTranslation, TranslationRow } from '@/lib/translationParse'
import type { TranslationUpdateReport } from '@/lib/db'

export type TranslateFilter = 'all' | 'ok' | 'unknown' | 'empty' | 'duplicate'

defineProps<{
  parsed: ParsedTranslation | null
  pagedRows: TranslationRow[]
  filteredCount: number
  totalPages: number
  curPage: number
  pageSize: number
  filter: TranslateFilter
  search: string
  editingId: string | null
  editingValue: string
  selectedCount: number
  canApply: boolean
  applying: boolean
  report: TranslationUpdateReport | null
}>()

defineEmits<{
  (e: 'filter-change', v: TranslateFilter): void
  (e: 'update:search', v: string): void
  (e: 'row-toggle', id: string, v: boolean): void
  (e: 'page-prev'): void
  (e: 'page-next'): void
  (e: 'select-all'): void
  (e: 'deselect-all'): void
  (e: 'select-page'): void
  (e: 'invert'): void
  (e: 'edit-start', id: string): void
  (e: 'edit-confirm', id: string): void
  (e: 'edit-cancel'): void
  (e: 'update:editingValue', v: string): void
  (e: 'apply'): void
  (e: 'back-step2'): void
  (e: 'clear-all'): void
}>()

function statusLabel(s: string): string {
  if (s === 'ok') return '待回填'
  if (s === 'unknownId') return '非本维度'
  if (s === 'emptyZh') return '空值'
  return '重复'
}
</script>

<template>
  <section data-testid="translate-step-3" class="space-y-3">
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
          <button class="rounded px-2 py-1" :class="filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="$emit('filter-change', 'all')">全部</button>
          <button class="rounded px-2 py-1" :class="filter === 'ok' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="$emit('filter-change', 'ok')">待复核</button>
          <button class="rounded px-2 py-1" :class="filter === 'unknown' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="$emit('filter-change', 'unknown')">非本维度</button>
          <button class="rounded px-2 py-1" :class="filter === 'duplicate' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="$emit('filter-change', 'duplicate')">重复</button>
          <button class="rounded px-2 py-1" :class="filter === 'empty' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="$emit('filter-change', 'empty')">空值</button>
        </div>
        <el-input :model-value="search" placeholder="搜索 id / 英文 / 中文…" size="small" class="max-w-[200px]" @update:model-value="$emit('update:search', String($event))" />
      </div>

      <div class="flex flex-wrap gap-1 text-xs">
        <el-button plain size="small" @click="$emit('select-all')">全选合法</el-button>
        <el-button plain size="small" @click="$emit('deselect-all')">取消全选</el-button>
        <el-button plain size="small" @click="$emit('select-page')">仅选当前页</el-button>
        <el-button plain size="small" @click="$emit('invert')">反选</el-button>
        <span class="px-2 py-1 text-muted-foreground">已选 {{ selectedCount }} 条</span>
      </div>

      <div data-testid="translate-preview" class="max-h-[320px] overflow-auto rounded border">
        <p v-if="filteredCount === 0" class="py-6 text-center text-xs text-muted-foreground">无匹配行</p>
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
              @change="$emit('row-toggle', r.id, ($event.target as HTMLInputElement).checked)"
            />
            <span class="w-28 shrink-0 truncate font-mono text-[11px]" :title="r.id">[{{ r.id }}]</span>
            <span class="min-w-0 flex-1 truncate text-muted-foreground" :title="r.contentEn">{{ r.contentEn || '—' }}</span>
            <span class="text-muted-foreground">→</span>
            <span v-if="editingId !== r.id" class="min-w-0 flex-1 truncate font-medium" :title="r.newZh" @click="r.status === 'ok' && $emit('edit-start', r.id)">{{ r.newZh }}</span>
            <el-input
              v-else
              :model-value="editingValue"
              size="small"
              class="flex-1"
              @update:model-value="$emit('update:editingValue', String($event))"
              @keydown.enter="$emit('edit-confirm', r.id)"
              @keydown.escape="$emit('edit-cancel')"
              @blur="$emit('edit-confirm', r.id)"
            />
            <span class="hidden max-w-[120px] truncate text-[11px] text-muted-foreground sm:inline" :title="r.oldDisplayName">{{ r.oldDisplayName }}</span>
            <span
              class="shrink-0 rounded px-1.5 py-0.5 text-[11px]"
              :class="r.status === 'ok' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-100' : r.status === 'unknownId' ? 'bg-amber-100 text-amber-800' : r.status === 'emptyZh' ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground'"
            >{{ statusLabel(r.status) }}</span>
            <span v-if="r.warnings.length" class="shrink-0 text-amber-600" :title="r.warnings.join('；')">⚠</span>
          </div>
          <div v-if="filteredCount > pageSize" class="flex items-center justify-center gap-2 p-2 text-xs">
            <el-button plain size="small" :disabled="curPage <= 1" @click="$emit('page-prev')">‹</el-button>
            <span>{{ curPage }} / {{ totalPages }}</span>
            <el-button plain size="small" :disabled="curPage >= totalPages" @click="$emit('page-next')">›</el-button>
          </div>
        </template>
      </div>

      <div class="flex gap-2">
        <el-button data-testid="translate-apply-btn" type="primary" size="small" :disabled="!canApply" @click="$emit('apply')">{{ applying ? '应用中…' : `应用到词库（${selectedCount} 条）` }}</el-button>
        <el-button plain size="small" @click="$emit('back-step2')">返回修改</el-button>
        <el-button text size="small" @click="$emit('clear-all')">清空重来</el-button>
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
</template>
