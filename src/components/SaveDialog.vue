<script setup lang="ts">
/**
 * SaveDialog — 通用保存弹窗（EP化：el-dialog + el-form）
 */
import { ref, watch, computed } from 'vue'

type Mode = 'assembly' | 'template' | 'rename'

const props = withDefaults(defineProps<{
  open: boolean
  mode: Mode
  initialName?: string
  initialDesc?: string
  placeholder?: string
}>(), {
  initialName: '',
  initialDesc: '',
  placeholder: '',
})

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'confirm', payload: { name: string; desc: string | null }): void
  (e: 'cancel'): void
}>()

const name = ref(props.initialName)
const desc = ref(props.initialDesc ?? '')

watch(() => props.open, (v) => {
  if (v) {
    name.value = props.initialName ?? ''
    desc.value = props.initialDesc ?? ''
  }
})

watch(() => props.initialName, (v) => { if (props.open) name.value = v ?? '' })

const title = computed(() => {
  if (props.mode === 'template') return '另存为模板'
  if (props.mode === 'rename') return '重命名'
  return '保存方案'
})

const namePlaceholder = computed(() => {
  if (props.placeholder) return props.placeholder
  if (props.mode === 'template') return '模板名称，例如：JK 校服风'
  if (props.mode === 'rename') return '新标题'
  return '方案标题（留空自动生成 2026-08-24 · xxx...）'
})

const showDesc = computed(() => props.mode === 'template')

function onClose(): void {
  emit('update:open', false)
  emit('cancel')
}

function onConfirm(): void {
  const n = name.value.trim()
  if (props.mode !== 'assembly' && !n) return
  emit('confirm', { name: n, desc: desc.value.trim() || null })
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
    data-testid="save-dialog-overlay"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    @click.self="onClose"
    @keydown="onKeydown"
  >
    <el-dialog
      :model-value="open"
      :title="title"
      width="420px"
      destroy-on-close
      :append-to-body="false"
      data-testid="save-dialog"
      @close="onClose"
      @click.stop
    >
      <p v-if="mode === 'assembly'" class="mt-1 text-xs text-muted-foreground">留空则自动以日期+Prompt 前 30 字命名</p>
      <el-form label-width="96px" class="mt-3" @submit.prevent>
        <el-form-item :label="mode === 'template' ? '模板名称' : '标题'" :required="mode !== 'assembly'">
          <el-input
            data-testid="save-dialog-name"
            v-model="name"
            :placeholder="namePlaceholder"
            autofocus
          />
        </el-form-item>
        <el-form-item v-if="showDesc" label="描述">
          <el-input
            data-testid="save-dialog-desc"
            v-model="desc"
            type="textarea"
            :rows="2"
            placeholder="一句话描述该模板适用场景"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button data-testid="save-dialog-cancel" text size="small" @click="onClose">取消</el-button>
        <el-button
          data-testid="save-dialog-confirm"
          type="primary"
          size="small"
          :disabled="mode !== 'assembly' && !name.trim()"
          @click="onConfirm"
        >确定</el-button>
      </template>
      <p class="mt-2 text-[11px] text-muted-foreground">Ctrl+Enter 快速确认 · Esc 关闭</p>
    </el-dialog>
  </div>
</template>
