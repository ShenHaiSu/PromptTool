<script setup lang="ts">
import type { ParsedFragmentBatch } from '@/lib/fragmentGenerateParse'
import type { BatchCreateReport } from '@/lib/db'

export type GenerateFilter = 'all' | 'ok' | 'dupDb' | 'dupBatch' | 'tooLong'
export type ImportMode = 'skip' | 'overwrite'

export interface GeneratePreviewRow {
  index: number
  contentEn: string
  displayName: string
  status: string
  tooLong: boolean
  selected: boolean
  warnings: string[]
}

defineProps<{
  parsed: ParsedFragmentBatch | null
  pagedRows: GeneratePreviewRow[]
  filteredCount: number
  totalPages: number
  curPage: number
  pageSize: number
  filter: GenerateFilter
  search: string
  selectedCount: number
  canApply: boolean
  applying: boolean
  importMode: ImportMode
  importWeight: number
  importNsfw: boolean
  report: BatchCreateReport | null
}>()

defineEmits<{
  (e: 'filter-change', v: GenerateFilter): void
  (e: 'update:search', v: string): void
  (e: 'row-toggle', index: number, v: boolean): void
  (e: 'page-prev'): void
  (e: 'page-next'): void
  (e: 'select-all'): void
  (e: 'deselect-all'): void
  (e: 'select-page'): void
  (e: 'invert'): void
  (e: 'update:importMode', v: ImportMode): void
  (e: 'update:importWeight', v: number): void
  (e: 'update:importNsfw', v: boolean): void
  (e: 'apply'): void
  (e: 'back-step2'): void
  (e: 'back-step1'): void
  (e: 'clear-all'): void
  (e: 'close'): void
}>()

function rowPill(r: { status: string; tooLong: boolean }): string {
  if (r.status === 'ok') return r.tooLong ? '待入库·已截断' : '待入库'
  if (r.status === 'duplicate_in_db') return '库内重复'
  if (r.status === 'duplicate_in_batch') return '批内重复'
  if (r.status === 'empty') return '空行'
  return '异常'
}
</script>

