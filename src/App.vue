 <script setup lang="ts">
 import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
 import DimensionPanel from '@/components/DimensionPanel.vue'
 import BatchFactory from '@/components/BatchFactory.vue'
 import ImageQueuePanel from '@/components/ImageQueuePanel.vue'
 import SingleShotPanel from '@/components/SingleShotPanel.vue'
 import StatsReportDialog from '@/components/StatsReportDialog.vue'
 import HistoryPanel from '@/components/HistoryPanel.vue'
 import StatusBar from '@/components/StatusBar.vue'
 import LibraryDialog from '@/components/LibraryDialog.vue'
 import SegmentImportDialog from '@/components/SegmentImportDialog.vue'
 import { useAssemblyStore } from '@/stores/assembly'
 import { useHistoryStore } from '@/stores/history'
import { useSash } from '@/composables/useSash'
import { appToasts, useToast } from '@/composables/useToast'
import { useShortcuts } from '@/composables/useShortcuts'
import { useThemeStore } from '@/stores/theme'
import BusinessDbOnboardingDialog from '@/components/BusinessDbOnboardingDialog.vue'
import DbManagerDrawer from '@/components/DbManagerDrawer.vue'
import ImageTaskDetailDialog from '@/components/ImageTaskDetailDialog.vue'
import { useDbRegistryStore } from '@/stores/dbRegistry'
import { useLibraryStore } from '@/stores/library'
import { dbGetTempCarry } from '@/lib/db'
import { on as onEvent, off as offEvent, LIBRARY_CHANGED } from '@/lib/libraryEvents'

const assembly = useAssemblyStore()
const historyStore = useHistoryStore()
const dbRegistry = useDbRegistryStore()
const themeStore = useThemeStore()
const library = useLibraryStore()
void themeStore.mode
const { leftFrac, centerFrac, setFracs } = useSash()
const { push } = useToast()

function focusSearch(): void {
  const el = document.querySelector<HTMLInputElement>('[data-testid="dimension-search"]')
  el?.focus()
  el?.select()
}
function doSaveShortcut(): void {
  if (!assembly.finalPrompt && assembly.selectedItems.length === 0) {
    push('空方案暂不保存 — 请先添加词条', 'warning')
    return
  }
  const irJson = JSON.stringify(assembly.ir.toJSON())
  historyStore.save(null, irJson, assembly.finalPrompt, assembly.config, [...assembly.selectedItems], false)
    .then(() => push('已保存方案（Ctrl+S）', 'success', 1500))
    .catch((err) => push(`保存失败: ${String(err)}`, 'error'))
}
async function doCopyShortcut(): Promise<void> {
  const text = assembly.finalPrompt
  if (!text) { push('暂无可复制的 Prompt', 'warning'); return }
  try {
    await navigator.clipboard.writeText(text)
    push('已复制到剪贴板（Ctrl+C）', 'success', 1500)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    document.execCommand('copy'); document.body.removeChild(ta)
    push('已复制到剪贴板（Ctrl+C）', 'success', 1500)
  }
}
function doRemoveShortcut(): void {
  const last = assembly.selectedItems[assembly.selectedItems.length - 1]
  if (!last) return
  assembly.removeModule(last.module.id)
  push(`已移除 ${last.module.displayName}`, 'info', 1200)
}

useShortcuts({ focusSearch, save: doSaveShortcut, copy: doCopyShortcut, remove: doRemoveShortcut })

const dimCount = ref(0)
const moduleCount = ref(0)

const showDbManager = ref(false)

const showLibraryDialog = ref(false)
const showSegmentImport = ref(false)
const dimensionPanelRef = ref<{ refresh: () => Promise<void> } | null>(null)
const batchFactoryRef = ref<{ refresh: () => Promise<void> } | null>(null)
 // F3 §4 + need01 需求4：中间栏 Tabs（本地 ref，不持久化，默认停留在 prompt；single 按需挂载）
 const centerTab = ref<'prompt' | 'image' | 'single'>('prompt')

function syncCountsFromLibrary(): void {
  if (library.dimensions.length) dimCount.value = library.dimensions.length
  if (library.total) moduleCount.value = library.total
}

function handleLibraryChanged(): void {
  library.scheduleFetch()
}

watch(() => library.total, () => { syncCountsFromLibrary() })
watch(() => library.dimensions.length, () => { syncCountsFromLibrary() })

