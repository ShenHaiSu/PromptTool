<script setup lang="ts">
import {
  GENERATE_COUNT_OPTIONS,
  GENERATE_EXAMPLE_COUNT_OPTIONS,
  GENERATE_EXISTING_LIST_LIMIT,
  GENERATE_TENDENCY_MAX_LEN,
} from '@/lib/fragmentGeneratePrompt'

const TENDENCY_CHIPS = ['复古', '街头', '极简', '户外', '派对', '职场', '胶片感', '宽松廓形', '棉麻', '少荧光色']

defineProps<{
  tendency: string
  count: number
  exampleCount: number
  seed: number
  promptText: string
  promptBuilt: boolean
  tendencyEmpty: boolean
  promptTokens: number
  sampledCount: number
  existingCount: number
  excludeExisting: boolean
}>()

defineEmits<{
  (e: 'update:tendency', v: string): void
  (e: 'count-change', ev: Event): void
  (e: 'example-change', ev: Event): void
  (e: 'exclude-change', v: boolean): void
  (e: 'reshuffle'): void
  (e: 'chip', chip: string): void
  (e: 'build'): void
  (e: 'copy'): void
  (e: 'download'): void
  (e: 'next'): void
}>()
</script>

<template>
  <section data-testid="generate-step-1" class="space-y-3">
    <p class="text-sm font-medium">① 描述倾向并生成提示词</p>
    <p class="text-xs text-muted-foreground">提示词会自动附上：格式要求、随机示例（K 条）、已有清单（可选）。倾向文本原样直通，仅做去围栏与截断，不改写语义。</p>

    <div>
      <label class="mb-1 block text-xs font-medium">期望倾向 / 风格</label>
      <textarea
        data-testid="generate-tendency"
        :value="tendency"
        placeholder="例如：偏复古胶片感、80-90 年代港风，宽松廓形为主，多棉麻牛仔材质，少荧光色；避开已有基础款白衬衫……（≤500字，原样交给 LLM）"
        class="min-h-[96px] w-full rounded-md border bg-background p-2 text-xs"
        rows="4"
        @input="$emit('update:tendency', ($event.target as HTMLTextAreaElement).value)"
      />
      <div class="mt-1 flex flex-wrap items-center gap-1 text-xs">
        <span v-for="chip in TENDENCY_CHIPS" :key="chip" class="cursor-pointer rounded-full bg-muted px-2 py-0.5 hover:bg-accent" @click="$emit('chip', chip)">{{ chip }}</span>
        <span class="ml-auto text-muted-foreground">{{ [...tendency].length }} / {{ GENERATE_TENDENCY_MAX_LEN }}字</span>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-3 text-xs">
      <label class="flex items-center gap-1">
        <span class="text-muted-foreground">生成数量</span>
        <select data-testid="generate-count" :value="String(count)" class="rounded border bg-background px-2 py-1 text-xs" @change="$emit('count-change', $event)">
          <option v-for="o in GENERATE_COUNT_OPTIONS" :key="o" :value="String(o)">{{ o }} 条</option>
        </select>
      </label>
      <label class="flex items-center gap-1">
        <span class="text-muted-foreground">示例条数</span>
        <select data-testid="generate-example-count" :value="String(exampleCount)" class="rounded border bg-background px-2 py-1 text-xs" @change="$emit('example-change', $event)">
          <option v-for="o in GENERATE_EXAMPLE_COUNT_OPTIONS" :key="o" :value="String(o)">{{ o }} 条</option>
        </select>
      </label>
      <span class="flex items-center gap-1 text-muted-foreground">
        种子 {{ seed }}
        <el-button data-testid="generate-reshuffle" text size="small" @click="$emit('reshuffle')">换一批</el-button>
      </span>
      <label class="flex items-center gap-1" :title="existingCount === 0 ? '该维度暂无词条，无需附清单' : `附前 ${GENERATE_EXISTING_LIST_LIMIT} 条已有清单，要求 LLM 避重`">
        <input data-testid="generate-exclude" type="checkbox" :checked="excludeExisting" :disabled="existingCount === 0" @change="$emit('exclude-change', ($event.target as HTMLInputElement).checked)" />
        <span :class="existingCount === 0 ? 'text-muted-foreground' : ''">附已有清单避重</span>
      </label>
    </div>

    <div class="flex flex-wrap gap-2 text-xs">
      <el-button data-testid="generate-build-btn" type="primary" size="small" :disabled="tendencyEmpty" @click="$emit('build')">生成提示词</el-button>
      <template v-if="promptBuilt">
        <el-button data-testid="generate-copy" plain size="small" @click="$emit('copy')">复制全文</el-button>
        <el-button data-testid="generate-download" plain size="small" @click="$emit('download')">下载 .md</el-button>
        <el-button text size="small" @click="$emit('next')">下一步 →</el-button>
      </template>
    </div>
    <p v-if="tendencyEmpty" class="text-xs text-amber-700">请先填写倾向，或点 chips 追加</p>
    <el-card v-if="promptBuilt" shadow="never" data-testid="generate-prompt-preview" class="max-h-64 overflow-auto">
      <pre class="whitespace-pre-wrap break-words text-xs">{{ promptText }}</pre>
      <p class="mt-2 text-xs text-muted-foreground">预估 token：约 {{ promptTokens }}</p>
      <p v-if="existingCount === 0" class="text-xs text-muted-foreground">该维度暂无词条，将使用内置示例</p>
      <p v-else class="text-xs text-muted-foreground">示例 {{ sampledCount }} 条（种子 {{ seed }})</p>
    </el-card>
  </section>
</template>
