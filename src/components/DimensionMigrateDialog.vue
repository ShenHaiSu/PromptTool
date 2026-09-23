<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import type { Dimension } from '@/engine/models'

// Need08 — 维度迁移确认对话框（单步确认，无步骤条）
// 文案逐字遵循 docs/need08/05_维度迁移设计.md §4
const props = defineProps<{
  open: boolean
  dimension: Dimension | null
  count: number
  selectedCount: number
  busy: boolean
}>()
const emitDlg = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'confirm'): void
}>()

const agreed = ref(false)
watch(() => props.open, (v) => { if (v) agreed.value = false })

function onClose(): void {
  if (props.busy) return
  emitDlg('update:open', false)
}
function onConfirm(): void {
  if (!agreed.value || props.busy) return
  emitDlg('confirm')
}
</script>

<template>
  <div
    v-if="open"
    data-testid="migrate-dialog"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    @click.self="onClose"
  >
    <div class="flex max-h-[86vh] w-full max-w-lg flex-col rounded-lg border bg-background shadow-xl">
      <div class="flex items-center justify-between border-b px-4 py-3">
        <h2 class="text-sm font-semibold">迁移维度「{{ dimension ? `${dimension.nameCn} / ${dimension.key}` : '—' }}」？</h2>
        <Button size="sm" variant="ghost" class="h-7 px-2 text-xs" data-testid="migrate-cancel-top" :disabled="busy" @click="onClose">✕</Button>
      </div>
      <div class="space-y-2 overflow-y-auto px-4 py-3 text-sm">
        <p>该维度现有 {{ count }} 条片段，将整体归档并重建空白维度：</p>
        <p>① 归档：{{ dimension?.key }} → {{ dimension?.key }}_bak_××××××（随机6位，执行时生成）<br />归档维度保留全部 {{ count }} 条片段，沉底排序，可随时查看/恢复使用。</p>
        <p>② 新生：原位重建同名空白维度「{{ dimension?.nameCn }} / {{ dimension?.key }}」（0 条，可立即批量生成/导入）。</p>
        <p v-if="selectedCount > 0">其中 {{ selectedCount }} 条正在“已选”中，迁移后将移出已选（归档内容如需继续使用请重新添加）。</p>
        <p class="text-xs text-muted-foreground">Tips：维度规则按维度 id 引用，归档后规则将跟随归档维度，新生维度需手动重配规则。</p>
        <label class="flex cursor-pointer items-start gap-2 rounded border p-2 text-xs">
          <input
            v-model="agreed"
            data-testid="migrate-confirm-check"
            type="checkbox"
            class="mt-0.5 h-4 w-4 accent-primary"
            :disabled="busy"
          />
          <span>我已理解：原维度 id 将变更，历史方案/模板按模块 id 引用不受影响</span>
        </label>
      </div>
      <div class="flex justify-end gap-2 border-t px-4 py-3">
        <Button size="sm" variant="outline" class="h-8 text-xs" data-testid="migrate-cancel" :disabled="busy" @click="onClose">取消</Button>
        <Button
          size="sm"
          variant="destructive"
          class="h-8 text-xs"
          data-testid="migrate-confirm-btn"
          :disabled="!agreed || busy"
          @click="onConfirm"
        >{{ busy ? '迁移中…' : `确认迁移（${count} 条）` }}</Button>
      </div>
    </div>
  </div>
</template>
