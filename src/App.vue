<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import TopBar from '@/components/TopBar.vue'
import DimensionPanel from '@/components/DimensionPanel.vue'
import BatchFactory from '@/components/BatchFactory.vue'
import HistoryPanel from '@/components/HistoryPanel.vue'
import StatusBar from '@/components/StatusBar.vue'
import AssemblyCanvas from '@/components/AssemblyCanvas.vue'
import { useAssemblyStore } from '@/stores/assembly'
import { useHistoryStore } from '@/stores/history'
import { useSash } from '@/composables/useSash'
import { appToasts, useToast } from '@/composables/useToast'
import { useShortcuts } from '@/composables/useShortcuts'
import { useThemeStore } from '@/stores/theme'
import { dbGetDimensions, dbGetAllModulesGrouped } from '@/lib/db'

const assembly = useAssemblyStore()
const historyStore = useHistoryStore()
const themeStore = useThemeStore()
void themeStore.mode // 触发 theme 初始化副作用（已在 store 构造时 applyTheme）
const { leftFrac, centerFrac, setFracs } = useSash()
const { push } = useToast()

// ------------------------------------------------------------------
// 快捷键：Ctrl+F 聚焦搜索 / Ctrl+S 保存 / Ctrl+C 复制 / Delete 删除末项
// ------------------------------------------------------------------
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

// Stats for StatusBar — best effort, jsdom 无 Tauri 时回退 14/311
const dimCount = ref(0)
const moduleCount = ref(0)

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
  // 持久化几何：768p 溢出保护 + localStorage 双写（Rust save_window_state 可选）
  try {
    const { persistGeometry } = await import('@/composables/usePersist')
    persistGeometry()
  } catch { /* ignore */ }

  try {
    const dims = await dbGetDimensions()
    dimCount.value = dims.length
    try {
      const grouped = await dbGetAllModulesGrouped()
      let total = 0
      for (const v of Object.values(grouped)) total += (v as unknown[]).length
      moduleCount.value = total
    } catch { /* ignore in jsdom */ }
  } catch { /* ignore */ }
  try { await historyStore.fetchAll() } catch { /* ignore */ }
})

onBeforeUnmount(() => {
  // beforeunload 已由 usePersist 托管
})
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-background text-foreground">
    <TopBar :prompt="assembly.finalPrompt" :warnings="assembly.warnings" :ir="assembly.ir" />

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
        <div class="flex h-9 shrink-0 items-center justify-between border-b px-3">
          <h2 class="text-sm font-semibold">维度面板</h2>
          <span class="text-xs text-muted-foreground">Tree + 搜索 + NSFW</span>
        </div>
        <DimensionPanel />
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
        <AssemblyCanvas />
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
        <BatchFactory />
        <HistoryPanel />
      </section>
    </div>

    <StatusBar :dim-count="dimCount" :module-count="moduleCount" />

    <!-- Toast 队列：最多 5 条并发，溢出丢弃最旧 -->
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
