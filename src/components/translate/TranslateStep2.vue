<script setup lang="ts">
defineProps<{
  rawResultText: string
  detectedBlocks: number
  firstError: string | null
}>()

defineEmits<{
  (e: 'update:raw', v: string): void
  (e: 'pick-file'): void
  (e: 'clear'): void
  (e: 'parse'): void
}>()
</script>

<template>
  <section data-testid="translate-step-2" class="space-y-3">
    <p class="text-sm font-medium">② 粘贴 LLM 结果（支持一次贴多片、含 ```json fence、含多余解释）</p>
    <textarea
      data-testid="translate-result-textarea"
      :value="rawResultText"
      placeholder="粘贴 LLM 返回的 JSON（支持一次贴多片、含 ```json fence、含多余解释）"
      class="min-h-[160px] w-full rounded-md border bg-background p-2 font-mono text-xs"
      rows="8"
      @input="$emit('update:raw', ($event.target as HTMLTextAreaElement).value)"
    />
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <el-button plain size="small" @click="$emit('pick-file')">选择 .json/.txt</el-button>
      <el-button text size="small" @click="$emit('clear')">清空</el-button>
      <span class="rounded bg-muted px-2 py-1">已粘贴 {{ rawResultText.length }} 字符 · 探测到约 {{ detectedBlocks }} 个 zh 字段</span>
    </div>
    <div class="flex gap-2">
      <el-button data-testid="translate-parse-btn" type="primary" size="small" @click="$emit('parse')">解析并预览 →</el-button>
      <el-button data-testid="translate-validate-btn" plain size="small" @click="$emit('parse')">校验</el-button>
    </div>
    <p v-if="firstError" class="text-xs text-red-600">{{ firstError }}</p>
  </section>
</template>
