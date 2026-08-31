<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAssemblyStore } from '@/stores/assembly'
import { useHistoryStore } from '@/stores/history'
import {
  dbGetDimensions, dbGetAllModulesGrouped,
  dbCreateDimension, dbUpdateDimension,
  dbCreateModule, dbUpdateModule, dbSoftDeleteModule,
} from '@/lib/db'
import DimensionEditDialog from '@/components/DimensionEditDialog.vue'
import ModuleEditDialog from '@/components/ModuleEditDialog.vue'
import ModuleBatchDialog from '@/components/ModuleBatchDialog.vue'
import PromptPreviewDialog from '@/components/PromptPreviewDialog.vue'
import SaveDialog from '@/components/SaveDialog.vue'
import { useToast } from '@/composables/useToast'
import { emit, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import { dimColor } from '@/lib/utils'
import type { Dimension, Module } from '@/engine/models'

const assembly = useAssemblyStore()
const history = useHistoryStore()
const { push } = useToast()

const keyword = ref('')
const allowNsfw = ref(false)

const dimensions = ref<Dimension[]>([])
const modulesByDim = ref<Record<string, Module[]>>({})
const loading = ref(false)
const expandedKeys = ref<Set<string>>(new Set())

// —— need04: 双模与预览 ——
type DimPanelMode = 'browse' | 'selected'
const STORAGE_MODE = 'pmf:dimPanelMode'
function loadMode(): DimPanelMode {
  try {
    const v = localStorage.getItem(STORAGE_MODE)
    if (v === 'browse' || v === 'selected') return v as DimPanelMode
  } catch {}
  return 'browse'
}
const dimPanelMode = ref<DimPanelMode>(loadMode())
watch(dimPanelMode, (v) => { try { localStorage.setItem(STORAGE_MODE, v) } catch {} })
const previewOpen = ref(false)

const selectedCount = computed(() => assembly.selectedItems.length)

const filteredSelected = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return assembly.selectedItems
  return assembly.selectedItems.filter((it) => {
    const m = it.module
    const dim = dimensions.value.find((d) => d.id === m.dimensionId)
    return m.displayName.toLowerCase().includes(kw)
        || m.contentEn.toLowerCase().includes(kw)
        || (m.dimensionKey ?? '').toLowerCase().includes(kw)
        || (dim?.nameCn ?? '').toLowerCase().includes(kw)
  })
})

const draggableSelected = computed({
  get: () => assembly.selectedItems,
  set: (val) => assembly.setSelected(val as typeof assembly.selectedItems),
})

function selectedCardBg(key: string): string {
  const hex = dimColor(key ?? '')
  const m = hex.match(/^#([0-9a-f]{6})$/i)
  if (!m) return ''
  const n = parseInt(m[1]!, 16)
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff
  const isDark = document.documentElement.classList.contains('dark')
  const a = isDark ? 0.16 : 0.08
  return `rgba(${r},${g},${b},${a})`
}

// 权重 Popover（复用画布逻辑，迁移至面板）
const activeWeightId = ref<string | null>(null)
const draftWeight = ref(1.0)
function openWeightPopover(id: string, cur: number): void { activeWeightId.value = id; draftWeight.value = cur }
function confirmWeight(id: string): void { const v = clampWeight(draftWeight.value); assembly.updateWeight(id, v === 1 ? null : v); activeWeightId.value = null }
function cancelWeight(): void { activeWeightId.value = null }
function clampWeight(v: number): number { if (!Number.isFinite(v)) return 1.0; return Math.min(2.0, Math.max(0.5, Math.round(v * 10) / 10)) }
function onDraftInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value
  const n = parseFloat(raw)
  draftWeight.value = Number.isFinite(n) ? n : draftWeight.value
}
function onSliderInput(e: Event): void {
  const n = parseFloat((e.target as HTMLInputElement).value)
  if (Number.isFinite(n)) draftWeight.value = Math.round(n * 10) / 10
}
function onSelectedRemove(id: string): void { assembly.removeModule(id) }
function onToggleLock(id: string): void { assembly.toggleLocked(id) }
function onSelectedClear(): void {
  if (!assembly.selectedItems.length) return
  if (!window.confirm('清空全部已选？')) return
  assembly.clear()
}
function onDragEnd(): void { /* v-model 已同步 */ }