function toggleLibrary(): void {
  showLibraryDialog.value = !showLibraryDialog.value
}
function toggleSegmentImport(): void {
  showSegmentImport.value = !showSegmentImport.value
}
async function refreshStats(): Promise<void> {
  try {
    await library.fetchAll()
    syncCountsFromLibrary()
    await batchFactoryRef.value?.refresh()
  } catch { /* ignore */ }
}

// Layout refs for sash drag
const layoutRef = ref<HTMLElement | null>(null)
const dragging = ref<'left' | 'right' | null>(null)
let startX = 0
let startLeft = 0
let startCenter = 0
let pendingDelta = 0
let rafId: number | null = null

const leftPct = computed(() => `${(leftFrac.value * 100).toFixed(4)}%`)
const centerPct = computed(() => `${(centerFrac.value * 100).toFixed(4)}%`)

function onSashPointerDown(e: PointerEvent, which: 'left' | 'right'): void {
  dragging.value = which
  startX = e.clientX
  startLeft = leftFrac.value
  startCenter = centerFrac.value
  pendingDelta = 0
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
}

function onPointerMove(e: PointerEvent): void {
  pendingDelta = e.clientX - startX
  if (rafId != null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    const container = layoutRef.value
    if (!container) return
    const w = container.getBoundingClientRect().width
    if (w < 10) return
    const deltaFrac = pendingDelta / w
    if (dragging.value === 'left') {
      setFracs(startLeft + deltaFrac, startCenter)
    } else if (dragging.value === 'right') {
      setFracs(startLeft, startCenter + deltaFrac)
    }
  })
}

function onPointerUp(e: PointerEvent): void {
  try { (e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId) } catch { /* ignore */ }
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  if (rafId != null) { cancelAnimationFrame(rafId); rafId = null }
  dragging.value = null
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}

onMounted(async () => {
  try {
    const { persistGeometry } = await import('@/composables/usePersist')
    persistGeometry()
  } catch { /* ignore */ }

  onEvent(LIBRARY_CHANGED, handleLibraryChanged)

  try {
    await dbRegistry.fetchActiveInfo()
    await dbRegistry.fetchList()
    if (!dbRegistry.activeInfo?.foreground) {
      dbRegistry.onboardingOpen = true
      return
    }
  } catch {
    dbRegistry.onboardingOpen = true
    return
  }

  try {
    // need06: library 是维度面板与随机侧的唯一数据源
    await library.fetchAll()
    syncCountsFromLibrary()
    try {
      const carry = await dbGetTempCarry()
      if (carry && carry.selectedItemIds?.length) {
        const grouped = library.modulesByDim as Record<string, { id: string; dimensionId?: string }[]>
        const idToModule = new Map<string, { id: string; dimensionId?: string }>()
        for (const arr of Object.values(grouped)) for (const m of arr) idToModule.set(m.id, m)
        const items = carry.selectedItemIds.map((id) => {
          const mod = idToModule.get(id)
          if (!mod) return null
          const w = carry.weightDraft?.[id] ?? null
          return { module: mod, locked: false, weightOverride: w }
        }).filter(Boolean) as typeof assembly.selectedItems
        if (items.length) assembly.setSelected(items)
      }
    } catch { /* ignore carry */ }
  } catch { /* ignore */ }
  try { await historyStore.fetchAll() } catch { /* ignore */ }
})

