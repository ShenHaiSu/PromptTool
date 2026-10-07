<script setup lang="ts">
 import { ref, watch, computed } from 'vue'
 import { useOverlayClose } from '@/composables/useOverlayClose'
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
const oc = useOverlayClose(onClose, { open: computed(() => props.open) })

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
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onConfirm()
}
</script>

<template>
  <div
    v-if="open"
    data-testid="dimension-edit-dialog-overlay"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    @mousedown="oc.onMouseDown" @click="oc.onClick" @keydown="onKeydown"
  >
    <el-dialog
      :model-value="open"
      :title="title"
      width="440px"
      destroy-on-close
      :append-to-body="false"
      :modal="false" :close-on-click-modal="false" :close-on-press-escape="false"
      data-testid="dimension-edit-dialog"
      @close="onClose"
      @click.stop
    >
      <el-form label-width="96px" :rules="{ key: [{ required: true, message: '键名必填', trigger: 'blur' }], nameCn: [{ required: true, message: '中文名称必填', trigger: 'blur' }] }" @submit.prevent>
        <el-form-item label="分类键名" required>
          <el-input
            data-testid="dimension-edit-key"
            v-model="key"
            :disabled="isEdit"
            :title="isEdit ? '编辑模式下键名不可修改' : ''"
            placeholder="如: outfit"
          />
          <span v-if="isEdit" class="text-[11px] text-muted-foreground">编辑模式下此字段只读</span>
        </el-form-item>
        <el-form-item label="中文名称" required>
          <el-input
            data-testid="dimension-edit-nameCn"
            v-model="nameCn"
            placeholder="如: 套装"
          />
        </el-form-item>
        <el-form-item label="英文名称">
          <el-input
            data-testid="dimension-edit-nameEn"
            v-model="nameEn"
            placeholder="如: Outfit"
          />
        </el-form-item>
        <el-form-item label="允许多选">
          <el-switch
            data-testid="dimension-edit-multi"
            v-model="isMultiSelect"
          />
          <span class="ml-2 text-xs text-muted-foreground">同维度可选多个词条</span>
        </el-form-item>
        <el-form-item label="排序权重">
          <el-input-number
            data-testid="dimension-edit-sortOrder"
            v-model="sortOrder"
            :step="1"
          />
          <span class="ml-2 text-[11px] text-muted-foreground">数值越小越靠前</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button data-testid="dimension-edit-cancel" text size="small" @click="onClose">取消</el-button>
        <el-button
          data-testid="dimension-edit-confirm"
          type="primary"
          size="small"
          :disabled="!key.trim() || !nameCn.trim()"
          @click="onConfirm"
        >保存</el-button>
      </template>
      <p class="mt-2 text-[11px] text-muted-foreground">Ctrl+Enter 快速确认 · Esc 关闭</p>
    </el-dialog>
  </div>
</template>
