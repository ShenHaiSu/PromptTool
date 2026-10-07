<script setup lang="ts">
import { computed } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { useAssemblyStore } from '@/stores/assembly'

defineProps<{
  keyword: string
  dimPanelMode: 'browse' | 'selected'
  filteredCount: number
  selectedCount: number
  nsfwOn: boolean
  nsfwCount: number
}>()

const emit = defineEmits<{
  (e: 'update:keyword', v: string): void
  (e: 'update:mode', v: 'browse' | 'selected'): void
   (e: 'create-dimension'): void
   (e: 'open-order'): void
  (e: 'toggle-nsfw'): void
  (e: 'open-preview'): void
}>()

const library = useLibraryStore()
const assembly = useAssemblyStore()
void library
void assembly

const totalDims = computed(() => library.dimensions.length)
</script>

<template>
  <div class="flex h-9 shrink-0 items-center justify-between border-b px-3">
    <h2 class="text-sm font-semibold">维度面板</h2>
    <el-button data-testid="preview-trigger" plain size="small" title="审阅 IR、分段与冲突，复制/导出当前 Prompt" @click="emit('open-preview')">
      👁 预览 · {{ selectedCount }}
    </el-button>
  </div>

  <div class="flex shrink-0 flex-col gap-2 border-b px-3 py-2">
    <el-input
      :model-value="keyword"
      data-testid="dimension-search"
      placeholder="搜索 维度/条目…"
      size="small"
      clearable
      @input="emit('update:keyword', $event)"
      @clear="emit('update:keyword', '')"
    />
    <div class="flex items-center justify-between">
      <span class="text-xs text-muted-foreground">
        <template v-if="dimPanelMode === 'browse'">维度 {{ filteredCount }} / {{ totalDims }}</template>
        <template v-else>已选 {{ selectedCount }}</template>
      </span>
      <div class="flex items-center gap-1">
        <el-button
          data-testid="create-dimension-btn"
          plain
          size="small"
          @click="emit('create-dimension')"
        >
          + 新建维度
        </el-button>
         <el-button
           data-testid="dimension-order-btn"
           plain
           size="small"
           title="拖拽调整维度顺序（替代手输序号）"
           @click="emit('open-order')"
         >
           ⇅ 维度排序
         </el-button>
        <el-button
          data-testid="nsfw-pill"
          size="small"
          :type="nsfwOn ? 'danger' : undefined"
          :plain="!nsfwOn"
          :title="nsfwOn ? '已显示 NSFW 条目' : '已隐藏 NSFW 条目'"
          @click="emit('toggle-nsfw')"
        >
          NSFW {{ nsfwOn ? '开' : '关' }} · {{ nsfwCount }}
        </el-button>
      </div>
    </div>
  </div>

  <div class="flex shrink-0 gap-1 border-b px-2 py-1.5">
    <el-button data-testid="dim-mode-browse" size="small" :type="dimPanelMode === 'browse' ? 'primary' : undefined" :text="dimPanelMode !== 'browse'" class="flex-1" @click="emit('update:mode', 'browse')">浏览</el-button>
    <el-button data-testid="dim-mode-selected" size="small" :type="dimPanelMode === 'selected' ? 'primary' : undefined" :text="dimPanelMode !== 'selected'" class="flex-1" @click="emit('update:mode', 'selected')">已选 · {{ selectedCount }}</el-button>
  </div>
</template>
