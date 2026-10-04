<script setup lang="ts">
import {
  TRANSLATION_CHUNK_SIZE_OPTIONS,
  estimateTranslationTokens,
} from '@/lib/translationPrompt'

export interface TranslateChunk {
  chunkId: string
  modules: unknown[]
}

defineProps<{
  chunks: TranslateChunk[]
  prompts: string[]
  totalChunks: number
  chunkSize: number
  modulesEmpty: boolean
  previewText: string
  previewTokens: number
}>()

defineEmits<{
  (e: 'chunk-change', ev: Event): void
  (e: 'copy-all'): void
  (e: 'download'): void
  (e: 'next'): void
  (e: 'copy-chunk', cId: string): void
  (e: 'preview-chunk', cId: string): void
}>()

function chunkTokens(prompts: string[], idx: number): number {
  return estimateTranslationTokens(prompts[idx] ?? '')
}
</script>

<template>
  <section data-testid="translate-step-1" class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm font-medium">① 生成聚合提示词</p>
      <div class="flex items-center gap-2 text-xs">
        <span class="text-muted-foreground">分片尺寸</span>
        <select data-testid="translate-chunk-size" :value="String(chunkSize)" class="rounded border bg-background px-2 py-1 text-xs" @change="$emit('chunk-change', $event)">
          <option v-for="o in TRANSLATION_CHUNK_SIZE_OPTIONS" :key="o" :value="String(o)">{{ o }} / 片</option>
        </select>
        <span class="text-muted-foreground">仅本维度</span>
      </div>
    </div>

    <div v-if="modulesEmpty" class="rounded-md border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
      该维度暂无词条，无需翻译
    </div>
    <template v-else>
      <div class="flex flex-wrap gap-2 text-xs">
        <el-button data-testid="translate-copy-all" plain size="small" @click="$emit('copy-all')">复制全部 {{ totalChunks }} 片</el-button>
        <el-button data-testid="translate-download" plain size="small" @click="$emit('download')">下载全部</el-button>
        <el-button text size="small" @click="$emit('next')">下一步 →</el-button>
      </div>

      <div class="space-y-1">
        <div
          v-for="(c, idx) in chunks"
          :key="c.chunkId"
          :data-testid="`translate-chunk-row-${c.chunkId}`"
          class="flex items-center justify-between rounded border px-3 py-2 text-xs"
        >
          <span>片 {{ c.chunkId }}/{{ totalChunks }} — {{ c.modules.length }} 条 — 预估 {{ chunkTokens(prompts, idx) }} tokens</span>
          <span class="flex gap-1">
            <el-button :data-testid="`translate-copy-chunk-${c.chunkId}`" text size="small" @click="$emit('copy-chunk', c.chunkId)">复制本片</el-button>
            <el-button text size="small" @click="$emit('preview-chunk', c.chunkId)">预览</el-button>
          </span>
        </div>
      </div>

      <el-card v-if="previewText" shadow="never" data-testid="translate-prompt-preview" class="max-h-64 overflow-auto">
        <pre class="whitespace-pre-wrap break-words text-xs">{{ previewText }}</pre>
        <p class="mt-2 text-xs text-muted-foreground">预估 token：约 {{ previewTokens }}</p>
      </el-card>
    </template>
  </section>
</template>
