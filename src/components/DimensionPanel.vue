<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAssemblyStore } from '@/stores/assembly'
import {
  dbGetDimensions, dbGetAllModulesGrouped,
  dbCreateDimension, dbUpdateDimension,
  dbCreateModule, dbUpdateModule, dbSoftDeleteModule,
} from '@/lib/db'
import DimensionEditDialog from '@/components/DimensionEditDialog.vue'
import ModuleEditDialog from '@/components/ModuleEditDialog.vue'
import ModuleBatchDialog from '@/components/ModuleBatchDialog.vue'
import { useToast } from '@/composables/useToast'
import { emit, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import type { Dimension, Module } from '@/engine/models'

const assembly = useAssemblyStore()
const { push } = useToast()

const keyword = ref('')
const allowNsfw = ref(false)

const dimensions = ref<Dimension[]>([])
const modulesByDim = ref<Record<string, Module[]>>({})
const loading = ref(false)
const expandedKeys = ref<Set<string>>(new Set())

// 弹窗状态
const showDimDialog = ref(false)
const dimDialogMode = ref<'create' | 'edit'>('create')
const editingDimension = ref<Dimension | null>(null)

const showModuleDialog = ref(false)
const moduleDialogMode = ref<'create' | 'edit'>('create')
const editingModule = ref<Module | null>(null)
const newModuleDimId = ref<string | null>(null)

const showBatchDialog = ref(false)
const batchDimension = ref<Dimension | null>(null)

const nsfwCount = computed(() => {
  let c = 0
  for (const mods of Object.values(modulesByDim.value)) for (const m of mods) if (m.isNsfw) c++
  return c
})

const filteredDimensions = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return dimensions.value
  return dimensions.value.filter((d) => {
    if (d.nameCn.toLowerCase().includes(kw) || d.nameEn.toLowerCase().includes(kw) || d.key.toLowerCase().includes(kw)) return true
    const mods = modulesByDim.value[d.id] ?? []
    return mods.some((m) => m.displayName.toLowerCase().includes(kw) || m.contentEn.toLowerCase().includes(kw))
  })
})

function filteredModules(dimId: string): Module[] {
  const list = modulesByDim.value[dimId] ?? []
  const kw = keyword.value.trim().toLowerCase()
  let out = list
  if (kw) out = out.filter((m) => m.displayName.toLowerCase().includes(kw) || m.contentEn.toLowerCase().includes(kw))
  if (!allowNsfw.value) out = out.filter((m) => !m.isNsfw)
  return out
}

function toggleExpand(key: string): void {
  const s = expandedKeys.value
  if (s.has(key)) s.delete(key)
  else s.add(key)
  expandedKeys.value = new Set(s)
}

function isExpanded(key: string): boolean {
  return expandedKeys.value.has(key)
}

function isSelected(moduleId: string): boolean {
  return assembly.selectedItems.some((it) => it.module.id === moduleId)
}

function onAdd(m: Module, dim: Dimension): void {
  if (isSelected(m.id)) return
  if (!dim.isMultiSelect) {
    const existing = assembly.selectedItems.find((it) => it.module.dimensionId === dim.id)
    if (existing) assembly.removeModule(existing.module.id)
  }
  assembly.addModule({ module: { ...m, dimensionKey: dim.key }, locked: false, weightOverride: null })
}

// 维度操作
function onCreateDimension(): void {
  dimDialogMode.value = 'create'
  editingDimension.value = null
  showDimDialog.value = true
}

function onEditDimension(dim: Dimension): void {
  dimDialogMode.value = 'edit'
  editingDimension.value = dim
  showDimDialog.value = true
}

async function onDimConfirm(payload: { key: string; nameCn: string; nameEn: string; sortOrder: number; isMultiSelect: boolean }): Promise<void> {
  try {
    if (dimDialogMode.value === 'create') {
      await dbCreateDimension(payload.key, payload.nameCn, payload.nameEn || undefined, payload.sortOrder, payload.isMultiSelect)
      push('维度已创建', 'success', 1500)
    } else if (editingDimension.value) {
      await dbUpdateDimension({
        ...editingDimension.value,
        nameCn: payload.nameCn,
        nameEn: payload.nameEn,
        sortOrder: payload.sortOrder,
        isMultiSelect: payload.isMultiSelect,
      })
      push('维度已更新', 'success', 1500)
    }
    await refresh()
    emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: dimDialogMode.value === 'create' ? 'create-dimension' : 'update-dimension' })
  } catch (e) {
    push(`操作失败: ${String(e)}`, 'error')
  }
}

// 词条操作
function onCreateModule(dimId: string): void {
  moduleDialogMode.value = 'create'
  editingModule.value = null
  newModuleDimId.value = dimId
  showModuleDialog.value = true
}

