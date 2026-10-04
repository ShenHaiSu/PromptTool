<script setup lang="ts">
import { ref, watch, computed } from 'vue'
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
    <el-dialog
      :model-value="open"
      :title="title"
      width="460px"
      destroy-on-close
      :append-to-body="false"
      data-testid="module-edit-dialog"
      @close="onClose"
      @click.stop
    >
      <el-form label-width="96px" :rules="{ contentEn: [{ required: true, message: '英文提示词必填', trigger: 'blur' }] }" @submit.prevent>
        <el-form-item label="所属维度" required>
          <el-select
            data-testid="module-edit-dimension"
            v-model="dimensionId"
            :disabled="isEdit"
            :title="isEdit ? '编辑模式下维度不可修改' : ''"
            class="w-full"
          >
            <el-option v-for="d in dimensions" :key="d.id" :value="d.id" :label="`${d.nameCn} / ${d.key}`" />
          </el-select>
          <span v-if="isEdit" class="text-[11px] text-muted-foreground">编辑模式下此字段只读</span>
        </el-form-item>
        <el-form-item label="英文提示词" required>
          <el-input
            data-testid="module-edit-contentEn"
            v-model="contentEn"
            placeholder="如: white shirt"
          />
          <span class="text-[11px] text-muted-foreground">该词条实际拼入 Prompt 的英文内容</span>
        </el-form-item>
        <el-form-item label="中文显示名">
          <el-input
            data-testid="module-edit-displayName"
            v-model="displayName"
            placeholder="如: 白衬衫（不填则回退显示英文）"
          />
        </el-form-item>
        <el-form-item label="权重">
          <div class="flex w-full items-center gap-2">
            <el-slider
              data-testid="module-edit-weight-slider"
              v-model="weight"
              :min="0.5"
              :max="2.0"
              :step="0.1"
              class="flex-1"
            />
            <el-input-number
              data-testid="module-edit-weight"
              v-model="weight"
              :min="0.5"
              :max="2.0"
              :step="0.1"
              size="small"
              class="w-24"
            />
          </div>
        </el-form-item>
        <el-form-item label="NSFW">
          <el-switch
            data-testid="module-edit-nsfw"
            v-model="isNsfw"
          />
          <span class="ml-2 text-xs text-muted-foreground">仅对随机生成生效</span>
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            data-testid="module-edit-notes"
            v-model="notes"
            placeholder="备注信息"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button data-testid="module-edit-cancel" text size="small" @click="onClose">取消</el-button>
        <el-button
          data-testid="module-edit-confirm"
          type="primary"
          size="small"
          :disabled="!dimensionId || !contentEn.trim()"
          @click="onConfirm"
        >保存</el-button>
      </template>
      <p class="mt-2 text-[11px] text-muted-foreground">Ctrl+Enter 快速确认 · Esc 关闭</p>
    </el-dialog>
  </div>
</template>
