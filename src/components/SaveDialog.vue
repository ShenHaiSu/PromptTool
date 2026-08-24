<script setup lang="ts">
/**
 * SaveDialog — 通用保存弹窗
 * mode: 'assembly' 保存方案 | 'template' 另存为模板 | 'rename' 重命名
 */
import { ref, watch, computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'

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
    <Card
      data-testid="save-dialog"
      class="w-full max-w-md p-4 shadow-xl"
      @click.stop
    >
      <h3 class="text-sm font-semibold">{{ title }}</h3>
      <p v-if="mode === 'assembly'" class="mt-1 text-xs text-muted-foreground">留空则自动以日期+Prompt 前 30 字命名</p>
      <div class="mt-3 space-y-3">
        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">{{ mode === 'template' ? '模板名称 *' : '标题' }}</span>
          <Input
            data-testid="save-dialog-name"
            v-model="name"
            :placeholder="namePlaceholder"
            class="h-8 text-sm"
            autofocus
          />
        </label>
        <label v-if="showDesc" class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">描述（可选）</span>
          <textarea
            data-testid="save-dialog-desc"
            v-model="desc"
            placeholder="一句话描述该模板适用场景"
            rows="2"
            class="min-h-[56px] w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button data-testid="save-dialog-cancel" variant="ghost" size="sm" class="h-7 text-xs" @click="onClose">取消</Button>
        <Button
          data-testid="save-dialog-confirm"
          size="sm"
          class="h-7 text-xs"
          :disabled="mode !== 'assembly' && !name.trim()"
          @click="onConfirm"
        >确定</Button>
      </div>
      <p class="mt-2 text-[11px] text-muted-foreground">Ctrl+Enter 快速确认 · Esc 关闭</p>
    </Card>
  </div>
</template>