function onEditModule(m: Module): void {
  moduleDialogMode.value = 'edit'
  editingModule.value = m
  newModuleDimId.value = null
  showModuleDialog.value = true
}

async function onModuleConfirm(payload: { dimensionId: string; contentEn: string; displayName: string; weight: number; isNsfw: boolean; notes: string }): Promise<void> {
  try {
    if (moduleDialogMode.value === 'create') {
      await dbCreateModule(payload.dimensionId, payload.contentEn, payload.displayName, payload.weight)
      if (payload.isNsfw || payload.notes) {
        const grouped = await dbGetAllModulesGrouped()
        const all = Object.values(grouped).flat()
        const created = all.find((x) => x.contentEn === payload.contentEn && x.dimensionId === payload.dimensionId)
        if (created && (payload.isNsfw !== created.isNsfw || payload.notes !== (created.notes ?? ''))) {
          await dbUpdateModule({ ...created, isNsfw: payload.isNsfw, notes: payload.notes || null })
        }
      }
      push('词条已创建', 'success', 1500)
    } else if (editingModule.value) {
      await dbUpdateModule({
        ...editingModule.value,
        contentEn: payload.contentEn,
        displayName: payload.displayName,
        weight: payload.weight,
        isNsfw: payload.isNsfw,
        notes: payload.notes || null,
      })
      push('词条已更新', 'success', 1500)
    }
    await refresh()
    emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: moduleDialogMode.value === 'create' ? 'create-module' : 'update-module' })
  } catch (e) {
    push(`操作失败: ${String(e)}`, 'error')
  }
}

function onBatchCreate(dim: Dimension): void {
  batchDimension.value = dim
  showBatchDialog.value = true
}

async function onBatchImported(): Promise<void> {
  await refresh()
  emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: 'batch-create-modules' })
  if (batchDimension.value) {
    const key = batchDimension.value.key
    if (!expandedKeys.value.has(key)) {
      expandedKeys.value = new Set([...expandedKeys.value, key])
    }
  }
  push(`批量创建完成`, 'success', 1500)
}

async function onDeleteModule(m: Module): Promise<void> {
  if (!confirm(`确定删除词条「${m.displayName}」？`)) return
  try {
    await dbSoftDeleteModule(m.id)
    push('词条已删除', 'success', 1500)
    await refresh()
    emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: 'delete-module' })
  } catch (e) {
    push(`删除失败: ${String(e)}`, 'error')
  }
}

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const dims = await dbGetDimensions()
    dimensions.value = dims
    expandedKeys.value = new Set<string>()
    try {
      const grouped = await dbGetAllModulesGrouped()
      const byId: Record<string, Module[]> = {}
      for (const d of dims) {
        const key = d.key
        byId[d.id] = (grouped[key] ?? (grouped[d.id] ?? []))
      }
      for (const [k, v] of Object.entries(grouped)) {
        const dim = dims.find((d) => d.id === k)
        if (dim && !byId[dim.id]) byId[dim.id] = v
      }
      modulesByDim.value = byId
    } catch {
      modulesByDim.value = {}
    }
  } catch {
  } finally {
    loading.value = false
  }
}

onMounted(() => { void refresh() })

defineExpose({ refresh, keyword, allowNsfw, dimensions, modulesByDim, onCreateDimension })
</script>

