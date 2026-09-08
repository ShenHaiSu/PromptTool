<script setup lang="ts">
import { ref, computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRulesStore } from '@/stores/rules'
import { useToast } from '@/composables/useToast'
import RuleEditDialog from './RuleEditDialog.vue'
import type { Rule } from '@/engine/ruleTypes'
import type { RuleUpsertPayload } from '@/lib/db'

const props = withDefaults(defineProps<{
  dimensions?: { id: string; key: string; nameCn: string }[]
  modulesByDimId?: Record<string, { id: string; displayName: string }[]>
}>(), {
  dimensions: () => [],
  modulesByDimId: () => ({}),
})

const rulesStore = useRulesStore()
const { push } = useToast()

const search = ref('')
const onlyEnabled = ref(false)
const showDialog = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const editing = ref<Rule | null>(null)
const showDeleted = ref(false)

const TYPE_BADGE: Record<string, string> = {
  mutex: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  requires: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  excludes: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  limit: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  isolated: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
}

const filtered = computed(() => {
  const kw = search.value.trim().toLowerCase()
  return rulesStore.rules.filter((r) => {
    if (onlyEnabled.value && !r.isEnabled) return false
    if (!kw) return true
    return r.name.toLowerCase().includes(kw) || r.message.toLowerCase().includes(kw) || r.id.toLowerCase().includes(kw)
  })
})

function dimLabel(id: string | null): string {
  if (!id) return ''
  const d = props.dimensions.find((x) => x.id === id)
  return d ? `${d.nameCn}(${d.key})` : id
}

function onCreate(): void {
  dialogMode.value = 'create'
  editing.value = null
  showDialog.value = true
}

function onEdit(rule: Rule): void {
  dialogMode.value = 'edit'
  editing.value = rule
  showDialog.value = true
}

async function onConfirm(payload: RuleUpsertPayload): Promise<void> {
  try {
    if (dialogMode.value === 'edit' && editing.value) {
      await rulesStore.saveRule(payload, editing.value.id)
      push('规则已更新', 'success', 1200)
    } else {
      await rulesStore.saveRule(payload)
      push('规则已创建', 'success', 1200)
    }
    showDialog.value = false
  } catch (e) {
    push(`保存失败: ${String(e)}`, 'error')
  }
}

async function onToggle(rule: Rule, v: boolean): Promise<void> {
  try {
    await rulesStore.toggleRule(rule.id, v)
  } catch (e) {
    push(`切换失败: ${String(e)}`, 'error')
  }
}

async function onDelete(rule: Rule): Promise<void> {
  const ok = window.confirm('删除规则将影响后续冲突判定，确定？')
  if (!ok) return
  try {
    await rulesStore.deleteRule(rule.id)
    push('规则已删除', 'success', 1200)
  } catch (e) {
    push(`删除失败: ${String(e)}`, 'error')
  }
}
</script>

<template>
  <div data-testid="rule-list" class="flex min-h-0 flex-1 flex-col" role="list">
    <div class="flex shrink-0 items-center gap-2">
      <Input v-model="search" data-testid="rule-search" class="h-7 flex-1 text-xs" placeholder="搜索规则名/消息…" />
      <Button data-testid="rule-create-btn" size="sm" class="h-7 text-xs" @click="onCreate">+ 新建规则</Button>
    </div>
    <label class="mt-1.5 flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      <input v-model="onlyEnabled" type="checkbox" class="accent-primary" />
      <span>仅看启用</span>
    </label>
    <p v-if="rulesStore.loadError" class="mt-1.5 shrink-0 rounded bg-amber-50 p-1.5 text-[11px] text-amber-700 dark:bg-amber-950 dark:text-amber-200">
      规则加载失败，仅内存规则可用：{{ rulesStore.loadError }}
    </p>
    <div class="mt-2 min-h-0 flex-1 overflow-auto">
      <div v-if="filtered.length === 0" class="flex min-h-[120px] flex-col items-center justify-center gap-1 p-4 text-center">
        <p class="text-xs font-medium">暂无规则</p>
        <p class="text-[11px] text-muted-foreground">新建一条 mutex 规则开始管理冲突</p>
      </div>
      <ul v-else class="flex flex-col gap-1.5">
        <li
          v-for="r in filtered"
          :key="r.id"
          :data-testid="`rule-row-${r.id}`"
          role="listitem"
          class="flex items-center gap-2 rounded-md border px-2 py-1.5"
        >
          <span class="rounded px-1.5 py-0.5 text-[10px] font-medium" :class="TYPE_BADGE[r.type] ?? ''">{{ r.type }}</span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs font-medium" :title="r.name">{{ r.name }}</p>
            <p class="truncate text-[11px] text-muted-foreground" :title="r.message">{{ r.message }}</p>
            <p v-if="r.sourceDimensionId || r.targetDimensionId" class="truncate text-[10px] text-muted-foreground">
              {{ dimLabel(r.sourceDimensionId) }} → {{ dimLabel(r.targetDimensionId) }}
            </p>
          </div>
          <input
            :data-testid="`rule-toggle-${r.id}`"
            type="checkbox"
            class="accent-primary"
            :checked="r.isEnabled"
            :title="r.isEnabled ? '点击禁用' : '点击启用'"
            :aria-label="`切换规则 ${r.name}`"
            @change="onToggle(r, ($event.target as HTMLInputElement).checked)"
          />
          <button :data-testid="`rule-edit-${r.id}`" class="rounded px-1 text-xs hover:bg-accent" title="编辑规则" :aria-label="`编辑规则 ${r.name}`" @click="onEdit(r)">✎</button>
          <button :data-testid="`rule-del-${r.id}`" class="rounded px-1 text-xs hover:bg-accent hover:text-destructive" title="删除规则" :aria-label="`删除规则 ${r.name}`" @click="onDelete(r)">✕</button>
        </li>
      </ul>
    </div>
    <p v-if="showDeleted" class="hidden" />
    <RuleEditDialog
      :open="showDialog"
      :mode="dialogMode"
      :initial-rule="editing"
      :dimensions="dimensions"
      :modules-by-dim-id="modulesByDimId"
      @update:open="showDialog = $event"
      @confirm="onConfirm"
    />
  </div>
</template>
