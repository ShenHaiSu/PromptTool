<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import type { Dimension } from '@/engine/models'

const props = withDefaults(defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  initialDimension?: Dimension | null
}>(), {
  initialDimension: null,
})

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'confirm', payload: { key: string; nameCn: string; nameEn: string; sortOrder: number; isMultiSelect: boolean }): void
  (e: 'cancel'): void
}>()

const key = ref('')
const nameCn = ref('')
const nameEn = ref('')
const sortOrder = ref(0)
const isMultiSelect = ref(false)

const title = computed(() => props.mode === 'create' ? '新建维度' : '编辑维度')
const isEdit = computed(() => props.mode === 'edit')

watch(() => props.open, (v) => {
  if (!v) return
  if (props.mode === 'edit' && props.initialDimension) {
    const d = props.initialDimension
    key.value = d.key
    nameCn.value = d.nameCn
    nameEn.value = d.nameEn ?? ''
    sortOrder.value = d.sortOrder
    isMultiSelect.value = d.isMultiSelect
  } else {
    key.value = ''
    nameCn.value = ''
    nameEn.value = ''
    sortOrder.value = 0
    isMultiSelect.value = false
  }
})

function onClose(): void {
  emit('update:open', false)
  emit('cancel')
}

function onConfirm(): void {
  if (!key.value.trim() || !nameCn.value.trim()) return
  emit('confirm', {
    key: key.value.trim(),
    nameCn: nameCn.value.trim(),
    nameEn: nameEn.value.trim(),
    sortOrder: sortOrder.value,
    isMultiSelect: isMultiSelect.value,
  })
  emit('update:open', false)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') onClose()
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onConfirm()
}
</script>

<template>
  <div
    v-if="open"
    data-testid="dimension-edit-dialog-overlay"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    @click.self="onClose"
    @keydown="onKeydown"
  >
    <Card
      data-testid="dimension-edit-dialog"
      class="w-full max-w-md p-4 shadow-xl"
      @click.stop
    >
      <h3 class="text-sm font-semibold">{{ title }}</h3>
      <div class="mt-3 space-y-3">
        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">分类键名 (英文，唯一标识) *</span>
          <Input
            data-testid="dimension-edit-key"
            v-model="key"
            :disabled="isEdit"
            :title="isEdit ? '编辑模式下键名不可修改' : ''"
            placeholder="如: outfit"
            class="h-8 text-sm"
          />
          <span v-if="isEdit" class="text-[11px] text-muted-foreground">编辑模式下此字段只读</span>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">中文名称 *</span>
          <Input
            data-testid="dimension-edit-nameCn"
            v-model="nameCn"
            placeholder="如: 套装"
            class="h-8 text-sm"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">英文名称 (可选)</span>
          <Input
            data-testid="dimension-edit-nameEn"
            v-model="nameEn"
            placeholder="如: Outfit"
            class="h-8 text-sm"
          />
        </label>
        <label class="flex items-center gap-2">
          <input
            data-testid="dimension-edit-multi"
            type="checkbox"
            v-model="isMultiSelect"
            class="h-3.5 w-3.5 rounded border-input"
          />
          <span class="text-xs text-muted-foreground">允许多选 (同维度可选多个词条)</span>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">排序权重</span>
          <input
            data-testid="dimension-edit-sortOrder"
            v-model.number="sortOrder"
            type="number"
            class="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <span class="text-[11px] text-muted-foreground">数值越小越靠前</span>
        </label>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button data-testid="dimension-edit-cancel" variant="ghost" size="sm" class="h-7 text-xs" @click="onClose">取消</Button>
        <Button
          data-testid="dimension-edit-confirm"
          size="sm"
          class="h-7 text-xs"
          :disabled="!key.trim() || !nameCn.trim()"
          @click="onConfirm"
        >保存</Button>
      </div>
      <p class="mt-2 text-[11px] text-muted-foreground">Ctrl+Enter 快速确认 · Esc 关闭</p>
    </Card>
  </div>
</template>
