<script setup lang="ts">
import type { ParsedPrompt } from '@/lib/segmentParse'
import type { Dimension } from '@/engine/models'
import type {
  SegmentFilter,
  SegmentImportMode,
  SegmentImportSummary,
  UnassignedStrategy,
} from '@/composables/useSegmentImport'

const props = defineProps<{
  filter: SegmentFilter
  dimensions: Dimension[]
  stats: { prompts: number; total: number; unassigned: number; needsReview: number; errors: number } | null
  prompts: ParsedPrompt[]
  filteredCount: number
  currentPage: number
  totalPages: number
  pageSize: number
  selectedCount: number
  selectedKeys: string[]
  importing: boolean
  unassignedStrategy: UnassignedStrategy
  importMode: SegmentImportMode
  report: SegmentImportSummary | null
}>()

const emit = defineEmits<{
  (e: 'filter-change', v: SegmentFilter): void
  (e: 'row-toggle', promptId: string, idx: number): void
  (e: 'row-remap', promptId: string, idx: number, newKey: string): void
  (e: 'page-prev'): void
  (e: 'page-next'): void
  (e: 'update:unassignedStrategy', v: UnassignedStrategy): void
  (e: 'update:importMode', v: SegmentImportMode): void
  (e: 'validate'): void
  (e: 'import'): void
}>()

function isSelected(p: ParsedPrompt, idx: number): boolean {
  return props.selectedKeys.includes(`${p.id}::${idx}`)
}
</script>

