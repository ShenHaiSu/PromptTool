<script setup lang="ts">
import { ref, computed } from 'vue'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/composables/useToast'
import { useImageTaskDialog } from '@/composables/useImageTaskDialog'
import type { ImageTaskView } from '@/lib/imageQueueApi'
import { useImageQueueStore } from '@/stores/imageQueue'

const props = defineProps<{ model: ImageTaskView }>()

const { push } = useToast()
const iq = useImageQueueStore()
const detailDialog = useImageTaskDialog()

const expanded = ref(false)

/** 整卡点击拉起顶层详情 Dialog（need06 复用 Dialog，方案 B）。 */
function openDetail(): void {
  void detailDialog.open(props.model)
}

const statusMeta = computed(() => {
  switch (props.model.status) {
    case 'queued':
      return { label: '排队', cls: 'bg-gray-500/15 text-gray-600 dark:text-gray-400' }
    case 'running':
      return { label: '生成中', cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 animate-pulse' }
    case 'succeeded':
      return { label: '成功', cls: 'bg-green-500/15 text-green-600 dark:text-green-400' }
    case 'failed':
      return { label: '失败', cls: 'bg-red-500/15 text-red-600 dark:text-red-400' }
    case 'cancelled':
      return { label: '已取消', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' }
  }
})

 async function onCopy(): Promise<void> {
   const text = props.model.prompt
   try {
     await navigator.clipboard.writeText(text)
   } catch {
     const ta = document.createElement('textarea')
     ta.value = text
     ta.style.position = 'fixed'
     ta.style.opacity = '0'
     document.body.appendChild(ta)
     ta.select()
     document.execCommand('copy')
     document.body.removeChild(ta)
   }
   push('已复制 prompt', 'success', 1200)
 }
 /** 2a 文件名展示：`filename ?? expectedStem + '.…' ?? '…'`（老任务占位）。 */
 const filenameText = computed(() => {
   if (props.model.filename) return props.model.filename
   if (props.model.expectedStem) return `${props.model.expectedStem}.…`
   return '…'
 })
 async function onCopyFilename(): Promise<void> {
   const text = props.model.filename ?? props.model.expectedStem ?? ''
   if (!text) {
     push('暂无文件名', 'warning', 1200)
     return
   }
   try {
     await navigator.clipboard.writeText(text)
   } catch {
     const ta = document.createElement('textarea')
     ta.value = text
     ta.style.position = 'fixed'
     ta.style.opacity = '0'
     document.body.appendChild(ta)
     ta.select()
     document.execCommand('copy')
     document.body.removeChild(ta)
   }
   push('已复制文件名', 'success', 1200)
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
  <Card
    :data-testid="`image-task-${model.id}`"
    class="cursor-pointer p-3"
    @click="openDetail"
  >
    <div class="flex items-center gap-2">
      <Badge class="h-5 px-1.5 text-[10px]" :class="statusMeta.cls">{{ statusMeta.label }}</Badge>
      <span class="text-[11px] text-muted-foreground">{{ model.size }}·{{ model.ratio }}</span>
      <span v-if="elapsedText" class="text-[11px] text-muted-foreground">{{ elapsedText }}</span>
      <div class="ml-auto flex items-center gap-1">
        <Button
          :data-testid="`image-task-copy-${model.id}`"
          size="sm"
          variant="ghost"
          class="h-6 px-2 text-xs"
          title="复制 prompt"
          @click.stop="onCopy"
          >复制</Button
        >
        <Button
          v-if="model.status === 'failed' || model.status === 'cancelled'"
          :data-testid="`image-task-retry-${model.id}`"
          size="sm"
          variant="outline"
          class="h-6 px-2 text-xs"
          title="重试"
          @click.stop="onRetry"
          >重试</Button
        >
        <Button
          v-if="model.status === 'succeeded' && model.filePath"
          :data-testid="`image-task-meta-${model.id}`"
          size="sm"
          variant="outline"
          class="h-6 px-2 text-xs"
          title="查看生图参数"
          @click.stop="openDetail"
          >参数</Button
        >
        <Button
          :data-testid="`image-task-remove-${model.id}`"
          size="sm"
          variant="ghost"
          class="h-6 px-2 text-xs"
          :title="model.status === 'running' ? '运行中不可删，请先停止' : '删除'"
          :disabled="model.status === 'running'"
          @click.stop="onRemove"
          >删除</Button
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
   </Card>
 </template>
