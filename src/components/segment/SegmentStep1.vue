<script setup lang="ts">
import type { Dimension } from '@/engine/models'

defineProps<{
  rawText: string
  rawFileName: string
  rawCount: number
  dimensions: Dimension[]
  dimensionsLoading: boolean
  dimensionsError: string
  instructionText: string
  tokenEstimate: number
}>()

const emit = defineEmits<{
  (e: 'update:raw', v: string): void
  (e: 'pick-file'): void
  (e: 'clear'): void
  (e: 'generate'): void
  (e: 'copy'): void
  (e: 'download'): void
}>()
</script>

<template>
  <section data-testid="segment-step1" class="space-y-3">
    <div class="flex items-center justify-between">
      <p class="text-sm font-medium">① 输入原始提示词</p>
      <span class="text-xs text-muted-foreground" title="说明">每行一条完整 Prompt，也可粘贴多行</span>
    </div>
    <textarea
      data-testid="segment-raw-textarea"
      :value="rawText"
      placeholder="每行一条完整 Prompt，也可粘贴多行&#10;例：slim waist, long legs, oval face with natural..."
      class="min-h-[120px] w-full rounded-md border bg-background p-2 text-sm"
      rows="5"
      @input="emit('update:raw', ($event.target as HTMLTextAreaElement).value)"
    />
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <el-button plain size="small" @click="emit('pick-file')">选择 .txt/.csv</el-button>
      <el-button text size="small" @click="emit('clear')">清空</el-button>
      <el-tag size="small" type="info" effect="plain" data-testid="segment-raw-count">已读 {{ rawCount }} 条</el-tag>
      <span v-if="rawFileName" class="truncate text-muted-foreground">{{ rawFileName }}</span>
    </div>
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="text-muted-foreground">
        维度 {{ dimensions.length || '—' }} · 已启用 {{ dimensions.filter((d) => d.isEnabled).length }}
      </span>
      <span v-if="dimensionsError" class="text-red-500">无法读取维度：{{ dimensionsError }}</span>
      <span v-if="dimensionsLoading" class="text-muted-foreground">加载中…</span>
    </div>
    <div class="flex flex-wrap gap-2">
      <el-button data-testid="segment-generate-btn" type="primary" size="small" @click="emit('generate')">生成解析指令</el-button>
      <el-button data-testid="segment-copy-instruction-btn" plain size="small" @click="emit('copy')">复制指令</el-button>
      <el-button data-testid="segment-download-instruction-btn" plain size="small" @click="emit('download')">下载指令 .md</el-button>
    </div>
    <el-card v-if="instructionText" data-testid="segment-instruction-preview" shadow="never" class="max-h-64 overflow-auto">
      <pre class="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs">{{ instructionText }}</pre>
      <p class="mt-2 text-xs text-muted-foreground">预估 token：约 {{ tokenEstimate }}</p>
    </el-card>
    <p class="text-xs text-muted-foreground">提示：复制指令后粘贴到任意 LLM，令其“只输出 JSON”</p>
  </section>
</template>