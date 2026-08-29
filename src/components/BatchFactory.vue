<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { Button } from '@/components/ui/button'
import BatchCard from '@/components/BatchCard.vue'
import { useBatchStore } from '@/stores/batch'
import { useAssemblyStore } from '@/stores/assembly'
import { useLibraryStore } from '@/stores/library'
import { useToast } from '@/composables/useToast'
import { exportBatchCsv } from '@/lib/export'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { on, off, LIBRARY_CHANGED } from '@/lib/libraryEvents'

const batch = useBatchStore()
const assembly = useAssemblyStore()
const library = useLibraryStore()
const { push } = useToast()

// 控制行状态
const count = ref<number>(20)
const allowNsfw = ref(false)
const usePartial = ref(false)

const loadingDims = computed(() => library.loading)

async function refreshDims(): Promise<void> {
  await library.fetchAll()
}

async function ensureDims(): Promise<void> {
  // P0 热修复：不再 early-return，每次按需保证新鲜度由调用方决定
  // 兼容旧路径：若尚未加载则拉取一次
  if (library.dimensions.length === 0) {
    await library.fetchAll()
  }
}

function onLibraryChanged(): void {
  // P1 事件同步：写后由 libraryStore 决策立即或防抖刷新
  library.scheduleFetch()
}

onMounted(() => {
  on(LIBRARY_CHANGED, onLibraryChanged)
  // 首帧若 library 尚未加载，触发一次加载
  if (library.dimensions.length === 0) void library.fetchAll()
})

onBeforeUnmount(() => {
  off(LIBRARY_CHANGED, onLibraryChanged)
})

function clampCount(v: number): number {
  if (!Number.isFinite(v)) return 20
  return Math.min(500, Math.max(1, Math.round(v)))
}

function onCountInput(e: Event): void {
  const n = parseInt((e.target as HTMLInputElement).value, 10)
  count.value = Number.isFinite(n) ? clampCount(n) : count.value
}

async function onRandom(): Promise<void> {
  // P0+P3：点击随机不受防抖约束，强制实时拉取
  await library.ensureFreshForRandom()
  // 兜底：确保至少有一次加载
  await ensureDims()
  const cfg = assembly.config
  const dims = library.dimensions
  const grouped = library.modulesByDim
  if (usePartial.value && assembly.selectedItems.length > 0) {
    batch.generatePartial(
      dims,
      grouped,
      assembly.selectedItems,
      count.value,
      cfg,
      allowNsfw.value,
    )
    push(`已生成 ${batch.results.length} 条（可控）`, 'success', 1600)
  } else {
    const lockedIds = new Set(assembly.selectedItems.filter((it) => it.locked).map((it) => it.module.id))
    batch.generate(dims, grouped, lockedIds, count.value, cfg, allowNsfw.value)
    push(`已生成 ${batch.results.length} 条`, 'success', 1600)
  }
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
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 5,
  })),
)

const virtualItems = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

const measureRow = (el: unknown) => {
  if (el instanceof HTMLElement) virtualizer.value.measureElement(el as any)
}

watch(totalCount, async () => {
  await nextTick()
})

defineExpose({ refresh: refreshDims })
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
          :disabled="loadingDims && library.dimensions.length === 0"
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
      <div v-if="library.dirty && library.total > 200" class="text-[11px] text-muted-foreground">词库已变更，10 秒内自动同步 · 随机按钮不受影响</div>
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
          :ref="measureRow"
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
