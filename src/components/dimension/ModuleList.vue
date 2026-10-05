<script setup lang="ts">
import { computed, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { dimColor } from '@/lib/utils'
import { useScrollPreserve, type ScrollApi } from '@/composables/useScrollPreserve'
import type { SelectedItem } from '@/engine/models'

const props = defineProps<{
  selectedCount: number
  filteredSelected: SelectedItem[]
  keyword: string
  showSettings: boolean
  separator: string
  useWeightBrackets: boolean
  sortBy: string
  activeWeightId: string | null
  draftWeight: number
  weightPos: { top: number; left: number }
  /** 该面板是否处于可见模式（browse/selected 切换用 v-show，保留各自滚动位置） */
  active?: boolean
}>()

const emit = defineEmits<{
  (e: 'clear'): void
  (e: 'open-save'): void
  (e: 'toggle-settings'): void
  (e: 'close-settings'): void
  (e: 'separator-change', ev: Event): void
  (e: 'bracket-toggle', ev: Event): void
  (e: 'sort-change', ev: Event): void
  (e: 'clear-search'): void
  (e: 'drag-end'): void
  (e: 'update:drag', v: SelectedItem[]): void
  (e: 'card-click', ev: MouseEvent, moduleId: string): void
  (e: 'weight-open', id: string, cur: number, ev?: MouseEvent): void
  (e: 'weight-confirm', id: string): void
  (e: 'weight-cancel'): void
  (e: 'draft-input', ev: Event): void
  (e: 'slider-input', ev: Event): void
  (e: 'toggle-lock', id: string): void
  (e: 'remove', id: string): void
}>()

const separatorOptions = [
  { label: '逗号 , ', value: ', ' },
  { label: 'BREAK', value: ' BREAK ' },
  { label: '换行 \\n', value: '\n' },
] as const
const sortOptions = [
  { label: '维度顺序', value: 'dimensionOrder' },
  { label: '自定义拖拽', value: 'customDragOrder' },
] as const

function cardBg(key: string): string {
  const hex = dimColor(key ?? '')
  const m = hex.match(/^#([0-9a-f]{6})$/i)
  if (!m) return ''
  const n = parseInt(m[1]!, 16)
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff
  const isDark = document.documentElement.classList.contains('dark')
  const a = isDark ? 0.16 : 0.08
  return `rgba(${r},${g},${b},${a})`
}

// —— 滚动位置保持（随机/增删已选时不再丢失滚动高度）——
const scroller = ref<ScrollApi | null>(null)
/** 列表是否可见：为空/无匹配时不渲染滚动内容，但滚动容器本身保持挂载 */
const hasItems = computed(() => props.selectedCount > 0 && props.filteredSelected.length > 0)
const scrollKey = computed(() => `selected:${props.keyword.trim().toLowerCase()}`)
useScrollPreserve({
  scroller,
  persistKey: scrollKey,
  activeSignal: () => props.active !== false,
  reloadSignal: () => `${props.selectedCount}:${props.filteredSelected.length}`,
  resetSignal: () => props.keyword,
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="flex shrink-0 items-center justify-between px-2 py-1.5">
      <span class="text-xs text-muted-foreground">已选 {{ selectedCount }} 项</span>
      <div class="flex items-center gap-1">
        <el-button data-testid="selected-save-btn" type="primary" size="small" :disabled="!selectedCount" @click="emit('open-save')">保存方案</el-button>
        <div class="relative">
          <el-button data-testid="selected-settings-btn" text size="small" @click="emit('toggle-settings')">… 设置</el-button>
          <div v-if="showSettings" data-testid="selected-settings-panel" class="absolute right-0 top-8 z-20 w-64 rounded-md border bg-popover p-3 shadow-lg">
            <p class="mb-2 text-xs font-semibold">拼装设置</p>
            <div class="space-y-3">
              <el-form label-width="96px" size="small">
                <el-form-item label="分隔符">
                  <el-select data-testid="setting-separator" :model-value="separator" @change="emit('separator-change', $event as unknown as Event)">
                    <el-option v-for="o in separatorOptions" :key="o.value" :value="o.value" :label="o.label" />
                  </el-select>
                </el-form-item>
                <el-form-item label="权重括号">
                  <el-switch data-testid="setting-brackets" :model-value="useWeightBrackets" @change="emit('bracket-toggle', $event as unknown as Event)" />
                </el-form-item>
                <el-form-item label="排序">
                  <el-select data-testid="setting-sortBy" :model-value="sortBy" @change="emit('sort-change', $event as unknown as Event)">
                    <el-option v-for="o in sortOptions" :key="o.value" :value="o.value" :label="o.label" />
                  </el-select>
                </el-form-item>
              </el-form>
            </div>
            <div class="mt-3 flex justify-end">
              <el-button plain size="small" @click="emit('close-settings')">关闭</el-button>
            </div>
          </div>
        </div>
        <el-button data-testid="selected-clear-btn" text size="small" :disabled="!selectedCount" @click="emit('clear')">清空</el-button>
      </div>
    </div>

    <div v-if="!selectedCount" data-testid="selected-empty" class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <el-empty description="暂无已选">
        <template #description>
          <p class="text-sm font-medium">暂无已选</p>
          <p class="max-w-[22rem] text-xs text-muted-foreground">去浏览模式双击添加词条 — 权重、锁定与拖拽排序在这里完成</p>
        </template>
      </el-empty>
    </div>
    <div v-else-if="filteredSelected.length === 0" class="flex flex-1 items-center justify-center p-6 text-xs text-muted-foreground">
      无匹配已选项 — <button class="text-primary underline" @click="emit('clear-search')">清空搜索</button>
    </div>

    <el-scrollbar v-show="hasItems" ref="scroller" class="flex-1">
      <div class="p-2">
        <VueDraggable :model-value="filteredSelected" data-testid="selected-draggable" class="flex flex-col gap-2" :animation="150" ghost-class="opacity-40" chosen-class="ring-1 ring-primary" handle=".drag-handle" @update:model-value="emit('update:drag', $event)" @end="emit('drag-end')">
          <div v-for="it in filteredSelected" :key="it.module.id" data-testid="selected-card" :data-module-id="it.module.id"
               class="group flex flex-col gap-1 rounded-md border px-3 py-2.5 shadow-sm hover:shadow"
               :style="{ background: cardBg(it.module.dimensionKey ?? ''), borderLeftColor: dimColor(it.module.dimensionKey ?? ''), borderLeftWidth: '4px' }"
               @click="emit('card-click', $event, it.module.id)"
               :title="'Ctrl+点击禁用并移出已选'">
            <div class="flex items-center gap-1.5">
              <span class="drag-handle cursor-grab select-none text-muted-foreground hover:text-foreground" title="拖拽排序">⋮⋮</span>
              <span class="h-2 w-2 shrink-0 rounded-full" :style="{ background: dimColor(it.module.dimensionKey ?? '') }" />
              <span class="min-w-0 flex-1 truncate text-sm font-medium" :title="it.module.contentEn">{{ it.module.displayName }}</span>
              <button data-testid="selected-weight-btn" :data-module-id="it.module.id" class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent" @click.stop="emit('weight-open', it.module.id, it.weightOverride ?? it.module.weight, $event)">w{{ (it.weightOverride ?? it.module.weight).toFixed(1) }}</button>
              <button data-testid="selected-lock-btn" class="rounded px-1 hover:bg-accent" @click.stop="emit('toggle-lock', it.module.id)">{{ it.locked ? '🔒' : '🔓' }}</button>
              <button data-testid="selected-remove-btn" class="rounded px-1 hover:bg-accent hover:text-destructive" @click.stop="emit('remove', it.module.id)">✕</button>
            </div>
            <div class="ml-6 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span class="rounded bg-background/60 px-1 py-0.5 font-mono text-[11px]">{{ it.module.dimensionKey ?? '未分类' }}</span>
              <span v-if="it.module.weight !== 1" class="font-mono text-[11px]">w{{ it.module.weight.toFixed(1) }}</span>
              <span v-if="it.module.isNsfw" class="h-1.5 w-1.5 rounded-full bg-red-500" title="NSFW" />
            </div>
          </div>
        </VueDraggable>
      </div>
    </el-scrollbar>

    <Teleport to="body">
      <div v-if="activeWeightId" data-testid="selected-weight-popover" class="fixed z-[80] w-56 rounded-md border bg-popover p-3 shadow-xl" :style="{ top: weightPos.top + 'px', left: weightPos.left + 'px' }">
        <p class="text-xs font-medium">权重（0.5–2.0）</p>
        <input data-testid="weight-slider" type="range" :value="draftWeight" :min="0.5" :max="2.0" :step="0.1" class="w-full" @input="emit('slider-input', $event)" />
        <div class="mt-2 flex items-center gap-2">
          <el-input-number data-testid="weight-input" :model-value="draftWeight" :min="0.5" :max="2.0" :step="0.1" size="small" class="flex-1" @change="emit('draft-input', $event as unknown as Event)" />
        </div>
        <div class="mt-2 flex justify-end gap-1">
          <el-button data-testid="weight-cancel" text size="small" @click="emit('weight-cancel')">取消</el-button>
          <el-button data-testid="weight-confirm" type="primary" size="small" @click="emit('weight-confirm', activeWeightId)">确定</el-button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
