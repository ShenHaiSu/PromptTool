<script setup lang="ts">
import type { ParsedBatch } from '@/lib/segmentParse'

defineProps<{
  llmOutput: string
  llmFileName: string
  parsed: ParsedBatch | null
}>()

const emit = defineEmits<{
  (e: 'update:llm', v: string): void
  (e: 'pick-file'): void
  (e: 'clear'): void
  (e: 'to-json'): void
  (e: 'parse'): void
}>()
</script>

<template>
  <section data-testid="segment-step2" class="space-y-3">
    <p class="text-sm font-medium">② 粘贴 LLM 输出（pmf-segments JSON 或 Tagged）</p>
    <textarea
      data-testid="segment-llm-textarea"
      :value="llmOutput"
      placeholder="粘贴 LLM 返回的 JSON，或 [body] ... 形式的 Tagged 文本"
      class="min-h-[160px] w-full rounded-md border bg-background p-2 font-mono text-xs"
      rows="8"
      @input="emit('update:llm', ($event.target as HTMLTextAreaElement).value)"
    />
    <div class="flex flex-wrap items-center gap-2">
      <el-button plain size="small" @click="emit('pick-file')">选择 .json/.txt</el-button>
      <el-button data-testid="segment-to-json-btn" plain size="small" @click="emit('to-json')">转为 JSON</el-button>
      <el-button text size="small" @click="emit('clear')">清空</el-button>
      <span v-if="llmFileName" class="text-xs text-muted-foreground">{{ llmFileName }}</span>
    </div>
    <div v-if="parsed" data-testid="segment-detect-badge" class="flex flex-wrap gap-2 text-xs">
      <el-tag size="small" effect="plain" type="info">探测：{{ parsed.kind === 'tagged' ? 'Tagged ✓' : 'JSON ✓' }}</el-tag>
      <el-tag size="small" effect="plain">{{ parsed.stats.prompts }} prompts · {{ parsed.stats.segments }} segments</el-tag>
      <el-tag v-if="parsed.errors.length" size="small" type="danger" effect="plain">错误：{{ parsed.errors.length }}</el-tag>
      <el-tag v-if="parsed.warnings.length" size="small" type="warning" effect="plain">警告：{{ parsed.warnings.length }}</el-tag>
    </div>
    <p v-if="parsed && parsed.errors.length" class="text-xs text-red-500">{{ parsed.errors[0] }}</p>
    <el-button data-testid="segment-parse-btn" type="primary" size="small" @click="emit('parse')">解析并预览 →</el-button>
  </section>
</template>