<template>
  <section data-testid="dimension-panel" class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <!-- 工具行：搜索 + NSFW pill + 新建维度 -->
    <div class="flex shrink-0 flex-col gap-2 border-b px-3 py-2">
      <Input
        v-model="keyword"
        data-testid="dimension-search"
        placeholder="搜索 维度/条目…"
        class="h-8 text-sm"
      />
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground">维度 {{ filteredDimensions.length }} / {{ dimensions.length }}</span>
        <div class="flex items-center gap-1">
          <Button
            data-testid="create-dimension-btn"
            size="sm"
            variant="outline"
            class="h-7 px-2 text-xs"
            @click="onCreateDimension"
          >
            + 新建维度
          </Button>
          <Button
            data-testid="nsfw-pill"
            size="sm"
            :variant="allowNsfw ? 'default' : 'outline'"
            class="h-7 px-2 text-xs"
            :title="allowNsfw ? '已显示 NSFW 条目' : '已隐藏 NSFW 条目'"
            @click="allowNsfw = !allowNsfw"
          >
            <span class="mr-1 h-2 w-2 rounded-full" :class="allowNsfw ? 'bg-red-500' : 'bg-muted-foreground'" />
            NSFW {{ allowNsfw ? '开' : '关' }} · {{ nsfwCount }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Tree 按维度分组 -->
    <ScrollArea class="flex-1">
      <div class="p-2">
        <p v-if="loading" class="py-4 text-center text-xs text-muted-foreground">加载中…</p>
        <p v-else-if="filteredDimensions.length === 0" data-testid="dimension-empty" class="py-6 text-center text-xs text-muted-foreground">
          无匹配维度 — <button class="text-primary underline" @click="keyword = ''">清空搜索</button>
        </p>
        <div v-else class="space-y-1">
          <div
            v-for="dim in filteredDimensions"
            :key="dim.id"
            data-testid="dimension-group"
            :data-dim-key="dim.key"
            class="rounded-md border bg-card"
          >
            <!-- 维度头 -->
            <button
              :data-testid="`dimension-header-${dim.key}`"
              class="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-accent/50"
              @click="toggleExpand(dim.key)"
            >
              <div class="flex min-w-0 items-center gap-2">
                <span class="shrink-0 text-xs text-muted-foreground">{{ isExpanded(dim.key) ? '▾' : '▸' }}</span>
                <span class="truncate text-sm font-medium">{{ dim.nameCn }} <span class="text-xs font-normal text-muted-foreground">/ {{ dim.key }}</span></span>
                <span v-if="!dim.isMultiSelect" class="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800 dark:bg-amber-900 dark:text-amber-100">单选</span>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <span class="text-xs text-muted-foreground">{{ filteredModules(dim.id).length }}</span>
                <button
                  :data-testid="`dim-create-module-${dim.key}`"
                  class="rounded px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="在此维度下新建词条"
                  @click.stop="onCreateModule(dim.id)"
                >+</button>
                <button
                  :data-testid="`dim-batch-module-${dim.key}`"
                  class="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="批量新增（同维度按行）"
                  @click.stop="onBatchCreate(dim)"
                >批量</button>
                <button
                  :data-testid="`dim-edit-${dim.key}`"
                  class="rounded px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="编辑维度"
                  @click.stop="onEditDimension(dim)"
                >✎</button>
              </div>
            </button>

            <!-- 条目列表 -->
            <div v-if="isExpanded(dim.key)" class="border-t px-1 py-1">
              <div v-if="filteredModules(dim.id).length === 0" class="py-2 text-center text-xs text-muted-foreground">（该维度暂无可显示条目）</div>
              <button
                v-for="m in filteredModules(dim.id)"
                :key="m.id"
                :data-testid="`module-row-${m.id}`"
                :data-module-id="m.id"
                class="group flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                :class="isSelected(m.id) ? 'bg-primary/10 hover:bg-primary/15' : ''"
                :title="m.contentEn"
                @dblclick="onAdd(m, dim)"
                @click="onAdd(m, dim)"
              >
                <span class="min-w-0 flex-1 truncate text-sm">{{ m.displayName }}</span>
                <span class="flex shrink-0 items-center gap-1">
                  <span v-if="m.weight !== 1" class="text-xs text-muted-foreground">w{{ m.weight.toFixed(1) }}</span>
                  <span v-if="m.isNsfw" class="h-1.5 w-1.5 rounded-full bg-red-500" title="NSFW" />
                  <Badge v-if="isSelected(m.id)" variant="secondary" class="h-5 px-1 py-0 text-[10px]">已选</Badge>
                  <span class="hidden items-center gap-0.5 group-hover:inline-flex">
                    <button
                      :data-testid="`module-edit-${m.id}`"
                      class="rounded px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="编辑词条"
                      @click.stop="onEditModule(m)"
                    >✎</button>
                    <button
                      :data-testid="`module-delete-${m.id}`"
                      class="rounded px-1 text-xs text-muted-foreground hover:bg-accent hover:text-destructive"
                      title="删除词条"
                      @click.stop="onDeleteModule(m)"
                    >✕</button>
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>

    <!-- 维度创建/编辑弹窗 -->
    <DimensionEditDialog
      v-model:open="showDimDialog"
      :mode="dimDialogMode"
      :initial-dimension="editingDimension"
      @confirm="onDimConfirm"
    />

    <!-- 词条创建/编辑弹窗 -->
    <ModuleEditDialog
      v-model:open="showModuleDialog"
      :mode="moduleDialogMode"
      :dimensions="dimensions"
      :initial-dimension-id="newModuleDimId"
      :initial-module="editingModule"
      @confirm="onModuleConfirm"
    />

    <!-- 批量新增弹窗（Need01） -->
    <ModuleBatchDialog
      :open="showBatchDialog"
      :dimension="batchDimension"
      @update:open="showBatchDialog = $event"
      @imported="onBatchImported"
    />
  </section>
</template>
