<script setup lang="ts">
import { computed, ref } from 'vue'
import { useScrollPreserve, type ScrollApi } from '@/composables/useScrollPreserve'
import type { Dimension, Module } from '@/engine/models'

const props = defineProps<{
  loading: boolean
  dims: Dimension[]
  keyword: string
  modulesOf: (dimId: string) => Module[]
  isExpanded: (key: string) => boolean
  isSelected: (id: string) => boolean
  /** 该面板是否处于可见模式（browse/selected 切换用 v-show，保留各自滚动位置） */
  active?: boolean
}>()

const emit = defineEmits<{
  (e: 'dim-click', ev: MouseEvent, dim: Dimension): void
  (e: 'dim-context', ev: MouseEvent, dim: Dimension): void
  (e: 'create-module', dimId: string): void
  (e: 'batch-create', dim: Dimension): void
  (e: 'edit-dimension', dim: Dimension): void
  (e: 'module-click', ev: MouseEvent, m: Module, dim: Dimension): void
  (e: 'edit-module', m: Module): void
  (e: 'delete-module', m: Module): void
  (e: 'clear-search'): void
}>()

// —— 滚动位置保持（点击随机/词库刷新不再丢失滚动高度）——
const scroller = ref<ScrollApi | null>(null)
/** 空态/有数据：loading 只在无旧数据时接管，避免卸载列表导致 scrollTop 归零 */
const showLoadingPlaceholder = computed(() => props.loading && props.dims.length === 0)
/** 有旧数据时的同步提示（不卸载内容） */
const showSyncingHint = computed(() => props.loading && props.dims.length > 0)
const scrollKey = computed(() => `browse:${props.keyword.trim().toLowerCase()}`)
useScrollPreserve({
  scroller,
  persistKey: scrollKey,
  reloadSignal: () => props.loading,
  resetSignal: () => props.keyword,
  activeSignal: () => props.active !== false,
})
</script>

<template>
  <el-scrollbar ref="scroller" class="flex-1">
    <div class="p-2">
      <p v-if="showSyncingHint" data-testid="dimension-syncing" class="pb-1 text-center text-[11px] text-muted-foreground">同步中…</p>
      <div v-if="showLoadingPlaceholder" data-testid="dimension-loading" class="py-4 text-center text-xs text-muted-foreground">加载中…</div>
      <div v-else-if="dims.length === 0" class="p-2">
        <el-empty data-testid="dimension-empty" description="无匹配维度">
          <template #description>
            <p class="text-xs">无匹配维度 — <button class="text-primary underline" @click="emit('clear-search')">清空搜索</button></p>
          </template>
        </el-empty>
      </div>
      <div v-else class="space-y-1">
        <div
          v-for="dim in dims"
          :key="dim.id"
          data-testid="dimension-group"
          :data-dim-key="dim.key"
          class="rounded-md border bg-card"
        >
          <button
            :data-testid="`dimension-header-${dim.key}`"
            :data-dim-key="dim.key"
            class="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-accent/50"
            :class="!dim.isEnabled ? 'opacity-60' : ''"
            :title="!dim.isEnabled ? '已禁用，不参与可控随机 — Ctrl+点击或右键菜单可启用' : 'Ctrl+点击或右键菜单可启用/禁用'"
            @click="emit('dim-click', $event, dim)"
            @contextmenu.prevent="emit('dim-context', $event, dim)"
          >
            <div class="flex min-w-0 items-center gap-2">
              <span class="shrink-0 text-xs text-muted-foreground">{{ isExpanded(dim.key) ? '▾' : '▸' }}</span>
              <span class="truncate text-sm font-medium">{{ dim.nameCn }} <span class="text-xs font-normal text-muted-foreground">/ {{ dim.key }}</span></span>
              <el-tag v-if="!dim.isEnabled" size="small" type="info">禁用</el-tag>
              <span v-if="!dim.isMultiSelect" class="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800 dark:bg-amber-900 dark:text-amber-100">单选</span>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <span class="text-xs text-muted-foreground">{{ modulesOf(dim.id).length }}</span>
              <button
                :data-testid="`dim-create-module-${dim.key}`"
                class="rounded px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                title="在此维度下新建词条"
                @click.stop="emit('create-module', dim.id)"
              >+</button>
              <button
                :data-testid="`dim-batch-module-${dim.key}`"
                class="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                title="批量新增（同维度按行）"
                @click.stop="emit('batch-create', dim)"
              >批量</button>
              <button
                :data-testid="`dim-edit-${dim.key}`"
                class="rounded px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                title="编辑维度"
                @click.stop="emit('edit-dimension', dim)"
              >✎</button>
            </div>
          </button>

          <div v-if="isExpanded(dim.key)" class="border-t px-1 py-1">
            <div v-if="modulesOf(dim.id).length === 0" class="py-2 text-center text-xs text-muted-foreground">（该维度暂无可显示条目）</div>
            <button
              v-for="m in modulesOf(dim.id)"
              :key="m.id"
              :data-testid="`module-row-${m.id}`"
              :data-module-id="m.id"
              class="group flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
              :class="[isSelected(m.id) ? 'bg-primary/10 hover:bg-primary/15' : '', !m.isEnabled ? 'opacity-60' : '']"
              :title="!m.isEnabled ? '已禁用，不参与可控随机 — Ctrl+点击可启用' : `${m.contentEn} — Ctrl+点击可禁用`"
              @click="emit('module-click', $event, m, dim)"
            >
              <span class="min-w-0 flex-1 truncate text-sm">{{ m.displayName }}</span>
              <span class="flex shrink-0 items-center gap-1">
                <el-tag v-if="!m.isEnabled" size="small" type="info">禁用</el-tag>
                <span v-if="m.weight !== 1" class="text-xs text-muted-foreground">w{{ m.weight.toFixed(1) }}</span>
                <span v-if="m.isNsfw" class="h-1.5 w-1.5 rounded-full bg-red-500" title="NSFW" />
                <el-tag v-if="isSelected(m.id)" size="small" type="success">已选</el-tag>
                <span class="hidden items-center gap-0.5 group-hover:inline-flex">
                  <button
                    :data-testid="`module-edit-${m.id}`"
                    class="rounded px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="编辑词条"
                    @click.stop="emit('edit-module', m)"
                  >✎</button>
                  <button
                    :data-testid="`module-delete-${m.id}`"
                    class="rounded px-1 text-xs text-muted-foreground hover:bg-accent hover:text-destructive"
                    title="删除词条"
                    @click.stop="emit('delete-module', m)"
                  >✕</button>
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </el-scrollbar>
</template>
