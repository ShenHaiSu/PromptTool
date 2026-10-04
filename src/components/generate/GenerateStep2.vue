<script setup lang="ts">
defineProps<{
  rawResultText: string
  detectedCount: number
  firstError: string | null
}>()

defineEmits<{
  (e: 'update:raw', v: string): void
  (e: 'pick-file'): void
  (e: 'file-selected', ev: Event): void
  (e: 'clear'): void
  (e: 'parse'): void
  (e: 'validate'): void
}>()
</script>

<template>
  <section data-testid="generate-step-2" class="space-y-3">
    <p class="text-sm font-medium">② 粘贴 LLM 结果（支持一次粘贴：含 fence、含多余解释、扁平数组、纯行文本（一行一条））</p>
    <textarea
      data-testid="generate-result-textarea"
      :value="rawResultText"
      placeholder="粘贴 LLM 返回的 JSON（含 ```json fence、含多余解释均可）或一行一条的纯英文文本"
      class="min-h-[160px] w-full rounded-md border bg-background p-2 font-mono text-xs"
      rows="8"
      @input="$emit('update:raw', ($event.target as HTMLTextAreaElement).value)"
    />
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <el-button plain size="small" @click="$emit('pick-file')">选择 .json/.txt</el-button>
      <el-button text size="small" @click="$emit('clear')">清空</el-button>
      <span class="rounded bg-muted px-2 py-1">已粘贴 {{ rawResultText.length }} 字符 · 探测到约 {{ detectedCount }} 个 contentEn 字段</span>
    </div>
    <div class="flex gap-2">
      <el-button data-testid="generate-parse-btn" type="primary" size="small" @click="$emit('parse')">解析并预览 →</el-button>
      <el-button data-testid="generate-validate-btn" plain size="small" @click="$emit('validate')">校验</el-button>
    </div>
    <p class="text-xs text-muted-foreground">支持一次粘贴：含 ```json fence、含多余解释、扁平数组、纯行文本（一行一条）</p>
    <p v-if="firstError" class="text-xs text-red-600">{{ firstError }}</p>
  </section>
</template>
