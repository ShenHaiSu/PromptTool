<script setup lang="ts">
 import { ref, computed } from 'vue'
 import { useOverlayClose } from '@/composables/useOverlayClose'
import SegmentStep1 from '@/components/segment/SegmentStep1.vue'
import SegmentStep2 from '@/components/segment/SegmentStep2.vue'
import SegmentStep3 from '@/components/segment/SegmentStep3.vue'
import { useSegmentImport } from '@/composables/useSegmentImport'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'imported'): void }>()

const s = useSegmentImport(props, (e, v) => emit(e, v), (e) => emit(e))
 
 const oc = useOverlayClose(() => { if (s.importing.value) return; s.onClose() }, { open: computed(() => props.open) })

const selectedKeysList = (): string[] => [...s.selectedKeys.value]

const rawFileInput = ref<HTMLInputElement | null>(null)
const llmFileInput = ref<HTMLInputElement | null>(null)
</script>

<template>
  <div
    data-testid="segment-import-dialog"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
     @mousedown="oc.onMouseDown" @click="oc.onClick"
  >
    <div
      data-testid="segment-import-overlay"
      class="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border bg-background shadow-xl"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b px-4 py-3">
        <h2 class="text-base font-semibold">分段导入</h2>
        <el-button data-testid="segment-import-close" text size="small" @click="s.onClose()">✕</el-button>
      </div>

      <!-- Step tabs -->
      <div class="flex shrink-0 items-center gap-1 border-b px-2 py-2 text-xs">
        <el-button
          data-testid="segment-step-1"
          :type="s.activeStep.value === 1 ? 'primary' : 'default'"
          size="small"
          @click="s.activeStep.value = 1"
        >① 输入原始串</el-button>
        <span class="text-muted-foreground">→</span>
        <el-button
          data-testid="segment-step-2"
          :type="s.activeStep.value === 2 ? 'primary' : 'default'"
          size="small"
          @click="s.activeStep.value = 2"
        >② 粘贴 LLM 输出</el-button>
        <span class="text-muted-foreground">→</span>
        <el-button
          data-testid="segment-step-3"
          :type="s.activeStep.value === 3 ? 'primary' : 'default'"
          size="small"
          @click="s.activeStep.value = 3"
        >③ 预览与导入</el-button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <SegmentStep1
          v-if="s.activeStep.value === 1"
          :raw-text="s.rawText.value"
          :raw-file-name="s.rawFileName.value"
          :raw-count="s.rawPrompts.value.length"
          :dimensions="s.dimensions.value"
          :dimensions-loading="s.dimensionsLoading.value"
          :dimensions-error="s.dimensionsError.value"
          :instruction-text="s.instructionText.value"
          :token-estimate="s.tokenEstimate.value"
          @update:raw="s.rawText.value = $event"
          @pick-file="rawFileInput?.click()"
          @clear="s.clearRaw()"
          @generate="s.onGenerateInstruction()"
          @copy="s.onCopyInstruction()"
          @download="s.onDownloadInstruction()"
        />
        <input
          ref="rawFileInput"
          data-testid="segment-raw-file-input"
          type="file"
          accept=".txt,.csv,.json,text/plain"
          class="hidden"
          @change="s.onRawFileSelected"
        />

        <SegmentStep2
          v-if="s.activeStep.value === 2"
          :llm-output="s.llmOutput.value"
          :llm-file-name="s.llmFileName.value"
          :parsed="s.parsed.value"
          @update:llm="s.llmOutput.value = $event"
          @pick-file="llmFileInput?.click()"
          @clear="s.clearLlm()"
          @to-json="s.onToJson()"
          @parse="s.onParse()"
        />
        <input
          ref="llmFileInput"
          data-testid="segment-llm-file-input"
          type="file"
          accept=".json,.txt"
          class="hidden"
          @change="s.onLlmFileSelected"
        />

        <SegmentStep3
          v-if="s.activeStep.value === 3"
          :filter="s.filter.value"
          :dimensions="s.dimensions.value"
          :stats="s.previewStats.value"
          :prompts="s.pagedPrompts.value"
          :filtered-count="s.filteredPrompts.value.length"
          :current-page="s.currentPage.value"
          :total-pages="s.totalPages.value"
          :page-size="s.pageSize"
          :selected-count="s.selectedCount.value"
          :selected-keys="selectedKeysList()"
          :importing="s.importing.value"
          :unassigned-strategy="s.unassignedStrategy.value"
          :import-mode="s.importMode.value"
          :report="s.report.value"
          @filter-change="s.filter.value = $event; s.currentPage.value = 1"
          @row-toggle="s.toggleSegment"
          @row-remap="s.remapDimension"
          @page-prev="s.currentPage.value--"
          @page-next="s.currentPage.value++"
          @update:unassignedStrategy="s.unassignedStrategy.value = $event"
          @update:importMode="s.importMode.value = $event"
          @validate="s.onValidateOnly()"
          @import="s.onImport()"
        />
      </div>

      <div class="flex justify-end gap-2 border-t px-4 py-3">
        <el-button text size="small" @click="s.onClose()">关闭</el-button>
      </div>
    </div>
  </div>
</template>