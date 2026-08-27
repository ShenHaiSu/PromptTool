<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import type { Dimension, Module } from '@/engine/models'

const props = withDefaults(defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  dimensions: Dimension[]
  initialDimensionId?: string | null
  initialModule?: Module | null
}>(), {
  initialDimensionId: null,
  initialModule: null,
})

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'confirm', payload: { dimensionId: string; contentEn: string; displayName: string; weight: number; isNsfw: boolean; notes: string }): void
  (e: 'cancel'): void
}>()

const dimensionId = ref('')
const contentEn = ref('')
const displayName = ref('')
const weight = ref(1.0)
const isNsfw = ref(false)
const notes = ref('')

const title = computed(() => props.mode === 'create' ? '新建词条' : '编辑词条')
const isEdit = computed(() => props.mode === 'edit')

watch(() => props.open, (v) => {
  if (!v) return
  if (props.mode === 'edit' && props.initialModule) {
    const m = props.initialModule
    dimensionId.value = m.dimensionId
    contentEn.value = m.contentEn
    displayName.value = m.displayName ?? ''
    weight.value = m.weight
    isNsfw.value = m.isNsfw
    notes.value = m.notes ?? ''
  } else {
    dimensionId.value = props.initialDimensionId ?? props.dimensions[0]?.id ?? ''
    contentEn.value = ''
    displayName.value = ''
    weight.value = 1.0
    isNsfw.value = false
    notes.value = ''
  }
})

function onClose(): void {
  emit('update:open', false)
  emit('cancel')
}

function onConfirm(): void {
  if (!dimensionId.value || !contentEn.value.trim()) return
  emit('confirm', {
    dimensionId: dimensionId.value,
    contentEn: contentEn.value.trim(),
    displayName: displayName.value.trim() || contentEn.value.trim(),
    weight: weight.value,
    isNsfw: isNsfw.value,
    notes: notes.value.trim() || '',
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
    data-testid="module-edit-dialog-overlay"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    @click.self="onClose"
    @keydown="onKeydown"
  >
    <Card
      data-testid="module-edit-dialog"
      class="w-full max-w-md p-4 shadow-xl"
      @click.stop
    >
      <h3 class="text-sm font-semibold">{{ title }}</h3>
      <div class="mt-3 space-y-3">
        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">所属维度 *</span>
          <select
            data-testid="module-edit-dimension"
            v-model="dimensionId"
            :disabled="isEdit"
            :title="isEdit ? '编辑模式下维度不可修改' : ''"
            class="h-8 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
          >
            <option v-for="d in dimensions" :key="d.id" :value="d.id">{{ d.nameCn }} / {{ d.key }}</option>
          </select>
          <span v-if="isEdit" class="text-[11px] text-muted-foreground">编辑模式下此字段只读</span>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">英文提示词 (content) *</span>
          <Input
            data-testid="module-edit-contentEn"
            v-model="contentEn"
            placeholder="如: white shirt"
            class="h-8 text-sm"
          />
          <span class="text-[11px] text-muted-foreground">该词条实际拼入 Prompt 的英文内容</span>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">中文显示名 (可选)</span>
          <Input
            data-testid="module-edit-displayName"
            v-model="displayName"
            placeholder="如: 白衬衫（不填则回退显示英文）"
            class="h-8 text-sm"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">权重</span>
          <div class="flex items-center gap-2">
            <input
              data-testid="module-edit-weight-slider"
              type="range"
              :min="0.5"
              :max="2.0"
              :step="0.1"
              v-model.number="weight"
              class="flex-1"
            />
            <input
              data-testid="module-edit-weight"
              v-model.number="weight"
              type="number"
              :min="0.5"
              :max="2.0"
              :step="0.1"
              class="flex h-8 w-20 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </label>
        <label class="flex items-center gap-2">
          <input
            data-testid="module-edit-nsfw"
            type="checkbox"
            v-model="isNsfw"
            class="h-3.5 w-3.5 rounded border-input"
          />
          <span class="text-xs text-muted-foreground">NSFW (仅对随机生成生效)</span>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">备注 (可选)</span>
          <Input
            data-testid="module-edit-notes"
            v-model="notes"
            placeholder="备注信息"
            class="h-8 text-sm"
          />
        </label>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button data-testid="module-edit-cancel" variant="ghost" size="sm" class="h-7 text-xs" @click="onClose">取消</Button>
        <Button
          data-testid="module-edit-confirm"
          size="sm"
          class="h-7 text-xs"
          :disabled="!dimensionId || !contentEn.trim()"
          @click="onConfirm"
        >保存</Button>
      </div>
      <p class="mt-2 text-[11px] text-muted-foreground">Ctrl+Enter 快速确认 · Esc 关闭</p>
    </Card>
  </div>
</template>
