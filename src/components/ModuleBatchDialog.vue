<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useToast } from '@/composables/useToast'
import { dbBatchCreateModules } from '@/lib/db'
import { parseBatchText } from '@/lib/moduleBatch'
import type { ParsedBatch } from '@/lib/moduleBatch'
import type { Dimension } from '@/engine/models'

const props = defineProps<{
  open: boolean
  dimension: Dimension | null
}>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'imported'): void
}>()

const { push } = useToast()

const rawText = ref('')
const mode = ref<'skip' | 'overwrite'>('skip')
const weight = ref(1.0)
const isNsfw = ref(false)
const importing = ref(false)
const report = ref<null | { modulesCreated: number; modulesUpdated: number; modulesSkipped: number; errors: string[]; warnings: string[] }>(null)
const filter = ref<'all' | 'ok' | 'dup' | 'toolong'>('all')
const curPage = ref(1)
const pageSize = 50

const parsed = computed<ParsedBatch>(() => parseBatchText(rawText.value))

const validCount = computed(() => parsed.value.stats.valid)
const canCreate = computed(() => validCount.value > 0 && !importing.value)

const filteredLines = computed(() => {
  const all = parsed.value.lines
  if (filter.value === 'all') return all
  if (filter.value === 'ok') return all.filter((l) => l.status === 'ok' || l.status === 'too_long')
  if (filter.value === 'dup') return all.filter((l) => l.status === 'duplicate_in_batch')
  return all.filter((l) => l.status === 'too_long')
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredLines.value.length / pageSize)))
const pagedLines = computed(() => {
  const start = (curPage.value - 1) * pageSize
  return filteredLines.value.slice(start, start + pageSize)
})

watch(() => props.open, (o) => {
  if (o) {
    // do not clear rawText automatically — keep if user reopens quickly
    report.value = null
    curPage.value = 1
  }
})

watch(rawText, () => { curPage.value = 1 })

function onClose(): void {
  emit('update:open', false)
}

function onClear(): void {
  rawText.value = ''
  report.value = null
}

async function onValidate(): Promise<void> {
  const p = parsed.value
  push(`校验完成：有效 ${p.stats.valid} · 空行 ${p.stats.empty} · 重复 ${p.stats.duplicateInBatch} · 超长 ${p.stats.tooLong}`, 'info', 2000)
}

