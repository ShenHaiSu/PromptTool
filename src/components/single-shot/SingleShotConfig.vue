<script setup lang="ts">
import { IQ_SIZES, IQ_RATIOS } from '@/lib/imageQueue'

defineProps<{
  prompt: string
  size: string
  ratio: string
  outputDir: string
  outputPlaceholder: string
  generating: boolean
  saving: boolean
  canGenerate: boolean
  canSave: boolean
  promptOverlong: boolean
  promptLength: number
}>()

const emit = defineEmits<{
  (e: 'update:prompt', v: string): void
  (e: 'update:size', v: string): void
  (e: 'update:ratio', v: string): void
  (e: 'update:outputDir', v: string): void
  (e: 'browse'): void
  (e: 'generate'): void
  (e: 'save'): void
  (e: 'reset'): void
  (e: 'copy-prompt'): void
}>()
</script>

<template>
  <div data-testid="single-shot-config" class="flex shrink-0 flex-col gap-2 overflow-auto border-b bg-card p-3">
    <div class="flex items-center gap-2">
      <h3 class="text-xs font-semibold">手动单发</h3>
      <span class="text-[11px] text-muted-foreground">生成只预览不落盘，点保存才落盘计入统计</span>
    </div>

    <label class="flex min-h-0 flex-1 flex-col gap-1 text-xs">
      <span class="text-muted-foreground">prompt（必填，≤4000字）</span>
      <textarea
        :value="prompt"
        data-testid="single-shot-prompt"
        placeholder="描述想要的画面…"
        class="min-h-16 w-full flex-1 resize-none rounded border bg-background p-2 font-mono text-xs outline-none focus:border-primary"
        @input="emit('update:prompt', ($event.target as HTMLTextAreaElement).value)"
      />
      <span class="self-end text-[11px]" :class="promptOverlong ? 'text-warning' : 'text-muted-foreground'">
        {{ promptLength }}/4000
      </span>
    </label>

    <div class="flex flex-wrap items-center gap-2 text-xs">
      <label class="flex items-center gap-1 text-xs">
        <span class="text-muted-foreground">尺寸</span>
        <select
          :value="size"
          data-testid="single-shot-size"
          class="h-7 rounded border bg-background px-2 text-xs"
          @change="emit('update:size', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="s in IQ_SIZES" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
      <label class="flex items-center gap-1 text-xs">
        <span class="text-muted-foreground">比例</span>
        <select
          :value="ratio"
          data-testid="single-shot-ratio"
          class="h-7 rounded border bg-background px-2 text-xs"
          @change="emit('update:ratio', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="r in IQ_RATIOS" :key="r" :value="r">{{ r }}</option>
        </select>
      </label>
      <label class="flex min-w-0 flex-1 items-center gap-1 text-xs">
        <span class="shrink-0 text-muted-foreground">保存路径</span>
        <input
          :value="outputDir"
          data-testid="single-shot-output"
          :placeholder="outputPlaceholder || '留空=队列默认 outputDir'"
          class="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs outline-none focus:border-primary"
          @input="emit('update:outputDir', ($event.target as HTMLInputElement).value)"
        />
        <el-button data-testid="single-shot-output-browse" plain size="small" @click="emit('browse')">浏览…</el-button>
      </label>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <el-button
        data-testid="single-shot-generate"
        type="primary"
        size="small"
        :disabled="!canGenerate"
        @click="emit('generate')"
      >
        {{ generating ? '生成中…' : '生成' }}
      </el-button>
      <el-button data-testid="single-shot-save" plain size="small" :disabled="!canSave" @click="emit('save')">
        {{ saving ? '保存中…' : '保存' }}
      </el-button>
      <el-button data-testid="single-shot-reset" text size="small" @click="emit('reset')">重来</el-button>
      <el-button data-testid="single-shot-prompt-copy" text size="small" @click="emit('copy-prompt')">复制 prompt</el-button>
      <span class="ml-auto text-[11px] text-muted-foreground">单发不占用队列并发、不触发备料/熔断；队列运行时可并行单发。</span>
    </div>
  </div>
</template>