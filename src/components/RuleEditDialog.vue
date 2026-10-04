<script setup lang="ts">
import { ref, computed } from 'vue'
import { RULE_TYPES } from '@/engine/ruleTypes'
import type { Rule, RuleType } from '@/engine/ruleTypes'
import type { RuleUpsertPayload } from '@/lib/db'

const props = withDefaults(defineProps<{
  open: boolean
  mode?: 'create' | 'edit'
  initialRule?: Rule | null
  dimensions?: { id: string; key: string; nameCn: string }[]
  modulesByDimId?: Record<string, { id: string; displayName: string }[]>
  limitCount?: number | null
}>(), {
  mode: 'create',
  initialRule: null,
  dimensions: () => [],
  modulesByDimId: () => ({}),
  limitCount: null,
})

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'confirm', payload: RuleUpsertPayload): void
}>()

const name = ref('')
const type = ref<RuleType>('mutex')
const sourceDim = ref('')
const sourceModule = ref('')
const targetDim = ref('')
const targetModule = ref('')
const limitCount = ref(1)
const message = ref('')
const isEnabled = ref(true)
const error = ref('')
let initializedFor: unknown = null

const TYPE_HINT: Record<RuleType, string> = {
  mutex: '源与目标二存一，默认保留源（锁定侧优先）',
  requires: '有源必须有目标；目标缺失时仅提示补选，无一键修复',
  excludes: '源排除目标关键词组；自动修复保留源侧',
  limit: '同维度段数上限；超限仅提示删减，无一键修复',
  isolated: '源独占：出现即清空其他段（error 级，应用前二次确认）',
}

function resetFromProps(): void {
  const r = props.initialRule
  name.value = r?.name ?? ''
  type.value = (r?.type ?? 'mutex') as RuleType
  sourceDim.value = r?.sourceDimensionId ?? ''
  sourceModule.value = r?.sourceModuleId ?? ''
  targetDim.value = r?.targetDimensionId ?? ''
  targetModule.value = r?.targetModuleId ?? ''
  limitCount.value = props.limitCount ?? 1
  message.value = r?.message ?? ''
  isEnabled.value = r?.isEnabled ?? true
  error.value = ''
}

function ensureInit(): void {
  if (!props.open) return
  const key = props.mode + (props.initialRule?.id ?? 'new')
  if (initializedFor !== key) {
    initializedFor = key
    resetFromProps()
  }
}

const sourceModules = computed(() => (sourceDim.value ? (props.modulesByDimId[sourceDim.value] ?? []) : []))
const targetModules = computed(() => (targetDim.value ? (props.modulesByDimId[targetDim.value] ?? []) : []))
const showTargets = computed(() => type.value !== 'limit')

function onClose(): void {
  emit('update:open', false)
}

function onSave(): void {
  error.value = ''
  if (!name.value.trim()) { error.value = '名称必填'; return }
  if (name.value.trim().length > 50) { error.value = '名称不能超过 50 字'; return }
  if (!message.value.trim()) { error.value = '提示消息必填（支持 {source}{target} 占位）'; return }
  if (type.value !== 'limit' && type.value !== 'isolated' && !sourceDim.value && !sourceModule.value && !targetDim.value && !targetModule.value) {
    error.value = 'mutex/requires/excludes 需至少一侧定位'; return
  }
  const payload: RuleUpsertPayload = {
    name: name.value.trim(),
    type: type.value,
    sourceDimensionId: sourceDim.value || null,
    sourceModuleId: sourceModule.value || null,
    targetDimensionId: showTargets.value ? (targetDim.value || null) : (sourceDim.value || null),
    targetModuleId: showTargets.value ? (targetModule.value || null) : null,
    message: message.value.trim(),
    isEnabled: isEnabled.value,
  }
  emit('confirm', payload)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') onClose()
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') onSave()
}
</script>

<template>
  <div v-if="open" data-testid="rule-dialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="onClose" @keydown="onKeydown">
    {{ ensureInit() }}
    <el-dialog
      :model-value="open"
      :title="mode === 'create' ? '新建规则' : '编辑规则'"
      width="520px"
      destroy-on-close
      :append-to-body="false"
      @close="onClose"
      @click.stop
    >
      <el-button text size="small" title="关闭" aria-label="关闭" @click="onClose">✕</el-button>
      <el-form label-width="96px" @submit.prevent>
        <el-form-item label="名称" required>
          <el-input v-model="name" data-testid="rule-name" placeholder="如：套装互斥·上装" />
        </el-form-item>
        <el-form-item label="类型" required>
          <el-select v-model="type" data-testid="rule-type" class="w-full">
            <el-option v-for="t in RULE_TYPES" :key="t" :value="t" :label="t" />
          </el-select>
          <span class="text-[11px] text-muted-foreground">{{ TYPE_HINT[type] }}</span>
        </el-form-item>
        <div class="grid grid-cols-2 gap-2">
          <el-form-item label="源维度">
            <el-select v-model="sourceDim" data-testid="rule-source-dim" class="w-full">
              <el-option value="" label="（不限）" />
              <el-option v-for="d in dimensions" :key="d.id" :value="d.id" :label="`${d.nameCn}（${d.key}）`" />
            </el-select>
          </el-form-item>
          <el-form-item label="源条目">
            <el-select v-model="sourceModule" data-testid="rule-source-module" class="w-full">
              <el-option value="" label="（全部）" />
              <el-option v-for="m in sourceModules" :key="m.id" :value="m.id" :label="m.displayName" />
            </el-select>
          </el-form-item>
        </div>
        <template v-if="showTargets">
          <div class="grid grid-cols-2 gap-2">
            <el-form-item label="目标维度">
              <el-select v-model="targetDim" data-testid="rule-target-dim" class="w-full">
                <el-option value="" label="（不限）" />
                <el-option v-for="d in dimensions" :key="d.id" :value="d.id" :label="`${d.nameCn}（${d.key}）`" />
              </el-select>
            </el-form-item>
            <el-form-item label="目标条目">
              <el-select v-model="targetModule" data-testid="rule-target-module" class="w-full">
                <el-option value="" label="（全部）" />
                <el-option v-for="m in targetModules" :key="m.id" :value="m.id" :label="m.displayName" />
              </el-select>
            </el-form-item>
          </div>
        </template>
        <el-form-item v-else label="上限数量">
          <el-input-number v-model="limitCount" data-testid="rule-limit-count" :min="1" :max="10" size="small" />
        </el-form-item>
        <el-form-item label="提示消息" required>
          <el-input v-model="message" data-testid="rule-message" placeholder="已选{source}，{target}将自动忽略" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="isEnabled" data-testid="rule-enabled" />
        </el-form-item>
        <p v-if="error" class="text-xs text-red-600 dark:text-red-400">{{ error }}</p>
      </el-form>
      <template #footer>
        <el-button text size="small" @click="onClose">取消</el-button>
        <el-button data-testid="rule-save" type="primary" size="small" @click="onSave">保存（Ctrl+Enter）</el-button>
      </template>
    </el-dialog>
  </div>
</template>