onBeforeUnmount(() => {
  offEvent(LIBRARY_CHANGED, handleLibraryChanged)
  library.dispose()
})
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-background text-foreground">
    <div
      ref="layoutRef"
      data-testid="main-layout"
      class="flex min-h-0 flex-1 overflow-hidden"
      :style="{ contain: 'layout paint' }"
    >
      <section
        data-testid="panel-left"
        class="flex min-h-0 shrink-0 flex-col overflow-hidden border-r bg-card"
        :style="{ width: leftPct }"
      >
        <DimensionPanel ref="dimensionPanelRef" />
      </section>

      <div
        data-testid="sash-left"
        class="flex w-2 shrink-0 items-center justify-center bg-border hover:bg-primary/20 cursor-col-resize select-none"
        :class="dragging === 'left' ? 'bg-primary/30' : ''"
        title="拖拽调整 左右比例"
        @pointerdown="onSashPointerDown($event, 'left')"
      >
        <div class="h-8 w-0.5 rounded bg-muted-foreground/30" />
      </div>

      <section
        data-testid="panel-center"
        class="flex min-h-0 shrink-0 flex-col overflow-hidden bg-background"
        :style="{ width: centerPct }"
      >
         <!-- F3 §4 + need01 需求4：中间栏 Tabs（prompt-batch | image-queue | single），头高约 32px -->
         <div class="flex h-8 shrink-0 items-center gap-1 border-b px-2">
           <button
             data-testid="center-tab-prompt"
             class="h-6 rounded px-2 text-xs"
             :class="centerTab === 'prompt' ? 'bg-accent font-semibold' : 'text-muted-foreground'"
             @click="centerTab = 'prompt'"
           >
             Prompt 批量
           </button>
           <button
             data-testid="center-tab-image"
             class="h-6 rounded px-2 text-xs"
             :class="centerTab === 'image' ? 'bg-accent font-semibold' : 'text-muted-foreground'"
             @click="centerTab = 'image'"
           >
             生图队列
           </button>
           <button
             data-testid="center-tab-single"
             class="h-6 rounded px-2 text-xs"
             :class="centerTab === 'single' ? 'bg-accent font-semibold' : 'text-muted-foreground'"
             @click="centerTab = 'single'"
           >
             手动单发
           </button>
         </div>
         <div v-show="centerTab === 'prompt'" class="flex min-h-0 flex-1 flex-col overflow-hidden">
           <BatchFactory ref="batchFactoryRef" @switch-to-image="centerTab = 'image'" />
         </div>
         <!-- 生图面板按需挂载：默认停留在 prompt，不预 mount，首屏更快；切 Tab 时 initQueue 回填 -->
         <div v-if="centerTab === 'image'" class="flex min-h-0 flex-1 flex-col overflow-hidden">
           <ImageQueuePanel @switch-to-prompt="centerTab = 'prompt'" />
         </div>
         <!-- 需求4 单发面板按需挂载：内存预览不进 Pinia，切 Tab 未保存即丢弃 -->
         <div v-if="centerTab === 'single'" class="flex min-h-0 flex-1 flex-col overflow-hidden">
           <SingleShotPanel />
         </div>
      </section>

      <div
        data-testid="sash-right"
        class="flex w-2 shrink-0 items-center justify-center bg-border hover:bg-primary/20 cursor-col-resize select-none"
        :class="dragging === 'right' ? 'bg-primary/30' : ''"
        title="拖拽调整 中/右比例"
        @pointerdown="onSashPointerDown($event, 'right')"
      >
        <div class="h-8 w-0.5 rounded bg-muted-foreground/30" />
      </div>

      <section
        data-testid="panel-right"
        class="flex min-h-0 flex-1 flex-col overflow-hidden bg-card"
      >
        <HistoryPanel />
      </section>
    </div>

    <StatusBar :dim-count="dimCount" :module-count="moduleCount" @toggle-library="toggleLibrary" @toggle-segment-import="toggleSegmentImport" @toggle-db-manager="showDbManager = true" />

    <BusinessDbOnboardingDialog :open="dbRegistry.onboardingOpen" @update:open="dbRegistry.onboardingOpen = $event" />
    <DbManagerDrawer :open="showDbManager" @update:open="showDbManager = $event" />

    <LibraryDialog
      v-if="showLibraryDialog"
      @close="showLibraryDialog = false"
      @imported="refreshStats"
    />

    <SegmentImportDialog
      v-if="showSegmentImport"
      :open="showSegmentImport"
      @update:open="showSegmentImport = $event"
      @imported="refreshStats"
    />

    <div data-testid="toasts" class="pointer-events-none fixed bottom-10 right-4 z-50 flex flex-col gap-2">
      <div
        v-for="t in appToasts.slice(-5)"
        :key="t.id"
        :data-testid="`toast-${t.id}`"
        class="pointer-events-auto rounded-md border bg-card px-3 py-2 text-sm shadow-lg"
        :class="t.type === 'success' ? 'border-green-500/30 bg-green-50 dark:bg-green-950' : t.type === 'warning' ? 'border-amber-500/30 bg-amber-50 dark:bg-amber-950' : t.type === 'error' ? 'border-red-500/30 bg-red-50 dark:bg-red-950' : ''"
      >
        {{ t.message }}
      </div>
    </div>

     <!-- 生图任务详情顶层 Dialog（need06）：Teleport 到 body，免虚拟化 transform 裁剪 -->
     <ImageTaskDetailDialog />
     <!-- need01 需求3：报表浮层（运行条 + StatusBar 双入口共用同一 Dialog） -->
     <StatsReportDialog />
   </div>
</template>