<template>
  <section data-testid="generate-step-3" class="space-y-3">
    <div class="flex items-center justify-between">
      <p class="text-sm font-medium">③ 预览与入库</p>
      <span v-if="parsed" data-testid="generate-stats" class="rounded bg-muted px-2 py-1 text-xs">
        共 {{ parsed.stats.total }} 条 · 可入库 {{ parsed.stats.valid }} · 库内重复 {{ parsed.stats.dupDb }} · 批内重复 {{ parsed.stats.dupBatch }} · 超长 {{ parsed.stats.tooLong }}
      </span>
    </div>

    <div v-if="!parsed" class="py-6 text-center text-xs text-muted-foreground">
      暂无预览 — 请先在第 2 步粘贴并解析 LLM 输出
      <div class="mt-2"><el-button plain size="small" @click="$emit('back-step1')">返回 Step1 复制提示词</el-button></div>
    </div>
    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <div data-testid="generate-filter" class="flex gap-1 text-xs">
          <button class="rounded px-2 py-1" :class="filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="$emit('filter-change', 'all')">全部</button>
          <button class="rounded px-2 py-1" :class="filter === 'ok' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="$emit('filter-change', 'ok')">待入库</button>
          <button class="rounded px-2 py-1" :class="filter === 'dupDb' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="$emit('filter-change', 'dupDb')">库内重复</button>
          <button class="rounded px-2 py-1" :class="filter === 'dupBatch' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="$emit('filter-change', 'dupBatch')">批内重复</button>
          <button class="rounded px-2 py-1" :class="filter === 'tooLong' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="$emit('filter-change', 'tooLong')">超长</button>
        </div>
        <el-input :model-value="search" placeholder="搜索 英文 / 中文…" size="small" class="max-w-[200px]" @update:model-value="$emit('update:search', String($event))" />
      </div>

      <div class="flex flex-wrap gap-1 text-xs">
        <el-button plain size="small" @click="$emit('select-all')">全选合法</el-button>
        <el-button plain size="small" @click="$emit('deselect-all')">取消全选</el-button>
        <el-button plain size="small" @click="$emit('select-page')">仅选当前页</el-button>
        <el-button plain size="small" @click="$emit('invert')">反选</el-button>
        <span class="px-2 py-1 text-muted-foreground">已选 {{ selectedCount }} 条</span>
      </div>

      <div data-testid="generate-preview" class="max-h-[320px] overflow-auto rounded border">
        <p v-if="filteredCount === 0" class="py-6 text-center text-xs text-muted-foreground">无匹配行</p>
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
              @change="$emit('row-toggle', r.index, ($event.target as HTMLInputElement).checked)"
            />
            <span class="min-w-0 flex-1 truncate font-medium" :title="r.contentEn">{{ r.contentEn || '—' }}</span>
            <span class="hidden max-w-[140px] truncate text-muted-foreground sm:inline" :title="r.displayName">{{ r.displayName }}</span>
            <span
              class="shrink-0 rounded px-1.5 py-0.5 text-[11px]"
              :class="r.status === 'ok' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-100' : r.status === 'duplicate_in_db' ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground'"
            >{{ rowPill(r) }}</span>
            <span v-if="r.warnings.length" class="shrink-0 text-amber-600" :title="r.warnings.join('；')">⚠</span>
          </div>
          <div v-if="filteredCount > pageSize" class="flex items-center justify-center gap-2 p-2 text-xs">
            <el-button plain size="small" :disabled="curPage <= 1" @click="$emit('page-prev')">‹</el-button>
            <span>{{ curPage }} / {{ totalPages }}</span>
            <el-button plain size="small" :disabled="curPage >= totalPages" @click="$emit('page-next')">›</el-button>
          </div>
        </template>
      </div>

      <div class="flex flex-wrap items-center gap-3 rounded border bg-muted/20 p-2 text-xs">
        <label class="flex items-center gap-1" title="skip：精确英文去重，库内已有则跳过；overwrite：覆盖同英文词条。大小写敏感以后端为准">
          <span class="text-muted-foreground">去重模式</span>
          <select :value="importMode" class="rounded border bg-background px-2 py-1 text-xs" @change="$emit('update:importMode', ($event.target as HTMLSelectElement).value as ImportMode)">
            <option value="skip">skip 去重跳过</option>
            <option value="overwrite">overwrite 覆盖同英文</option>
          </select>
        </label>
        <label class="flex items-center gap-1">
          <span class="text-muted-foreground">默认权重</span>
          <input :value="importWeight" type="number" min="0.5" max="2.0" step="0.1" class="w-16 rounded border bg-background px-1 py-0.5 text-xs" @input="$emit('update:importWeight', Number(($event.target as HTMLInputElement).value))" />
        </label>
        <label class="flex items-center gap-1">
          <input :checked="importNsfw" type="checkbox" @change="$emit('update:importNsfw', ($event.target as HTMLInputElement).checked)" />
          <span class="text-muted-foreground">NSFW</span>
        </label>
        <span class="text-muted-foreground">精确英文去重，大小写敏感以后端为准</span>
      </div>

      <div class="flex gap-2">
        <el-button data-testid="generate-apply-btn" type="primary" size="small" :disabled="!canApply" @click="$emit('apply')">{{ applying ? '入库中…' : `应用到词库（${selectedCount} 条）` }}</el-button>
        <el-button plain size="small" @click="$emit('back-step2')">返回修改</el-button>
        <el-button text size="small" @click="$emit('clear-all')">清空重来</el-button>
        <el-button v-if="report && (report.modulesCreated > 0 || report.modulesUpdated > 0)" data-testid="generate-done-btn" plain size="small" @click="$emit('close')">完成并关闭</el-button>
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
</template>
