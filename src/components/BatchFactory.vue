<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Button } from '@/components/ui/button'
import BatchCard from '@/components/BatchCard.vue'
import { useBatchStore } from '@/stores/batch'
import { useAssemblyStore } from '@/stores/assembly'
import { useToast } from '@/composables/useToast'
import { exportBatchCsv } from '@/lib/export'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { dbGetDimensions, dbGetAllModulesGrouped } from '@/lib/db'
import type { Dimension, Module } from '@/engine/models'

const batch = useBatchStore()
const assembly = useAssemblyStore()
const { push } = useToast()

// 控制行状态
const count = ref<number>(20)
const allowNsfw = ref(false)
const usePartial = ref(false)

// 维度/模块缓存（批量生成所需；与 DimensionPanel 共享数据源，本地懒加载）
const dimensions = ref<Dimension[]>([])
const modulesByDim = ref<Record<string, Module[]>>({})
const loadingDims = ref(false)

async function ensureDims(): Promise<void> {
  if (dimensions.value.length) return
  loadingDims.value = true
  try {
    dimensions.value = await dbGetDimensions()
    try {
      modulesByDim.value = await dbGetAllModulesGrouped()
    } catch { modulesByDim.value = {} }
  } catch { /* jsdom 无 Tauri 时降级 */ }
  finally { loadingDims.value = false }
}

function clampCount(v: number): number {
  if (!Number.isFinite(v)) return 20
  return Math.min(500, Math.max(1, Math.round(v)))
}

function onCountInput(e: Event): void {
  const n = parseInt((e.target as HTMLInputElement).value, 10)
  count.value = Number.isFinite(n) ? clampCount(n) : count.value
}

async function onRandom(): Promise<void> {
  await ensureDims()
  const cfg = assembly.config
  if (usePartial.value && assembly.selectedItems.length > 0) {
    // 可控部分随机：以 assembly.selectedItems 为锚点
    batch.generatePartial(
      dimensions.value,
      modulesByDim.value,
      assembly.selectedItems,
      count.value,
      cfg,
      allowNsfw.value,
    )
    push(`已生成 ${batch.results.length} 条（可控）`, 'success', 1600)
  } else {
    const lockedIds = new Set(assembly.selectedItems.filter((it) => it.locked).map((it) => it.module.id))
    batch.generate(dimensions.value, modulesByDim.value, lockedIds, count.value, cfg, allowNsfw.value)
    push(`已生成 ${batch.results.length} 条`, 'success', 1600)
  }
  // 生成后 virtualizer 需重算
  await nextTick()
}

function onClear(): void {
  batch.clear()
  push('已清空批量结果', 'info', 1200)
}

async function onCopyAll(): Promise<void> {
  if (!batch.results.length) {
    push('暂无可复制内容', 'warning')
    return
  }
  const text = batch.results.map((r) => r.finalPrompt).join('\n')
  try {
    await navigator.clipboard.writeText(text)
    push(`已复制 ${batch.results.length} 条`, 'success', 1500)
  } catch {
    push('复制失败', 'error')
  }
}

function onExportCsv(): void {
  if (!batch.results.length) {
    push('暂无可导出内容', 'warning')
    return
  }
  // 阶段六：复用 export.ts 对标 exporter.py 的 列 序号/提示词/维度构成/冲突警告
  exportBatchCsv(batch.results as unknown as Array<{ finalPrompt: string; warnings: string[]; ir: import('@/engine/models').PromptIR }>)
  push('已导出 CSV', 'success', 1500)
}

// 虚拟化：TanStack Virtual，容器 h-[400px]，estimateSize 110px，overscan 5
const parentRef = ref<HTMLElement | null>(null)
const totalCount = computed(() => batch.results.length)

const virtualizer = useVirtualizer(
  computed(() => ({
    count: totalCount.value,
    getScrollElement: () => parentRef.value,
    estimateSize: () => 110,
    overscan: 5,
  })),
)

const virtualItems = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

// 当 results 变化时，确保 virtualizer 重算（getVirtualItems 会在滚动时更新）
watch(totalCount, async () => {
  await nextTick()
})
</script>

<template>
  <section data-testid="batch-factory" class="flex min-h-0 flex-col border-b">
    <!-- 顶部控制行 -->
    <div class="flex shrink-0 flex-col gap-2 px-3 py-2">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold">批量工厂</h2>
        <span data-testid="batch-count-label" class="text-xs text-muted-foreground">{{ batch.results.length }} 条结果</span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-1 text-xs">
          <span class="text-muted-foreground">数量</span>
          <input
            data-testid="batch-count-input"
            type="number"
            :value="count"
            min="1"
            max="500"
            step="1"
            class="h-7 w-16 rounded-md border bg-background px-2 text-sm"
            @input="onCountInput"
          />
        </label>
        <Button
          data-testid="batch-random-btn"
          size="sm"
          class="h-7 text-xs"
          :disabled="loadingDims && dimensions.length === 0"
          @click="onRandom"
          >{{ usePartial ? '可控随机' : '随机生成' }}</Button
        >
        <label class="flex items-center gap-1 text-xs" title="包含 NSFW 条目">
          <input data-testid="batch-nsfw-switch" type="checkbox" class="h-3.5 w-3.5 accent-primary" :checked="allowNsfw" @change="allowNsfw = !allowNsfw" />
          <span>含NSFW</span>
        </label>
        <label
          class="flex items-center gap-1 text-xs"
          title="以画布已选项为锚点，仅随机缺口维度（与 random_engine partialRandomAssembly 对齐）"
        >
          <input data-testid="batch-partial-switch" type="checkbox" class="h-3.5 w-3.5 accent-primary" :checked="usePartial" @change="usePartial = !usePartial" />
          <span>可控</span>
          <span class="text-muted-foreground" title="以当前画布为锚点做部分随机">ⓘ</span>
        </label>
        <div class="ml-auto flex items-center gap-1">
          <Button data-testid="batch-copy-all" variant="outline" size="sm" class="h-7 text-xs" :disabled="!batch.results.length" @click="onCopyAll"
            >复制全部</Button
          >
          <Button data-testid="batch-clear" variant="ghost" size="sm" class="h-7 text-xs" :disabled="!batch.results.length" @click="onClear">清空</Button>
          <Button data-testid="batch-export-csv" variant="outline" size="sm" class="h-7 text-xs" :disabled="!batch.results.length" @click="onExportCsv"
            >导出CSV</Button
          >
        </div>
      </div>
    </div>

    <!-- 虚拟化 Card 流 -->
    <div
      v-if="batch.results.length === 0"
      data-testid="batch-empty"
      class="flex h-[220px] items-center justify-center p-4 text-center text-xs text-muted-foreground"
    >
      暂无批量结果 — 设置数量后点击「随机生成」；可控开关开启时以画布为锚点
    </div>
    <div v-else ref="parentRef" data-testid="batch-virtual-scroll" class="h-[400px] overflow-auto border-t">
      <div :style="{ height: totalSize + 'px', width: '100%', position: 'relative' }">
        <div
          v-for="v in virtualItems"
          :key="String(v.key)"
          :data-index="v.index"
          :style="{
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            transform: `translateY(${v.start}px)`,
          }"
          class="p-2"
        >
          <BatchCard :model="batch.results[v.index]!" :index="v.index + 1" />
        </div>
      </div>
    </div>
  </section>
</template>