// 设置（从画布迁移）
const showSettings = ref(false)
const separatorOptions = [
  { label: '逗号 , ', value: ', ' },
  { label: 'BREAK', value: ' BREAK ' },
  { label: '换行 \\n', value: '\n' },
] as const
const sortOptions = [
  { label: '维度顺序', value: 'dimensionOrder' },
  { label: '自定义拖拽', value: 'customDragOrder' },
] as const
function onSeparatorChange(e: Event): void { assembly.setConfig({ separator: (e.target as HTMLSelectElement).value }) }
function onBracketToggle(e: Event): void { assembly.setConfig({ useWeightBrackets: (e.target as HTMLInputElement).checked }) }
function onSortChange(e: Event): void { assembly.setConfig({ sortBy: (e.target as HTMLSelectElement).value as any }) }

// 保存（从画布迁移）
const showSaveDialog = ref(false)
const showTemplateDialog = ref(false)
async function onSaveConfirm(payload: { name: string; desc: string | null }): Promise<void> {
  const irJson = JSON.stringify(assembly.ir.toJSON())
  await history.save(payload.name.trim() || null, irJson, assembly.finalPrompt, assembly.config, [...assembly.selectedItems], false)
}
async function onTemplateConfirm(payload: { name: string; desc: string | null }): Promise<void> {
  const name = payload.name.trim(); if (!name) return; if (!assembly.selectedItems.length) return
  if (assembly.selectedItems.some((it) => !it.module.dimensionKey?.trim())) return
  const enabledKeys = [...new Set(assembly.selectedItems.map((it) => it.module.dimensionKey).filter(Boolean) as string[])]
  await history.saveTemplate(name, payload.desc, assembly.config, enabledKeys, assembly.finalPrompt || null, [...assembly.selectedItems])
}

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

defineExpose({ refresh, keyword, allowNsfw, dimensions, modulesByDim, onCreateDimension, dimPanelMode })
</script>

