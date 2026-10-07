<script setup lang="ts">
import GenerateStep1 from '@/components/generate/GenerateStep1.vue'
import GenerateStep2 from '@/components/generate/GenerateStep2.vue'
import GenerateStep3 from '@/components/generate/GenerateStep3.vue'
import { useGenerateDialog } from '@/composables/useGenerateDialog'
import type { Dimension, Module } from '@/engine/models'
import type { BatchCreateReport } from '@/lib/db'
 import { computed } from 'vue'
 import { useOverlayClose } from '@/composables/useOverlayClose'

const props = defineProps<{
  open: boolean
  dimension: Dimension | null
  modules: Module[]
}>()
const emitDlg = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'imported', report: BatchCreateReport): void
}>()

const {
  tendency, count, exampleCount, excludeExisting, activeStep, seed, promptText, promptBuilt,
  rawResultText, resultFileInput, parsed, applying, report,
  filter, search, curPage, pageSize, importMode, importWeight, importNsfw,
  existingCount, tendencyEmpty, sampledExamples, promptTokens, detectedCount, firstParseError,
  filteredRows, totalPages, pagedRows, selectedCount, canApply,
  onClose, onClearRaw, onClearAll, onBuildPrompt, onReshuffle, appendChip,
  onCopyPrompt, onDownload, onResultFileSelected, onParse, onValidate,
  setRowSelected, selectAllValid, deselectAll, selectCurrentPage, invertSelection,
  onApply, onCountChange, onExampleCountChange,
} = useGenerateDialog(props, emitDlg)
 
 const oc = useOverlayClose(() => { if (applying.value) return; onClose() }, { open: computed(() => props.open) })
</script>

<template>
  <div
    v-if="open"
    data-testid="generate-dialog"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
     @mousedown="oc.onMouseDown" @click="oc.onClick"
  >
    <div class="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-lg border bg-background shadow-xl">
      <!-- Header -->
      <div class="flex items-center justify-between border-b px-4 py-3">
        <h2 class="text-sm font-semibold">
          批量生成 — {{ dimension ? `${dimension.nameCn} / ${dimension.key}` : '—' }}
          <span class="ml-2 text-xs font-normal text-muted-foreground">{{ existingCount }} 条已有 · 本次 ≤50 条</span>
        </h2>
        <el-button data-testid="generate-close" text size="small" @click="onClose">✕</el-button>
      </div>

      <!-- Step tabs -->
      <div class="flex shrink-0 items-center gap-1 border-b px-2 py-2 text-xs">
        <button class="rounded px-3 py-1.5 font-medium" :class="activeStep === 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'" @click="activeStep = 1">① 描述倾向并生成提示词</button>
        <span class="text-muted-foreground">→</span>
        <button class="rounded px-3 py-1.5 font-medium" :class="activeStep === 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'" @click="activeStep = 2">② 粘贴 LLM 结果</button>
        <span class="text-muted-foreground">→</span>
        <button class="rounded px-3 py-1.5 font-medium" :class="activeStep === 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'" @click="activeStep = 3">③ 预览与入库</button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <GenerateStep1
          v-if="activeStep === 1"
          :tendency="tendency"
          :count="count"
          :example-count="exampleCount"
          :seed="seed"
          :prompt-text="promptText"
          :prompt-built="promptBuilt"
          :tendency-empty="tendencyEmpty"
          :prompt-tokens="promptTokens"
          :sampled-count="sampledExamples.length"
          :existing-count="existingCount"
          :exclude-existing="excludeExisting"
          @update:tendency="tendency = $event"
          @count-change="onCountChange"
          @example-change="onExampleCountChange"
          @exclude-change="excludeExisting = $event"
          @reshuffle="onReshuffle"
          @chip="appendChip"
          @build="onBuildPrompt"
          @copy="onCopyPrompt"
          @download="onDownload"
          @next="activeStep = 2"
        />

        <input ref="resultFileInput" data-testid="generate-result-file-input" type="file" accept=".json,.txt,text/plain" class="hidden" @change="onResultFileSelected" />
        <GenerateStep2
          v-if="activeStep === 2"
          :raw-result-text="rawResultText"
          :detected-count="detectedCount"
          :first-error="firstParseError"
          @update:raw="rawResultText = $event"
          @pick-file="resultFileInput?.click()"
          @file-selected="onResultFileSelected"
          @clear="onClearRaw"
          @parse="onParse"
          @validate="onValidate"
        />

        <GenerateStep3
          v-if="activeStep === 3"
          :parsed="parsed"
          :paged-rows="pagedRows"
          :filtered-count="filteredRows.length"
          :total-pages="totalPages"
          :cur-page="curPage"
          :page-size="pageSize"
          :filter="filter"
          :search="search"
          :selected-count="selectedCount"
          :can-apply="canApply"
          :applying="applying"
          :import-mode="importMode"
          :import-weight="importWeight"
          :import-nsfw="importNsfw"
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
          @update:importMode="importMode = $event"
          @update:importWeight="importWeight = $event"
          @update:importNsfw="importNsfw = $event"
          @apply="onApply"
          @back-step2="activeStep = 2"
          @back-step1="activeStep = 1"
          @clear-all="onClearAll"
          @close="onClose"
        />
      </div>

      <div class="flex justify-end gap-2 border-t px-4 py-3">
        <el-button text size="small" @click="onClose">关闭</el-button>
      </div>
    </div>
  </div>
</template>
