 <script setup lang="ts">
 import { onBeforeUnmount, onMounted } from 'vue'
 import { Button } from '@/components/ui/button'
 import { Card } from '@/components/ui/card'
 import { useImageTaskDialog } from '@/composables/useImageTaskDialog'
 import { dbRevealInExplorer } from '@/lib/db'
 import { useToast } from '@/composables/useToast'
 const dialog = useImageTaskDialog()
 const { push } = useToast()
 function onKeydown(e: KeyboardEvent): void {
   if (e.key === 'Escape' && dialog.opened.value) dialog.close()
 }
 async function onCopyFilename(): Promise<void> {
   const t = dialog.task.value?.filename ?? dialog.task.value?.expectedStem ?? ''
   if (!t) return
   try {
     await navigator.clipboard.writeText(t)
   } catch {
     const ta = document.createElement('textarea')
     ta.value = t
     ta.style.position = 'fixed'
     ta.style.opacity = '0'
     document.body.appendChild(ta)
     ta.select()
     document.execCommand('copy')
     document.body.removeChild(ta)
   }
   push('已复制文件名', 'success', 1200)
 }
 async function onRevealFile(): Promise<void> {
   const p = dialog.task.value?.filePath
   if (!p) return
   try {
     await dbRevealInExplorer(p)
   } catch (err) {
     push(`定位失败：${err instanceof Error ? err.message : String(err)}`, 'error')
   }
 }
 onMounted(() => {
   window.addEventListener('keydown', onKeydown)
 })
 onBeforeUnmount(() => {
   window.removeEventListener('keydown', onKeydown)
 })
 </script>

<!--
  生图任务详情顶层 Dialog（need06 复用 Dialog）。
  必须 Teleport 到 body：卡片身处虚拟化 `transform` 行容器内，
  就地 `fixed` 会被祖先 transform 劫持 containing block 而遭行高裁剪。
-->
<template>
  <Teleport to="body">
    <div
      v-if="dialog.opened.value"
      data-testid="image-task-detail-dialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      @click.self="dialog.close()"
    >
       <Card class="max-h-[80vh] w-full max-w-lg overflow-auto p-4">
         <h4 class="text-sm font-semibold">生图任务详情</h4>
         <!-- 2a 文件名三行：expectedStem / filename / filePath -->
         <dl v-if="dialog.task.value" data-testid="image-task-detail-files" class="mt-2 flex flex-col gap-1 font-mono text-[11px]">
           <div class="flex gap-2">
             <dt class="w-20 shrink-0 text-muted-foreground">expectedStem</dt>
             <dd class="min-w-0 flex-1 break-all">{{ dialog.task.value.expectedStem ?? '…' }}</dd>
           </div>
           <div class="flex gap-2">
             <dt class="w-20 shrink-0 text-muted-foreground">filename</dt>
             <dd class="min-w-0 flex-1 break-all">{{ dialog.task.value.filename ?? (dialog.task.value.expectedStem ? dialog.task.value.expectedStem + '.…' : '…') }}</dd>
             <button
               v-if="dialog.task.value.filename || dialog.task.value.expectedStem"
               data-testid="image-task-detail-copy-filename"
               class="shrink-0 text-primary"
               @click="onCopyFilename"
             >复制</button>
           </div>
           <div class="flex gap-2">
             <dt class="w-20 shrink-0 text-muted-foreground">filePath</dt>
             <dd class="min-w-0 flex-1 break-all">
               <button
                 v-if="dialog.task.value.filePath"
                 data-testid="image-task-detail-reveal"
                 class="text-left text-primary underline"
                 title="在文件管理器中定位"
                 @click="onRevealFile"
               >{{ dialog.task.value.filePath }}</button>
               <span v-else class="text-muted-foreground">暂无落盘文件</span>
             </dd>
           </div>
         </dl>
         <div v-if="dialog.loading.value" class="mt-2 text-xs text-muted-foreground">
           读取内嵌参数中…
         </div>
         <div v-else-if="!dialog.task.value?.filePath" class="mt-2 text-xs text-muted-foreground">
           该任务暂无落盘文件（排队/生成中预占文件名见上）。
         </div>
         <template v-else-if="dialog.embedded.value">
           <dl class="mt-2 flex flex-col gap-1 text-xs">
             <div class="flex gap-2">
               <dt class="w-16 shrink-0 text-muted-foreground">size</dt>
               <dd>{{ dialog.embedded.value.size }}</dd>
             </div>
             <div class="flex gap-2">
               <dt class="w-16 shrink-0 text-muted-foreground">ratio</dt>
               <dd>{{ dialog.embedded.value.ratio }}</dd>
             </div>
             <div class="flex gap-2">
               <dt class="w-16 shrink-0 text-muted-foreground">model</dt>
               <dd>{{ dialog.embedded.value.model }}</dd>
             </div>
             <div class="flex gap-2">
               <dt class="w-16 shrink-0 text-muted-foreground">createdAt</dt>
               <dd>{{ dialog.embedded.value.createdAt }}</dd>
             </div>
           </dl>
           <p class="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded border p-2 font-mono text-xs">
             {{ dialog.embedded.value.prompt }}
           </p>
           <div class="mt-3 flex justify-end gap-2">
             <Button
               data-testid="image-task-detail-copy"
               size="sm"
               variant="outline"
               class="h-7 text-xs"
               @click="dialog.copyPrompt()"
               >复制 prompt</Button
             >
             <Button
               data-testid="image-task-reuse"
               size="sm"
               class="h-7 text-xs"
               :disabled="dialog.reusing.value"
               @click="dialog.reuseParams()"
               >{{ dialog.reusing.value ? '入队中…' : '复用参数下单' }}</Button
             >
             <Button
               data-testid="image-task-detail-close"
               size="sm"
               variant="ghost"
               class="h-7 text-xs"
               @click="dialog.close()"
               >关闭</Button
             >
           </div>
         </template>
         <div v-else class="mt-3 flex justify-end">
           <Button
             data-testid="image-task-detail-close"
             size="sm"
             variant="ghost"
             class="h-7 text-xs"
             @click="dialog.close()"
             >关闭</Button
           >
         </div>
       </Card>
     </div>
   </Teleport>
 </template>
