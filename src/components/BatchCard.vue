<script setup lang="ts">
import { ref, computed } from 'vue'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/composables/useToast'
import { useAssemblyStore } from '@/stores/assembly'
import { useHistoryStore } from '@/stores/history'
import { useRulesStore } from '@/stores/rules'
import { dimColor } from '@/lib/utils'
import { evaluateRules } from '@/engine/ruleEngine'
import type { BatchCardModel } from '@/engine/models'
import { dbSaveAssemblyFromIr } from '@/lib/db'
import IrConflictEditorDialog from './IrConflictEditorDialog.vue'

const props = withDefaults(defineProps<{ model: BatchCardModel; index: number }>(), {
  index: 1,
})

const emit = defineEmits<{ (e: 'refill', model: BatchCardModel): void }>()

const { push } = useToast()
const assembly = useAssemblyStore()
const historyStore = useHistoryStore()

const copied = ref(false)
const favorited = ref(false)
const showIrEditor = ref(false)

// need02：只读 findings（同步计算，不阻塞生成主链路；规则未加载时回退 warnings）
let rulesStore: ReturnType<typeof useRulesStore> | null = null
function getRulesStore(): ReturnType<typeof useRulesStore> | null {
  try {
    rulesStore ??= useRulesStore()
    return rulesStore
  } catch { return null }
}
const cardFindings = computed(() => {
  const fromIr = props.model.ir.findings?.filter((f) => !f.ignored) ?? []
  if (fromIr.length > 0) return fromIr
  try {
    const store = getRulesStore()
    const rules = store ? store.toEngineRules() : []
    if (rules.length === 0) return []
    return evaluateRules({ segments: props.model.ir.segments, rules })
  } catch { return [] }
})
const findingLine = computed(() => {
  if (cardFindings.value.length > 0) return cardFindings.value[0]!.message
  if (props.model.warnings.length > 0) return props.model.warnings.join('；')
  return ''
})

function onEditCard(): void {
  const store = getRulesStore()
  if (store && !store.loaded) void store.fetchAll().catch(() => {})
  showIrEditor.value = true
}

async function onCopy(): Promise<void> {
  const text = props.model.finalPrompt
  try {
    await navigator.clipboard.writeText(text)
  } catch {
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
  push('已复制', 'success', 1200)
  window.setTimeout(() => (copied.value = false), 350)
}

async function onFavorite(): Promise<void> {
  try {
    const irJson = JSON.stringify({ segments: props.model.ir.segments, warnings: props.model.warnings })
    await dbSaveAssemblyFromIr(irJson, props.model.finalPrompt, assembly.config, true)
    favorited.value = true
    push('已收藏', 'success', 1500)
    try { await historyStore.fetchFavorites(); await historyStore.fetchRecent() } catch { /* ignore */ }
  } catch (e) {
    push(`收藏失败: ${String(e)}`, 'error')
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
  push('已回填到画布', 'success', 1500)
  emit('refill', props.model)
}

function onCardClick(e: MouseEvent): void {
  // 点击空白处（非按钮）复制全文
  const target = e.target as HTMLElement
  if (target.closest('button')) return
  void onCopy()
}
</script>

<template>
  <Card
    data-testid="batch-card"
    :data-index="index"
    class="cursor-pointer p-3 transition-colors hover:bg-accent/30"
    :class="copied ? 'ring-1 ring-green-500' : ''"
    @click="onCardClick"
  >
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs font-semibold text-muted-foreground">#{{ index }}</span>
      <div class="flex items-center gap-1">
        <Button data-testid="batch-card-copy" size="sm" variant="ghost" class="h-6 px-2 text-xs" title="复制全文" @click.stop="onCopy">复制</Button>
        <Button
          data-testid="batch-card-fav"
          size="sm"
          :variant="favorited ? 'default' : 'outline'"
          class="h-6 px-2 text-xs"
          title="收藏"
          @click.stop="onFavorite"
          >{{ favorited ? '★ 已收藏' : '★ 收藏' }}</Button
        >
        <Button data-testid="batch-card-refill" size="sm" variant="outline" class="h-6 px-2 text-xs" title="回填到画布" @click.stop="onRefill"
          >↩ 回填</Button
        >
        <Button data-testid="batch-card-edit" size="sm" variant="outline" class="h-6 px-2 text-xs" title="在 IR 冲突编辑器中打开本卡" @click.stop="onEditCard">编辑</Button>
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
      <Badge
        v-for="k in model.dimKeys"
        :key="k"
        variant="secondary"
        class="h-5 px-1.5 text-[10px] text-white"
        :style="{ background: dimColor(k) }"
        :title="k"
        >{{ k }}</Badge
        >
    </div>
    <!-- need02：编辑器 applied 后提供“回填到画布”（首版明确：仅回填，不做更新本卡） -->
    <IrConflictEditorDialog :open="showIrEditor" :ir="model.ir" @update:open="showIrEditor = $event" />
  </Card>
</template>
