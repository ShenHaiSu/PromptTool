<script setup lang="ts">
import { ref, computed } from 'vue'
import { notify } from '@/lib/notify'
import { useImageTaskDialog } from '@/composables/useImageTaskDialog'
import type { ImageTaskView } from '@/lib/imageQueueApi'
import { useImageQueueStore } from '@/stores/imageQueue'
import { logger } from '@/lib/logger'

const props = defineProps<{ model: ImageTaskView }>()

const iq = useImageQueueStore()
const detailDialog = useImageTaskDialog()

const expanded = ref(false)

function openDetail(): void {
  void detailDialog.open(props.model)
}

const statusMeta = computed(() => {
  switch (props.model.status) {
    case 'queued':
      return { label: '排队', type: 'info' as const }
    case 'running':
      return { label: '生成中', type: 'primary' as const }
    case 'succeeded':
      return { label: '成功', type: 'success' as const }
    case 'failed':
      return { label: '失败', type: 'danger' as const }
    case 'cancelled':
      return { label: '已取消', type: 'warning' as const }
  }
})

async function onCopy(): Promise<void> {
  const text = props.model.prompt
  try {
    await navigator.clipboard.writeText(text)
  } catch (err) {
    logger.warn('ImageTaskCard', 'copy降级', err)
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  notify('已复制 prompt', 'success', 1200)
}
const filenameText = computed(() => {
  if (props.model.filename) return props.model.filename
  if (props.model.expectedStem) return `${props.model.expectedStem}.…`
  return '…'
})
async function onCopyFilename(): Promise<void> {
  const text = props.model.filename ?? props.model.expectedStem ?? ''
  if (!text) {
    notify('暂无文件名', 'warning', 1200)
    return
  }
  try {
    await navigator.clipboard.writeText(text)
  } catch (err) {
    logger.warn('ImageTaskCard', 'copyFilename降级', err)
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  notify('已复制文件名', 'success', 1200)
}
async function onRetry(): Promise<void> {
  await iq.retry(props.model.id)
}
async function onRemove(): Promise<void> {
  await iq.remove(props.model.id)
}
const elapsedText = computed(() =>
  props.model.elapsedMs != null ? `${(props.model.elapsedMs / 1000).toFixed(1)}s` : '',
)
</script>

<template>
  <el-card
    :data-testid="`image-task-${model.id}`"
    class="cursor-pointer"
    @click="openDetail"
  >
    <div class="flex items-center gap-2">
      <el-tag size="small" :type="statusMeta.type">{{ statusMeta.label }}</el-tag>
      <span class="text-[11px] text-muted-foreground">{{ model.size }}·{{ model.ratio }}</span>
      <span v-if="elapsedText" class="text-[11px] text-muted-foreground">{{ elapsedText }}</span>
      <div class="ml-auto flex items-center gap-1">
        <el-button
          :data-testid="`image-task-copy-${model.id}`"
          text
          size="small"
          title="复制 prompt"
          @click.stop="onCopy"
          >复制</el-button
        >
        <el-button
          v-if="model.status === 'failed' || model.status === 'cancelled'"
          :data-testid="`image-task-retry-${model.id}`"
          plain
          size="small"
          title="重试"
          @click.stop="onRetry"
          >重试</el-button
        >
        <el-button
          v-if="model.status === 'succeeded' && model.filePath"
          :data-testid="`image-task-meta-${model.id}`"
          plain
          size="small"
          title="查看生图参数"
          @click.stop="openDetail"
          >参数</el-button
        >
        <el-button
          :data-testid="`image-task-remove-${model.id}`"
          text
          size="small"
          :title="model.status === 'running' ? '运行中不可删，请先停止' : '删除'"
          :disabled="model.status === 'running'"
          @click.stop="onRemove"
          >删除</el-button
        >
      </div>
    </div>
    <p
      class="mt-2 min-w-0 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed"
      :class="expanded ? '' : 'line-clamp-3'"
      :title="model.prompt"
    >
      {{ model.prompt }}
      <button
        v-if="model.prompt.length > 60"
        class="ml-1 text-[11px] text-primary"
        @click.stop="expanded = !expanded"
      >
        {{ expanded ? '收起' : '展开' }}
      </button>
    </p>
    <div v-if="model.status === 'failed' && model.error" class="mt-1 text-[11px] text-red-600 dark:text-red-400">
      {{ model.error }}
    </div>
    <div
      :data-testid="`image-task-filename-${model.id}`"
      class="mt-1 flex min-w-0 items-center gap-1 font-mono text-[11px] text-muted-foreground"
      :title="filenameText"
    >
      <span class="min-w-0 flex-1 truncate">{{ filenameText }}</span>
      <button
        :data-testid="`image-task-filename-copy-${model.id}`"
        class="shrink-0 text-[11px] text-primary"
        title="复制文件名"
        @click.stop="onCopyFilename"
      >复制</button>
    </div>
  </el-card>
</template>