<template>
  <section data-testid="dimension-panel" class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <!-- 标题栏：维度面板 + 预览入口 -->
    <div class="flex h-9 shrink-0 items-center justify-between border-b px-3">
      <h2 class="text-sm font-semibold">维度面板</h2>
      <Button data-testid="preview-trigger" variant="outline" size="sm" class="h-7 px-2 text-xs" title="审阅 IR、分段与冲突，复制/导出当前 Prompt" @click="previewOpen = true">
        👁 预览 · {{ selectedCount }}
      </Button>
    </div>

    <!-- 工具行：搜索 + NSFW pill + 新建维度 -->
    <div class="flex shrink-0 flex-col gap-2 border-b px-3 py-2">
      <Input
        v-model="keyword"
        data-testid="dimension-search"
        placeholder="搜索 维度/条目…"
        class="h-8 text-sm"
      />
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground">
          <template v-if="dimPanelMode === 'browse'">维度 {{ filteredDimensions.length }} / {{ dimensions.length }}</template>
          <template v-else>已选 {{ selectedCount }}</template>
        </span>
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

    <!-- 模式切换 SegmentedControl -->
    <div class="flex shrink-0 gap-1 border-b px-2 py-1.5">
      <Button data-testid="dim-mode-browse" size="sm" :variant="dimPanelMode === 'browse' ? 'default' : 'ghost'" class="h-7 flex-1 text-xs" @click="dimPanelMode = 'browse'">浏览</Button>
      <Button data-testid="dim-mode-selected" size="sm" :variant="dimPanelMode === 'selected' ? 'default' : 'ghost'" class="h-7 flex-1 text-xs" @click="dimPanelMode = 'selected'">已选 · {{ selectedCount }}</Button>
    </div>

    <!-- 浏览模式：Tree 按维度分组（现状保持） -->
    <ScrollArea v-if="dimPanelMode === 'browse'" class="flex-1">
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

    <!-- 已选模式：Card 平铺 -->
    <div v-else class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <!-- 操作行 -->
      <div class="flex shrink-0 items-center justify-between px-2 py-1.5">
        <span class="text-xs text-muted-foreground">已选 {{ selectedCount }} 项</span>
        <div class="flex items-center gap-1">
          <Button data-testid="selected-save-btn" variant="default" size="sm" class="h-7 px-2 text-xs" :disabled="!selectedCount" @click="showSaveDialog = true">保存方案</Button>
          <div class="relative">
            <Button data-testid="selected-settings-btn" variant="ghost" size="sm" class="h-7 px-2 text-xs" @click="showSettings = !showSettings">… 设置</Button>
            <div v-if="showSettings" data-testid="selected-settings-panel" class="absolute right-0 top-8 z-20 w-64 rounded-md border bg-popover p-3 shadow-lg">
              <p class="mb-2 text-xs font-semibold">拼装设置</p>
              <div class="space-y-3">
                <label class="flex flex-col gap-1">
                  <span class="text-xs text-muted-foreground">分隔符</span>
                  <select data-testid="setting-separator" class="h-8 rounded-md border bg-background px-2 text-sm" :value="assembly.config.separator" @change="onSeparatorChange">
                    <option v-for="o in separatorOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </label>
                <label class="flex items-center justify-between gap-2">
                  <span class="text-xs text-muted-foreground">权重括号</span>
                  <input data-testid="setting-brackets" type="checkbox" class="h-4 w-4 accent-primary" :checked="assembly.config.useWeightBrackets" @change="onBracketToggle" />
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-xs text-muted-foreground">排序</span>
                  <select data-testid="setting-sortBy" class="h-8 rounded-md border bg-background px-2 text-sm" :value="assembly.config.sortBy" @change="onSortChange">
                    <option v-for="o in sortOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </label>
              </div>
              <div class="mt-3 flex justify-end">
                <Button size="sm" variant="outline" class="h-7 text-xs" @click="showSettings = false">关闭</Button>
              </div>
            </div>
          </div>
          <Button data-testid="selected-clear-btn" variant="ghost" size="sm" class="h-7 px-2 text-xs" :disabled="!selectedCount" @click="onSelectedClear">清空</Button>
        </div>
      </div>

      <!-- 空态 -->
      <div v-if="!selectedCount" data-testid="selected-empty" class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <div class="text-2xl text-muted-foreground">◈</div>
        <p class="text-sm font-medium">暂无已选</p>
        <p class="max-w-[22rem] text-xs text-muted-foreground">去浏览模式双击添加词条 — 权重、锁定与拖拽排序在这里完成</p>
      </div>
      <div v-else-if="filteredSelected.length === 0" class="flex flex-1 items-center justify-center p-6 text-xs text-muted-foreground">
        无匹配已选项 — <button class="text-primary underline" @click="keyword = ''">清空搜索</button>
      </div>

      <!-- 卡片流 + 拖拽 -->
      <ScrollArea v-else class="flex-1">
        <div class="p-2">
          <VueDraggable v-model="draggableSelected" data-testid="selected-draggable" class="flex flex-col gap-2" :animation="150" ghost-class="opacity-40" chosen-class="ring-1 ring-primary" handle=".drag-handle" @end="onDragEnd">
            <div v-for="it in filteredSelected" :key="it.module.id" data-testid="selected-card" :data-module-id="it.module.id"
                 class="group flex flex-col gap-1 rounded-md border px-3 py-2.5 shadow-sm hover:shadow"
                 :style="{ background: selectedCardBg(it.module.dimensionKey ?? ''), borderLeftColor: dimColor(it.module.dimensionKey ?? ''), borderLeftWidth: '4px' }">
              <div class="flex items-center gap-1.5">
                <span class="drag-handle cursor-grab select-none text-muted-foreground hover:text-foreground" title="拖拽排序">⋮⋮</span>
                <span class="h-2 w-2 shrink-0 rounded-full" :style="{ background: dimColor(it.module.dimensionKey ?? '') }" />
                <span class="min-w-0 flex-1 truncate text-sm font-medium" :title="it.module.contentEn">{{ it.module.displayName }}</span>
                <button data-testid="selected-weight-btn" class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent" @click="openWeightPopover(it.module.id, it.weightOverride ?? it.module.weight)">w{{ (it.weightOverride ?? it.module.weight).toFixed(1) }}</button>
                <div v-if="activeWeightId === it.module.id" data-testid="selected-weight-popover" class="absolute z-20 mt-8 flex w-56 flex-col gap-2 rounded-md border bg-popover p-3 shadow-xl" @click.stop>
                  <p class="text-xs font-medium">权重 0.5 – 2.0 · 步进 0.1</p>
                  <div class="flex items-center gap-2">
                    <input data-testid="weight-slider" type="range" min="0.5" max="2.0" step="0.1" :value="String(draftWeight)" class="flex-1 accent-primary" @input="onSliderInput" />
                    <span class="w-8 text-center font-mono text-xs">{{ draftWeight.toFixed(1) }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <Input data-testid="weight-input" type="number" :model-value="String(draftWeight)" :value="String(draftWeight)" min="0.5" max="2.0" step="0.1" class="h-7 flex-1 text-xs" @input="onDraftInput" />
                  </div>
                  <div class="flex justify-end gap-1.5">
                    <Button size="sm" variant="ghost" class="h-7 text-xs" data-testid="weight-cancel" @click="cancelWeight">取消</Button>
                    <Button size="sm" class="h-7 text-xs" data-testid="weight-confirm" @click="confirmWeight(it.module.id)">确定</Button>
                  </div>
                </div>
                <button data-testid="selected-lock-btn" class="rounded px-1 hover:bg-accent" @click="onToggleLock(it.module.id)">{{ it.locked ? '🔒' : '🔓' }}</button>
                <button data-testid="selected-remove-btn" class="rounded px-1 hover:bg-accent hover:text-destructive" @click="onSelectedRemove(it.module.id)">✕</button>
              </div>
              <div class="ml-6 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span class="rounded bg-background/60 px-1 py-0.5 font-mono text-[11px]">{{ it.module.dimensionKey ?? '未分类' }}</span>
                <span v-if="it.module.weight !== 1" class="font-mono text-[11px]">w{{ it.module.weight.toFixed(1) }}</span>
                <span v-if="it.module.isNsfw" class="h-1.5 w-1.5 rounded-full bg-red-500" title="NSFW" />
              </div>
            </div>
          </VueDraggable>
        </div>
      </ScrollArea>
    </div>

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

    <!-- 批量新增弹窗 -->
    <ModuleBatchDialog
      :open="showBatchDialog"
      :dimension="batchDimension"
      @update:open="showBatchDialog = $event"
      @imported="onBatchImported"
    />

    <!-- 预览 Dialog -->
    <PromptPreviewDialog :open="previewOpen" :prompt="assembly.finalPrompt" :warnings="assembly.warnings" :ir="assembly.ir" @update:open="previewOpen = $event" />

    <!-- 保存弹窗（从画布迁移） -->
    <SaveDialog :open="showSaveDialog" mode="assembly" @update:open="showSaveDialog = $event" @confirm="onSaveConfirm" />
    <SaveDialog :open="showTemplateDialog" mode="template" @update:open="showTemplateDialog = $event" @confirm="onTemplateConfirm" />
  </section>
</template>
