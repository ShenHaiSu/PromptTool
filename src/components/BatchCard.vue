<script setup lang="ts">
import { ref, computed } from 'vue'
import { notify } from '@/lib/notify'
import { useAssemblyStore } from '@/stores/assembly'
import { useHistoryStore } from '@/stores/history'
import { useRulesStore } from '@/stores/rules'
import { dimColor } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { evaluateRules } from '@/engine/ruleEngine'
import type { BatchCardModel } from '@/engine/models'
import { dbSaveAssemblyFromIr } from '@/lib/db'
import IrConflictEditorDialog from './IrConflictEditorDialog.vue'

const props = withDefaults(defineProps<{ model: BatchCardModel; index: number }>(), {
  index: 1,
})

const emit = defineEmits<{ (e: 'refill', model: BatchCardModel): void }>()

const assembly = useAssemblyStore()
const historyStore = useHistoryStore()

const copied = ref(false)
const favorited = ref(false)
const showIrEditor = ref(false)

let rulesStore: ReturnType<typeof useRulesStore> | null = null
function getRulesStore(): ReturnType<typeof useRulesStore> | null {
  try {
    rulesStore ??= useRulesStore()
    return rulesStore
  } catch (err) {
    logger.warn('BatchCard', 'getRulesStore', err)
    return null
  }
}
const cardFindings = computed(() => {
  const fromIr = props.model.ir.findings?.filter((f) => !f.ignored) ?? []
  if (fromIr.length > 0) return fromIr
  try {
    const store = getRulesStore()
    const rules = store ? store.toEngineRules() : []
    if (rules.length === 0) return []
    return evaluateRules({ segments: props.model.ir.segments, rules })
  } catch (err) {
    logger.warn('BatchCard', 'cardFindings', err)
    return []
  }
})
const findingLine = computed(() => {
  if (cardFindings.value.length > 0) return cardFindings.value[0]!.message
  if (props.model.warnings.length > 0) return props.model.warnings.join('；')
  return ''
})

function onEditCard(): void {
  const store = getRulesStore()
  if (store && !store.loaded) void store.fetchAll().catch((err: unknown) => logger.warn('BatchCard', 'fetchAll', err))
  showIrEditor.value = true
}

async function onCopy(): Promise<void> {
  const text = props.model.finalPrompt
  try {
    await navigator.clipboard.writeText(text)
  } catch (err) {
    logger.warn('BatchCard', 'clipboard降级', err)
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  copied.value = true
  notify('已复制', 'success', 1200)
  window.setTimeout(() => (copied.value = false), 350)
}

async function onFavorite(): Promise<void> {
  try {
    const irJson = JSON.stringify({ segments: props.model.ir.segments, warnings: props.model.warnings })
    await dbSaveAssemblyFromIr(irJson, props.model.finalPrompt, assembly.config, true)
    favorited.value = true
    notify('已收藏', 'success', 1500)
    try { await historyStore.fetchFavorites(); await historyStore.fetchRecent() } catch (err) { logger.warn('BatchCard', 'fetchHistory', err) }
  } catch (e) {
    notify(`收藏失败: ${String(e)}`, 'error')
  }
}

function onRefill(): void {
  if (assembly.selectedItems.length > 0) {
    const ok = window.confirm(`当前画布已有 ${assembly.selectedItems.length} 项，回填将覆盖为批量方案，是否继续？`)
    if (!ok) return
  }
  const items = props.model.ir.segments.map((seg) => ({
    module: {
      id: seg.sourceModuleId,
      dimensionId: '',
      contentEn: seg.text,
      displayName: seg.text.length > 24 ? seg.text.slice(0, 24) : seg.text,
      weight: seg.weight,
      isEnabled: true,
      isNsfw: false,
      usageCount: 0,
      dimensionKey: seg.dimensionKey,
    },
    weightOverride: seg.weight !== 1 ? seg.weight : null,
    locked: false,
  }))
  assembly.setSelected(items as typeof assembly.selectedItems)
  notify('已回填到画布', 'success', 1500)
  emit('refill', props.model)
}

function onCardClick(e: MouseEvent): void {
  const target = e.target as HTMLElement
  if (target.closest('button')) return
  void onCopy()
}
</script>

<template>
  <el-card
    data-testid="batch-card"
    :data-index="index"
    class="cursor-pointer"
    :class="copied ? 'ring-1 ring-green-500' : ''"
    @click="onCardClick"
  >
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs font-semibold text-muted-foreground">#{{ index }}</span>
      <div class="flex items-center gap-1">
        <el-button data-testid="batch-card-copy" text size="small" title="复制全文" @click.stop="onCopy">复制</el-button>
        <el-button
          data-testid="batch-card-fav"
          size="small"
          :type="favorited ? 'primary' : undefined"
          :plain="!favorited"
          title="收藏"
          @click.stop="onFavorite"
          >{{ favorited ? '★ 已收藏' : '★ 收藏' }}</el-button
        >
        <el-button data-testid="batch-card-refill" plain size="small" title="回填到画布" @click.stop="onRefill"
          >↩ 回填</el-button
        >
        <el-button data-testid="batch-card-edit" plain size="small" title="在 IR 冲突编辑器中打开本卡" @click.stop="onEditCard">编辑</el-button>
      </div>
    </div>
    <p
      data-testid="batch-card-prompt"
      class="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed"
      :title="model.finalPrompt"
    >
      {{ model.finalPrompt }}
    </p>
    <div v-if="findingLine" class="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
      ⚠ {{ findingLine }}
    </div>
    <div class="mt-2 flex flex-wrap gap-1">
      <el-tag
        v-for="k in model.dimKeys"
        :key="k"
        size="small"
        :style="{ '--el-tag-bg-color': dimColor(k), '--el-tag-text-color': '#fff', '--el-tag-border-color': dimColor(k) }"
        :title="k"
        >{{ k }}</el-tag
      >
    </div>
    <IrConflictEditorDialog :open="showIrEditor" :ir="model.ir" @update:open="showIrEditor = $event" />
  </el-card>
</template>
