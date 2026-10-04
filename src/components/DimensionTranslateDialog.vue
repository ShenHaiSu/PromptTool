<script setup lang="ts">
import TranslateStep1 from '@/components/translate/TranslateStep1.vue'
import TranslateStep2 from '@/components/translate/TranslateStep2.vue'
import TranslateStep3 from '@/components/translate/TranslateStep3.vue'
import { useTranslateDialog } from '@/composables/useTranslateDialog'
import type { Dimension, Module } from '@/engine/models'
import type { TranslationUpdateReport } from '@/lib/db'

const props = defineProps<{
  open: boolean
  dimension: Dimension | null
  modules: Module[]
}>()
const emitDlg = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'applied', report: TranslationUpdateReport): void
}>()

const {
  chunkSize, activeStep, rawResultText, resultFileInput, parsed, applying, report,
  filter, search, curPage, pageSize, editingId, editingValue,
  prompts, chunks, totalChunks, previewText, previewTokens, detectedBlocks, firstParseError,
  filteredRows, totalPages, pagedRows, selectedCount, canApply,
  onClose, onClearRaw, onClearAll, onCopyChunk, onCopyAll, onDownload,
  onResultFileSelected, onParse, setRowSelected, selectAllValid, deselectAll, selectCurrentPage, invertSelection,
  startEditById, confirmEditById, cancelEdit, onApply, onChunkSizeChange, onPreviewChunk,
} = useTranslateDialog(props, emitDlg)
</script>

<template>
  <div
    v-if="open"
    data-testid="translate-dialog"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    @click.self="onClose"
  >
    <div
      data-testid="translate-dialog-overlay"
      class="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-lg border bg-background shadow-xl"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b px-4 py-3">
        <h2 class="text-sm font-semibold">
          批量翻译 — {{ dimension ? `${dimension.nameCn} / ${dimension.key}` : '—' }}
          <span class="ml-2 text-xs font-normal text-muted-foreground">{{ modules.length }} 条 · 分 {{ totalChunks }} 片（{{ chunkSize }}/片）</span>
        </h2>
        <el-button data-testid="translate-close" text size="small" @click="onClose">✕</el-button>
      </div>

      <!-- Step tabs -->
      <div class="flex shrink-0 items-center gap-1 border-b px-2 py-2 text-xs">
        <button class="rounded px-3 py-1.5 font-medium" :class="activeStep === 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'" @click="activeStep = 1">① 生成聚合提示词</button>
        <span class="text-muted-foreground">→</span>
        <button class="rounded px-3 py-1.5 font-medium" :class="activeStep === 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'" @click="activeStep = 2">② 粘贴 LLM 结果</button>
        <span class="text-muted-foreground">→</span>
        <button class="rounded px-3 py-1.5 font-medium" :class="activeStep === 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'" @click="activeStep = 3">③ 预览与回填</button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <TranslateStep1
          v-if="activeStep === 1"
          :chunks="chunks"
          :prompts="prompts"
          :total-chunks="totalChunks"
          :chunk-size="chunkSize"
          :modules-empty="modules.length === 0"
          :preview-text="previewText"
          :preview-tokens="previewTokens"
          @chunk-change="onChunkSizeChange"
          @copy-all="onCopyAll"
          @download="onDownload"
          @next="activeStep = 2"
          @copy-chunk="onCopyChunk"
          @preview-chunk="onPreviewChunk"
        />

        <input ref="resultFileInput" data-testid="translate-result-file-input" type="file" accept=".json,.txt,text/plain" class="hidden" @change="onResultFileSelected" />
        <TranslateStep2
          v-if="activeStep === 2"
          :raw-result-text="rawResultText"
          :detected-blocks="detectedBlocks"
          :first-error="firstParseError"
          @update:raw="rawResultText = $event"
          @pick-file="resultFileInput?.click()"
          @clear="onClearRaw"
          @parse="onParse"
        />

        <TranslateStep3
          v-if="activeStep === 3"
          :parsed="parsed"
          :paged-rows="pagedRows"
          :filtered-count="filteredRows.length"
          :total-pages="totalPages"
          :cur-page="curPage"
          :page-size="pageSize"
          :filter="filter"
          :search="search"
          :editing-id="editingId"
          :editing-value="editingValue"
          :selected-count="selectedCount"
          :can-apply="canApply"
          :applying="applying"
          :report="report"
          @filter-change="filter = $event"
          @update:search="search = $event"
          @row-toggle="setRowSelected"
          @page-prev="curPage--"
          @page-next="curPage++"
          @select-all="selectAllValid"
          @deselect-all="deselectAll"
          @select-page="selectCurrentPage"
          @invert="invertSelection"
          @edit-start="startEditById"
          @edit-confirm="confirmEditById"
          @edit-cancel="cancelEdit"
          @update:editingValue="editingValue = $event"
          @apply="onApply"
          @back-step2="activeStep = 2"
          @clear-all="onClearAll"
        />
      </div>

      <div class="flex justify-end gap-2 border-t px-4 py-3">
        <el-button text size="small" @click="onClose">关闭</el-button>
      </div>
    </div>
  </div>
</template>