async function onCreate(): Promise<void> {
  if (!props.dimension) {
    push('维度不存在', 'error')
    return
  }
  if (validCount.value === 0) {
    push('请先粘贴至少一行有效内容', 'warning')
    return
  }
  const items = parsed.value.lines
    .filter((l) => l.status === 'ok' || l.status === 'too_long')
    .map((l) => ({
      contentEn: l.contentEn,
      displayName: l.displayName || null,
      weight: weight.value,
      isNsfw: isNsfw.value,
      notes: null,
    }))

  importing.value = true
  try {
    const r = await dbBatchCreateModules({
      dimId: props.dimension.id,
      items,
      mode: mode.value,
      weight: weight.value,
      isNsfw: isNsfw.value,
    })
    report.value = {
      modulesCreated: r.modulesCreated,
      modulesUpdated: r.modulesUpdated,
      modulesSkipped: r.modulesSkipped,
      errors: r.errors,
      warnings: r.warnings,
    }
    push(`已创建 ${r.modulesCreated} · 更新 ${r.modulesUpdated} · 跳过 ${r.modulesSkipped}`, 'success', 2500)
    emit('imported')
    // auto-close after 1.5s on full success
    if (r.errors.length === 0) {
      setTimeout(() => {
        if (props.open) onClose()
      }, 1500)
    }
  } catch (e) {
    push(`创建失败: ${String(e)}`, 'error')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div
    v-if="open"
    data-testid="module-batch-dialog"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    @click.self="onClose"
  >
    <div
      data-testid="module-batch-overlay"
      class="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border bg-background shadow-xl"
    >
      <div class="flex items-center justify-between border-b px-4 py-3">
        <h2 class="text-sm font-semibold">
          批量新增 — {{ dimension ? `${dimension.nameCn} / ${dimension.key}` : '—' }}
        </h2>
        <Button data-testid="module-batch-close" variant="ghost" size="sm" @click="onClose">✕</Button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <!-- 配置区 -->
        <Card class="p-3">
          <div class="space-y-3 text-xs">
            <div class="flex flex-wrap items-center gap-3">
              <span class="font-medium">去重策略：</span>
              <label class="flex items-center gap-1"><input type="radio" value="skip" :checked="mode === 'skip'" data-testid="module-batch-mode-skip" @change="mode = 'skip'" /> 跳过重复</label>
              <label class="flex items-center gap-1"><input type="radio" value="overwrite" :checked="mode === 'overwrite'" data-testid="module-batch-mode-overwrite" @change="mode = 'overwrite'" /> 覆盖更新</label>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <span class="font-medium">权重</span>
              <input data-testid="module-batch-weight-slider" type="range" :min="0.5" :max="2.0" :step="0.1" v-model.number="weight" class="flex-1" />
              <input data-testid="module-batch-weight" v-model.number="weight" type="number" :min="0.5" :max="2.0" :step="0.1" class="w-16 rounded border bg-background px-2 py-1 text-xs" />
              <label class="flex items-center gap-1"><input data-testid="module-batch-nsfw" type="checkbox" v-model="isNsfw" class="h-3.5 w-3.5 rounded border-input" /> NSFW</label>
            </div>
          </div>
        </Card>

        <!-- 粘贴区 -->
        <div class="mt-3 space-y-2">
          <textarea
            data-testid="module-batch-textarea"
            :value="rawText"
            placeholder="每行一条英文片段，按回车分隔&#10;例如：&#10;oversized white shirt&#10;cropped black tank top&#10;lace-trim silk camisole"
            class="min-h-[160px] w-full rounded-md border bg-background p-2 text-sm"
            rows="8"
            @input="rawText = ($event.target as HTMLTextAreaElement).value"
          />
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <Button variant="ghost" size="sm" class="h-7 text-xs" @click="onClear">清空</Button>
            <span data-testid="module-batch-stats" class="text-muted-foreground">
              已粘贴 {{ parsed.stats.valid }} 行 · 空行 {{ parsed.stats.empty }} · 重复行 {{ parsed.stats.duplicateInBatch }} · 超长 {{ parsed.stats.tooLong }}
            </span>
          </div>
          <p v-if="parsed.warnings.length" data-testid="module-batch-warnings" class="text-xs text-amber-600">{{ parsed.warnings.join('；') }}</p>
        </div>

        <!-- 预览区 -->
        <div class="mt-3 space-y-2">
          <div class="flex items-center justify-between">
            <p class="text-xs font-medium">预览</p>
            <div class="flex gap-1 text-xs">
              <button data-testid="module-batch-filter-all" class="rounded px-2 py-1" :class="filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="filter = 'all'; curPage = 1">全部</button>
              <button data-testid="module-batch-filter-ok" class="rounded px-2 py-1" :class="filter === 'ok' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="filter = 'ok'; curPage = 1">有效</button>
              <button data-testid="module-batch-filter-dup" class="rounded px-2 py-1" :class="filter === 'dup' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="filter = 'dup'; curPage = 1">重复</button>
              <button data-testid="module-batch-filter-toolong" class="rounded px-2 py-1" :class="filter === 'toolong' ? 'bg-primary text-primary-foreground' : 'bg-muted'" @click="filter = 'toolong'; curPage = 1">超长</button>
            </div>
          </div>
          <div data-testid="module-batch-preview" class="max-h-64 overflow-auto rounded border">
            <p v-if="filteredLines.length === 0" class="py-6 text-center text-xs text-muted-foreground">暂无内容 — 请粘贴文本</p>
            <template v-else>
              <div
                v-for="l in pagedLines"
                :key="l.lineNo"
                :data-testid="`module-batch-row-${l.lineNo}`"
                class="flex items-center gap-2 border-b px-2 py-1 text-xs last:border-0"
                :class="l.status === 'empty' ? 'bg-muted/30 text-muted-foreground' : l.status === 'duplicate_in_batch' ? 'bg-amber-50 dark:bg-amber-950/30' : l.status === 'too_long' ? 'bg-amber-50/70 dark:bg-amber-950/20' : 'bg-card'"
              >
                <span class="w-6 shrink-0 text-right text-muted-foreground">{{ l.lineNo }}</span>
                <span class="min-w-0 flex-1 truncate" :title="l.contentEn">{{ l.contentEn || '（空行）' }}</span>
                <span
                  class="shrink-0 rounded px-1.5 py-0.5 text-[11px]"
                  :class="l.status === 'ok' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-100' : l.status === 'too_long' ? 'bg-amber-100 text-amber-800' : l.status === 'duplicate_in_batch' ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground'"
                >{{ l.status === 'ok' ? '有效' : l.status === 'too_long' ? '超长截断' : l.status === 'duplicate_in_batch' ? '批次内重复' : '空行忽略' }}</span>
              </div>
              <div v-if="filteredLines.length > pageSize" class="flex items-center justify-center gap-2 p-2 text-xs">
                <Button variant="outline" size="sm" class="h-7" :disabled="curPage <= 1" @click="curPage--">‹</Button>
                <span>{{ curPage }} / {{ totalPages }}</span>
                <Button variant="outline" size="sm" class="h-7" :disabled="curPage >= totalPages" @click="curPage++">›</Button>
              </div>
            </template>
          </div>
        </div>

        <!-- 结果区 -->
        <div v-if="report" data-testid="module-batch-report" class="mt-3 rounded-md border bg-muted/30 p-3 text-xs">
          <p class="font-medium">结果</p>
          <p data-testid="module-batch-report-counts">成功 {{ report.modulesCreated }} · 更新 {{ report.modulesUpdated }} · 跳过 {{ report.modulesSkipped }}</p>
          <p v-if="report.errors.length" data-testid="module-batch-report-errors" class="mt-1 text-red-600">错误：{{ report.errors.slice(0, 3).join('；') }}{{ report.errors.length > 3 ? ` …（共 ${report.errors.length} 条）` : '' }}</p>
          <p v-if="report.warnings.length" class="mt-1 text-amber-700">警告：{{ report.warnings.slice(0, 3).join('；') }}{{ report.warnings.length > 3 ? ` …（共 ${report.warnings.length} 条）` : '' }}</p>
        </div>
      </div>

      <div class="flex justify-end gap-2 border-t px-4 py-3">
        <Button data-testid="module-batch-cancel" variant="ghost" size="sm" @click="onClose">取消</Button>
        <Button data-testid="module-batch-validate" variant="outline" size="sm" @click="onValidate">仅校验</Button>
        <Button data-testid="module-batch-create" size="sm" :disabled="!canCreate" @click="onCreate">
          {{ importing ? '创建中…' : `创建 ${validCount} 条` }}
        </Button>
      </div>
    </div>
  </div>
</template>
