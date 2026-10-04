<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus'
import { dimColor } from '@/lib/utils'
import { useRulesStore } from '@/stores/rules'
import type { IRSegment } from '@/engine/models'

defineProps<{
  draft: IRSegment[]
  lockedIndexes: Set<number>
  highlightIdx: number | null
  expandedSeg: number | null
  textDrafts: Record<number, string>
}>()

defineEmits<{
  (e: 'update:expanded-seg', v: number | null): void
  (e: 'text-input', index: number, v: string): void
  (e: 'text-confirm', index: number): void
  (e: 'weight-open', index: number, evt: MouseEvent): void
  (e: 'lock-toggle', index: number): void
  (e: 'seg-delete', index: number): void
  (e: 'writeback', index: number): void
  (e: 'drag-end', evt: { oldIndex?: number; newIndex?: number }): void
}>()

const rulesStore = useRulesStore()
const dimNameOf = (key: string): string => rulesStore.dimKeyToName[key] ?? key

function segBg(key: string): string {
  return dimColor(key || 'unknown')
}

function hasCjk(text: string): boolean {
  return /[一-鿿]/.test(text)
}
</script>

<template>
  <section class="flex min-h-0 flex-[58] flex-col overflow-hidden" aria-label="IR 段表">
    <el-scrollbar class="flex-1">
      <div v-if="draft.length === 0" data-testid="ir-editor-seg-list" class="flex min-h-[160px] flex-col items-center justify-center gap-2 p-6 text-center">
        <div class="text-lg text-muted-foreground">◈</div>
        <p class="text-xs font-medium">暂无段落</p>
        <p class="text-[11px] text-muted-foreground">点“+ 添加空段”手动写 Prompt 片</p>
      </div>
      <VueDraggable
        v-else
        :model-value="draft"
        data-testid="ir-editor-seg-list"
        class="flex flex-col gap-2 p-1"
        :animation="150"
        ghost-class="opacity-40"
        handle=".drag-handle"
        role="list"
        @end="$emit('drag-end', $event)"
        @update:model-value="() => {}"
      >
        <div
          v-for="(s, i) in draft"
          :key="`${s.sourceModuleId || 'seg'}-${i}`"
          :data-testid="`ir-editor-seg-row-${i}`"
          role="listitem"
          class="flex flex-col gap-1 rounded-md border px-3 py-2 shadow-sm hover:shadow"
          :class="[(lockedIndexes.has(i) ? 'ring-1 ring-primary' : ''), highlightIdx === i ? 'ring-2 ring-primary' : '']"
          :style="{ borderLeftColor: dimColor(s.dimensionKey || 'unknown'), borderLeftWidth: '4px', background: `color-mix(in srgb, ${segBg(s.dimensionKey)} 8%, transparent)` }"
        >
          <div class="flex items-center gap-1.5">
            <span class="drag-handle cursor-grab select-none text-muted-foreground hover:text-foreground" title="拖拽排序" aria-label="拖拽排序">⋮⋮</span>
            <span class="h-2 w-2 shrink-0 rounded-full" :style="{ background: dimColor(s.dimensionKey || 'unknown') }" />
            <span class="shrink-0 rounded bg-background/60 px-1 py-0.5 font-mono text-[11px]">{{ s.dimensionKey || '未分类' }}</span>
            <button
              :data-testid="`ir-editor-seg-text-${i}`"
              class="min-w-0 flex-1 cursor-text truncate text-left font-mono text-xs"
              :title="s.text || '（空段，点击展开编辑）'"
              @click="$emit('update:expanded-seg', expandedSeg === i ? null : i)"
            >{{ s.text || '（空段）' }}</button>
            <button :data-testid="`ir-editor-seg-weight-${i}`" class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent" :title="`权重 ${s.weight.toFixed(1)}，点击微调`" @click="$emit('weight-open', i, $event)">w{{ s.weight.toFixed(1) }}</button>
            <button :data-testid="`ir-editor-seg-lock-${i}`" class="rounded px-1 hover:bg-accent" :title="lockedIndexes.has(i) ? '已锁定：自动修复不会移除' : '锁定：自动修复不会移除'" :aria-label="`锁定段 ${i + 1}`" @click="$emit('lock-toggle', i)">{{ lockedIndexes.has(i) ? '🔒' : '🔓' }}</button>
            <button :data-testid="`ir-editor-seg-del-${i}`" class="rounded px-1 hover:bg-accent hover:text-destructive" title="删除该段" :aria-label="`删除段 ${i + 1}`" @click="$emit('seg-delete', i)">✕</button>
          </div>
          <div v-if="expandedSeg === i" :data-testid="`ir-editor-seg-expand-${i}`" class="ml-6 flex flex-col gap-1.5">
            <el-input
              :model-value="textDrafts[i] ?? s.text"
              size="small"
              class="font-mono"
              placeholder="英文片段，如 red slip dress"
              @update:model-value="$emit('text-input', i, String($event))"
              @change="$emit('text-confirm', i)"
              @keydown.enter="$emit('text-confirm', i)"
            />
            <p v-if="hasCjk(textDrafts[i] ?? s.text)" class="text-[11px] text-amber-600 dark:text-amber-400">检测到中文，拼入的 Prompt 通常为英文，请确认</p>
            <p v-if="!(s.text || '').trim()" class="text-[11px] text-amber-600 dark:text-amber-400" title="文本为空，该段不会拼入预览">文本为空，该段不会拼入预览</p>
            <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span class="truncate font-mono" :title="s.sourceModuleId || '无来源模块'">{{ s.sourceModuleId ? `src:${s.sourceModuleId}` : '无来源模块' }}</span>
              <span>{{ dimNameOf(s.dimensionKey) }}</span>
              <span class="ml-auto flex items-center gap-1">
                <button :data-testid="`ir-editor-seg-writeback-${i}`" class="rounded px-1 hover:bg-accent hover:text-foreground" :disabled="!s.sourceModuleId" :title="s.sourceModuleId ? '写回词条默认权重' : '无来源模块，不可写回权重'" @click="$emit('writeback', i)">写回权重</button>
              </span>
            </div>
          </div>
        </div>
      </VueDraggable>
    </el-scrollbar>
  </section>
</template>