<template>
  <section data-testid="segment-step3" class="space-y-3">
    <div class="flex items-center justify-between">
      <p class="text-sm font-medium">③ 预览与导入</p>
      <select
        data-testid="segment-filter"
        :value="filter"
        class="rounded border bg-background px-2 py-1 text-xs"
        @change="emit('filter-change', ($event.target as HTMLSelectElement).value as SegmentFilter)"
      >
        <option value="all">全部</option>
        <option value="needs_review">待复核</option>
        <option value="unassigned">未分配</option>
        <option value="error">错误</option>
      </select>
    </div>

    <el-alert
      v-if="stats"
      data-testid="segment-stats"
      type="info"
      :closable="false"
      show-icon
      class="!rounded-md !text-xs"
    >
      <template #title>
        统计：{{ stats.prompts }} prompts · {{ stats.total }} segments · {{ stats.unassigned }} unassigned ·
        {{ stats.needsReview }} 待复核 · {{ stats.errors }} 错误 · 已勾选 {{ selectedCount }}
      </template>
    </el-alert>

    <el-radio-group
      v-if="stats"
      :model-value="filter"
      size="small"
      @update:model-value="emit('filter-change', $event as SegmentFilter)"
    >
      <el-radio-button value="all">全部</el-radio-button>
      <el-radio-button value="needs_review">待复核</el-radio-button>
      <el-radio-button value="unassigned">未分配</el-radio-button>
      <el-radio-button value="error">错误</el-radio-button>
    </el-radio-group>

    <div data-testid="segment-preview" class="space-y-2">
      <el-empty v-if="prompts.length === 0" description="暂无预览 — 请先在第 2 步粘贴并解析 LLM 输出" :image-size="48" />
      <template v-else>
        <el-card
          v-for="p in prompts"
          :key="p.id"
          :data-testid="`segment-prompt-card-${p.id}`"
          shadow="never"
          class="rounded-md"
          :class="p.status === 'error' ? 'border-red-300' : p.status === 'needs_review' ? 'border-amber-200' : ''"
        >
          <p class="truncate text-xs text-muted-foreground" :title="p.raw">
            raw: {{ p.raw.slice(0, 120) }}{{ p.raw.length > 120 ? '…' : '' }}
          </p>
          <p v-if="p.warnings.length" class="mt-1 text-xs text-amber-700">{{ p.warnings.join('；') }}</p>
          <p v-if="p.errors.length" class="mt-1 text-xs text-red-600">{{ p.errors.join('；') }}</p>
          <div class="mt-2 space-y-1">
            <div
              v-for="(s, idx) in p.segments"
              :key="idx"
              :data-testid="`segment-row-${p.id}-${idx}`"
              class="flex items-center gap-2 rounded px-2 py-1 text-xs"
            >
              <input
                :data-testid="`segment-row-checkbox-${p.id}-${idx}`"
                type="checkbox"
                :checked="isSelected(p, idx)"
                @change="emit('row-toggle', p.id, idx)"
              />
              <el-tag size="small" effect="plain" class="!font-mono !text-[11px]">[{{ s.dimensionKey }}]</el-tag>
              <span class="min-w-0 flex-1 truncate" :title="s.contentEn">{{ s.contentEn }}</span>
              <span v-if="s.weight != null && s.weight !== 1" class="shrink-0 text-muted-foreground">w{{ s.weight }}</span>
              <span v-if="s.isNsfw" class="h-2 w-2 shrink-0 rounded-full bg-red-500" title="NSFW" />
              <span v-if="s.warnings.length" class="shrink-0 text-amber-600" :title="s.warnings.join('；')">⚠</span>
              <select
                v-if="s.status === 'warning' || s.status === 'error'"
                class="max-w-[110px] shrink-0 rounded border bg-background px-1 py-0.5 text-[11px]"
                :value="s.dimensionKey"
                @change="emit('row-remap', p.id, idx, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="d in dimensions" :key="d.key" :value="d.key">{{ d.key }}</option>
                <option value="unassigned">unassigned</option>
              </select>
            </div>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            维度未知：{{ p.stats.unknownDimension }} · 未分配：{{ p.stats.unassigned }}
          </p>
        </el-card>
        <div v-if="filteredCount > pageSize" class="flex items-center justify-center gap-2 text-xs">
          <el-button plain size="small" :disabled="currentPage <= 1" @click="emit('page-prev')">‹</el-button>
          <span>{{ currentPage }} / {{ totalPages }}</span>
          <el-button plain size="small" :disabled="currentPage >= totalPages" @click="emit('page-next')">›</el-button>
          <span class="text-muted-foreground">每页 {{ pageSize }} prompts</span>
        </div>
      </template>
    </div>

    <div class="space-y-2 rounded-md border bg-muted/20 p-2 text-xs">
      <div class="flex flex-wrap items-center gap-3">
        <span class="font-medium">未分配处理：</span>
        <label class="flex items-center gap-1">
          <input
            type="radio"
            value="ignore"
            :checked="unassignedStrategy === 'ignore'"
            data-testid="segment-unassigned-ignore"
            @change="emit('update:unassignedStrategy', 'ignore')"
          />
          忽略
        </label>
        <label class="flex items-center gap-1">
          <input
            type="radio"
            value="to_camera"
            :checked="unassignedStrategy === 'to_camera'"
            data-testid="segment-unassigned-to-camera"
            @change="emit('update:unassignedStrategy', 'to_camera')"
          />
          归入 camera
        </label>
        <label class="flex items-center gap-1">
          <input
            type="radio"
            value="prompt_new"
            :checked="unassignedStrategy === 'prompt_new'"
            data-testid="segment-unassigned-prompt-new"
            @change="emit('update:unassignedStrategy', 'prompt_new')"
          />
          提示新建维度
        </label>
      </div>
      <div class="flex flex-wrap items-center gap-3" data-testid="segment-import-mode">
        <span class="font-medium">去重命中“已存在”的词条：</span>
        <label class="flex items-center gap-1">
          <input
            type="radio"
            value="skip"
            :checked="importMode === 'skip'"
            data-testid="segment-mode-skip"
            @change="emit('update:importMode', 'skip')"
          />
          跳过
        </label>
        <label class="flex items-center gap-1">
          <input
            type="radio"
            value="overwrite"
            :checked="importMode === 'overwrite'"
            data-testid="segment-mode-overwrite"
            @change="emit('update:importMode', 'overwrite')"
          />
          覆盖更新
        </label>
      </div>
    </div>

    <div class="flex gap-2">
      <el-button data-testid="segment-validate-btn" plain size="small" @click="emit('validate')">仅校验</el-button>
      <el-button
        data-testid="segment-import-btn"
        type="primary"
        size="small"
        :disabled="importing || selectedCount === 0"
        @click="emit('import')"
      >
        {{ importing ? '导入中…' : `导入勾选项 ${selectedCount} 条` }}
      </el-button>
    </div>

    <el-card v-if="report" data-testid="segment-report" shadow="never" class="rounded-md">
      <p class="text-xs font-medium">导入报告</p>
      <p data-testid="segment-report-modules" class="text-xs">
        词条：新增 {{ report.modulesCreated }} · 更新 {{ report.modulesUpdated }} · 跳过 {{ report.modulesSkipped }}
      </p>
      <p class="text-xs">
        片段：导入 {{ report.segmentsImported }} · 跳过 {{ report.segmentsSkipped }} · 已忽略未分配
        {{ report.segmentsIgnoredUnassigned }}
      </p>
      <p v-if="report.errors.length" data-testid="segment-report-errors" class="mt-1 text-xs text-red-600">
        错误：{{ report.errors.slice(0, 3).join('；') }}{{ report.errors.length > 3 ? ` …（共 ${report.errors.length} 条）` : '' }}
      </p>
      <p v-if="report.warnings.length" class="mt-1 text-xs text-amber-700">
        警告：{{ report.warnings.slice(0, 3).join('；') }}{{ report.warnings.length > 3 ? ` …（共 ${report.warnings.length} 条）` : '' }}
      </p>
    </el-card>
  </section>
</template>