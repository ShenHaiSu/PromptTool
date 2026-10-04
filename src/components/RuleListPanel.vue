<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRulesStore } from '@/stores/rules'
import { notify } from '@/lib/notify'
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

const search = ref('')
const onlyEnabled = ref(false)
const showDialog = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const editing = ref<Rule | null>(null)
const showDeleted = ref(false)

const TYPE_MAP: Record<string, 'warning' | 'primary' | 'danger' | 'info'> = {
  mutex: 'warning',
  requires: 'primary',
  excludes: 'warning',
  limit: 'info',
  isolated: 'danger',
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
      notify('规则已更新', 'success', 1200)
    } else {
      await rulesStore.saveRule(payload)
      notify('规则已创建', 'success', 1200)
    }
    showDialog.value = false
  } catch (e) {
    notify(`保存失败: ${String(e)}`, 'error')
  }
}

async function onToggle(rule: Rule, v: boolean): Promise<void> {
  try {
    await rulesStore.toggleRule(rule.id, v)
  } catch (e) {
    notify(`切换失败: ${String(e)}`, 'error')
  }
}

async function onDelete(rule: Rule): Promise<void> {
  const ok = window.confirm('删除规则将影响后续冲突判定，确定？')
  if (!ok) return
  try {
    await rulesStore.deleteRule(rule.id)
    notify('规则已删除', 'success', 1200)
  } catch (e) {
    notify(`删除失败: ${String(e)}`, 'error')
  }
}
</script>

<template>
  <div data-testid="rule-list" class="flex min-h-0 flex-1 flex-col" role="list">
    <div class="flex shrink-0 items-center gap-2">
      <el-input v-model="search" data-testid="rule-search" size="small" class="flex-1" placeholder="搜索规则名/消息…" clearable />
      <el-button data-testid="rule-create-btn" type="primary" size="small" @click="onCreate">+ 新建规则</el-button>
    </div>
    <label class="mt-1.5 flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      <el-switch v-model="onlyEnabled" size="small" />
      <span>仅看启用</span>
    </label>
    <p v-if="rulesStore.loadError" class="mt-1.5 shrink-0 rounded bg-amber-50 p-1.5 text-[11px] text-amber-700 dark:bg-amber-950 dark:text-amber-200">
      规则加载失败，仅内存规则可用：{{ rulesStore.loadError }}
    </p>
    <el-scrollbar class="mt-2 min-h-0 flex-1">
      <div v-if="filtered.length === 0" class="p-2">
        <el-empty description="暂无规则">
          <template #description>
            <p class="text-xs font-medium">暂无规则</p>
            <p class="text-[11px] text-muted-foreground">新建一条 mutex 规则开始管理冲突</p>
          </template>
        </el-empty>
      </div>
      <ul v-else class="flex flex-col gap-1.5 p-1">
        <li
          v-for="r in filtered"
          :key="r.id"
          :data-testid="`rule-row-${r.id}`"
          role="listitem"
          class="flex items-center gap-2 rounded-md border px-2 py-1.5"
        >
          <el-tag size="small" :type="TYPE_MAP[r.type] ?? 'info'">{{ r.type }}</el-tag>
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs font-medium" :title="r.name">{{ r.name }}</p>
            <p class="truncate text-[11px] text-muted-foreground" :title="r.message">{{ r.message }}</p>
            <p v-if="r.sourceDimensionId || r.targetDimensionId" class="truncate text-[10px] text-muted-foreground">
              {{ dimLabel(r.sourceDimensionId) }} → {{ dimLabel(r.targetDimensionId) }}
            </p>
          </div>
          <el-switch
            :data-testid="`rule-toggle-${r.id}`"
            :model-value="r.isEnabled"
            :title="r.isEnabled ? '点击禁用' : '点击启用'"
            :aria-label="`切换规则 ${r.name}`"
            size="small"
            @change="onToggle(r, $event as boolean)"
          />
          <button :data-testid="`rule-edit-${r.id}`" class="rounded px-1 text-xs hover:bg-accent" title="编辑规则" :aria-label="`编辑规则 ${r.name}`" @click="onEdit(r)">✎</button>
          <button :data-testid="`rule-del-${r.id}`" class="rounded px-1 text-xs hover:bg-accent hover:text-destructive" title="删除规则" :aria-label="`删除规则 ${r.name}`" @click="onDelete(r)">✕</button>
        </li>
      </ul>
    </el-scrollbar>
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
