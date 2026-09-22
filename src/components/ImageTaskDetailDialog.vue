<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useImageTaskDialog } from '@/composables/useImageTaskDialog'

const dialog = useImageTaskDialog()

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && dialog.opened.value) dialog.close()
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
        <div v-if="dialog.loading.value" class="mt-2 text-xs text-muted-foreground">
          读取内嵌参数中…
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
      </Card>
    </div>
  </Teleport>
</template>
