<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import DimensionPanel from '@/components/DimensionPanel.vue'
import BatchFactory from '@/components/BatchFactory.vue'
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
        <BatchFactory ref="batchFactoryRef" />
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
  </div>
</template>
