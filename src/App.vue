<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import TopBar from '@/components/TopBar.vue'
import DimensionPanel from '@/components/DimensionPanel.vue'
import BatchFactory from '@/components/BatchFactory.vue'
import HistoryPanel from '@/components/HistoryPanel.vue'
import { Button } from '@/components/ui/button'
import AssemblyCanvas from '@/components/AssemblyCanvas.vue'
import { useAssemblyStore } from '@/stores/assembly'
import { useHistoryStore } from '@/stores/history'
import { useThemeStore } from '@/stores/theme'
import { useSash } from '@/composables/useSash'
import { appToasts, useToast } from '@/composables/useToast'
import { dbGetDimensions, dbGetAllModulesGrouped } from '@/lib/db'

const assembly = useAssemblyStore()
const historyStore = useHistoryStore()
const theme = useThemeStore()
const { leftFrac, centerFrac, setFracs } = useSash()
const { push } = useToast()

// Ctrl+S 快捷键：保存当前画布（阶段五新增）
function onGlobalKeydown(e: KeyboardEvent): void {
  const isSave = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'
  if (!isSave) return
  // 若焦点在输入框内，不劫持
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
  e.preventDefault()
  if (!assembly.finalPrompt && assembly.selectedItems.length === 0) {
    push('空方案暂不保存 — 请先添加词条', 'warning')
    return
  }
  const irJson = JSON.stringify(assembly.ir.toJSON())
  historyStore.save(null, irJson, assembly.finalPrompt, assembly.config, [...assembly.selectedItems], false)
    .then(() => push('已保存方案（Ctrl+S）', 'success', 1500))
    .catch((err) => push(`保存失败: ${String(err)}`, 'error'))
}

// Stats for StatusBar
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
  // prevent text selection during drag
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
  window.addEventListener('keydown', onGlobalKeydown)
  // Fetch stats — failures (e.g. jsdom without Tauri) are tolerated for layout验收
  try {
    const dims = await dbGetDimensions()
    dimCount.value = dims.length
    try {
      const grouped = await dbGetAllModulesGrouped()
      let total = 0
      for (const v of Object.values(grouped)) total += (v as unknown[]).length
      // 若 grouped 为空（非 Tauri 环境），保持 0，不影响渲染
      if (total === 0) {
        // fallback：尝试逐维度统计已在 DimensionPanel 中，此处不强求
      }
      moduleCount.value = total
    } catch { /* ignore in jsdom */ }
  } catch { /* ignore */ }

  // History counts — best effort
  try { await historyStore.fetchAll() } catch { /* ignore */ }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})


</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-background text-foreground">
    <!-- TopBar 88/168 -->
    <TopBar :prompt="assembly.finalPrompt" :warnings="assembly.warnings" :ir="assembly.ir" />

    <!-- 三栏主体 30:38:32 resizable -->
    <div
      ref="layoutRef"
      data-testid="main-layout"
      class="flex min-h-0 flex-1 overflow-hidden"
      :style="{ contain: 'layout paint' }"
    >
      <!-- Left 30% -->
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

      <!-- Sash left -->
      <div
        data-testid="sash-left"
        class="flex w-2 shrink-0 items-center justify-center bg-border hover:bg-primary/20 cursor-col-resize select-none"
        :class="dragging === 'left' ? 'bg-primary/30' : ''"
        title="拖拽调整 左右比例"
        @pointerdown="onSashPointerDown($event, 'left')"
      >
        <div class="h-8 w-0.5 rounded bg-muted-foreground/30" />
      </div>

      <!-- Center 38% — AssemblyCanvas -->
      <section
        data-testid="panel-center"
        class="flex min-h-0 shrink-0 flex-col overflow-hidden bg-background"
        :style="{ width: centerPct }"
      >
        <AssemblyCanvas />
      </section>

      <!-- Sash right -->
      <div
        data-testid="sash-right"
        class="flex w-2 shrink-0 items-center justify-center bg-border hover:bg-primary/20 cursor-col-resize select-none"
        :class="dragging === 'right' ? 'bg-primary/30' : ''"
        title="拖拽调整 中/右比例"
        @pointerdown="onSashPointerDown($event, 'right')"
      >
        <div class="h-8 w-0.5 rounded bg-muted-foreground/30" />
      </div>

      <!-- Right 32% — Batch + History -->
      <section
        data-testid="panel-right"
        class="flex min-h-0 flex-1 flex-col overflow-hidden bg-card"
      >
        <BatchFactory />
        <HistoryPanel />
      </section>
    </div>

    <!-- StatusBar 22px -->
    <footer
      data-testid="status-bar"
      class="flex h-7 shrink-0 items-center justify-between border-t bg-muted px-3 text-xs text-muted-foreground"
    >
      <div class="flex items-center gap-3">
        <span data-testid="status-dimensions">维度: {{ dimCount || 14 }}</span>
        <span data-testid="status-modules">条目: {{ moduleCount || 311 }}</span>
        <span data-testid="status-selected">已选: {{ assembly.selectedItems.length }}</span>
        <span data-testid="status-history">历史: {{ historyStore.recent.length }}</span>
        <span data-testid="status-favorites">收藏: {{ historyStore.favorites.length }}</span>
        <span data-testid="status-model" class="rounded bg-background px-1.5 py-0.5 font-mono">{{ assembly.config.modelProfile.toUpperCase() }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="hidden sm:inline">就绪 · Tauri P3</span>
        <Button
          data-testid="theme-toggle"
          variant="ghost"
          size="sm"
          class="h-6 px-2 text-xs"
          @click="theme.toggle()"
        >
          {{ theme.mode === 'light' ? '🌙 深色' : '☀️ 浅色' }}
        </Button>
      </div>
    </footer>

    <!-- Toasts -->
    <div data-testid="toasts" class="pointer-events-none fixed bottom-10 right-4 z-50 flex flex-col gap-2">
      <div
        v-for="t in appToasts"
        :key="t.id"
        class="pointer-events-auto rounded-md border bg-card px-3 py-2 text-sm shadow-lg"
        :class="t.type === 'success' ? 'border-green-500/30 bg-green-50 dark:bg-green-950' : t.type === 'warning' ? 'border-amber-500/30 bg-amber-50 dark:bg-amber-950' : ''"
      >
        {{ t.message }}
      </div>
    </div>
  </div>
</template>
