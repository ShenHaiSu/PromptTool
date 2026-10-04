<script setup lang="ts">
import { ref, computed, watch } from 'vue'
// 仅按需引入具体模块：禁止从 'element-plus' 根barrel 导入（会把全量 EP 打进产物）
import { ElMessageBox } from 'element-plus/es/components/message-box/index.mjs'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import DimensionPanel from '@/components/DimensionPanel.vue'
import BatchFactory from '@/components/BatchFactory.vue'
import ImageQueuePanel from '@/components/ImageQueuePanel.vue'
import SingleShotPanel from '@/components/SingleShotPanel.vue'
import ModelConfigPanel from '@/components/ModelConfigPanel.vue'
import { useConnectionProfileStore } from '@/stores/connectionProfile'
import ImageMetaPanel from '@/components/ImageMetaPanel.vue'
import StatsReportDialog from '@/components/StatsReportDialog.vue'
import HistoryDrawer from '@/components/HistoryDrawer.vue'
import StatusBar from '@/components/StatusBar.vue'
import LibraryDialog from '@/components/LibraryDialog.vue'
import SegmentImportDialog from '@/components/SegmentImportDialog.vue'
import { useAssemblyStore } from '@/stores/assembly'
import { useHistoryStore } from '@/stores/history'
import { useSash } from '@/composables/useSash'
import { notify } from '@/lib/notify'
import { useShortcuts } from '@/composables/useShortcuts'
import { useThemeStore } from '@/stores/theme'
import { logger } from '@/lib/logger'
import BusinessDbOnboardingDialog from '@/components/BusinessDbOnboardingDialog.vue'
import DbManagerDrawer from '@/components/DbManagerDrawer.vue'
import ImageTaskDetailDialog from '@/components/ImageTaskDetailDialog.vue'
import { useDbRegistryStore } from '@/stores/dbRegistry'
import { useLibraryStore } from '@/stores/library'
import { useAppBootstrap } from '@/composables/useAppBootstrap'

const assembly = useAssemblyStore()
const historyStore = useHistoryStore()
const dbRegistry = useDbRegistryStore()
const themeStore = useThemeStore()
const library = useLibraryStore()
void themeStore.mode
const { leftFrac, setLeftFrac } = useSash()
const push = notify
const { dimCount, moduleCount, syncCountsFromLibrary } = useAppBootstrap()

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
  } catch (err) {
    logger.warn('App', 'clipboard降级', err)
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

const historyDrawerOpen = ref(false)
function toggleHistoryDrawer(): void {
  historyDrawerOpen.value = !historyDrawerOpen.value
}

useShortcuts({
  focusSearch,
  save: doSaveShortcut,
  copy: doCopyShortcut,
  remove: doRemoveShortcut,
  toggleHistory: toggleHistoryDrawer,
})

const showDbManager = ref(false)
const showLibraryDialog = ref(false)
const showSegmentImport = ref(false)
const dimensionPanelRef = ref<{ refresh: () => Promise<void> } | null>(null)
const batchFactoryRef = ref<{ refresh: () => Promise<void> } | null>(null)
const centerTab = ref<'prompt' | 'image' | 'single' | 'meta' | 'model'>('prompt')
const connProfile = useConnectionProfileStore()
const modelPanelRef = ref<{ isDirty?: () => boolean } | null>(null)
const modelKeyDot = computed(() => (connProfile.profile.apiKeyState === 'set' ? '●' : '○'))

async function switchCenterTab(next: 'prompt' | 'image' | 'single' | 'meta' | 'model'): Promise<void> {
  if (centerTab.value === 'model' && next !== 'model') {
    try {
      if (modelPanelRef.value?.isDirty?.()) {
        try {
          await ElMessageBox.confirm('模型配置未保存，确定切换？', '未保存', { type: 'warning' })
        } catch {
          const ok = window.confirm('模型配置未保存，确定切换？')
          if (!ok) return
          return
        }
        centerTab.value = next
        return
      }
    } catch (err) {
      logger.warn('App', 'switchCenterTab守卫', err)
    }
  }
  centerTab.value = next
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
  } catch (err) {
    logger.warn('App', 'refreshStats', err)
  }
}

const layoutRef = ref<HTMLElement | null>(null)
const dragging = ref<'left' | null>(null)
let startX = 0
let startLeft = 0
let pendingDelta = 0
let rafId: number | null = null

const leftPct = computed(() => `${(leftFrac.value * 100).toFixed(4)}%`)

function onSashPointerDown(e: PointerEvent): void {
  dragging.value = 'left'
  startX = e.clientX
  startLeft = leftFrac.value
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
      setLeftFrac(startLeft + deltaFrac)
    }
  })
}

function onPointerUp(e: PointerEvent): void {
  try { (e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId) } catch (err) { logger.warn('App', 'releasePointer', err) }
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  if (rafId != null) { cancelAnimationFrame(rafId); rafId = null }
  dragging.value = null
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}
</script>

<template>
  <el-config-provider :locale="zhCn">
    <div class="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div
        ref="layoutRef"
        data-testid="main-layout"
        class="relative flex min-h-0 flex-1 overflow-hidden"
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
          @pointerdown="onSashPointerDown($event)"
        >
          <div class="h-8 w-0.5 rounded bg-muted-foreground/30" />
        </div>

        <section
          data-testid="panel-center"
          class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
        >
           <!-- 左 pl-3：对冲 EP 首 Tab padding-left:0；右 pr-14：给 history-fab 让位 -->
           <el-tabs v-model="centerTab" class="min-h-0 flex-1 flex-col [&_.el-tabs__header]:pl-3 [&_.el-tabs__header]:pr-14" @tab-change="switchCenterTab($event as typeof centerTab)">
            <el-tab-pane name="prompt" :lazy="false">
              <template #label><span data-testid="center-tab-prompt" @click.stop="switchCenterTab('prompt')">Prompt 批量</span></template>
              <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
                <BatchFactory ref="batchFactoryRef" @switch-to-image="switchCenterTab('image')" />
              </div>
            </el-tab-pane>
            <el-tab-pane name="image" :lazy="false">
              <template #label><span data-testid="center-tab-image" @click.stop="switchCenterTab('image')">生图队列</span></template>
              <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
                <ImageQueuePanel @switch-to-prompt="switchCenterTab('prompt')" @switch-to-model="switchCenterTab('model')" />
              </div>
            </el-tab-pane>
            <el-tab-pane name="single" :lazy="false">
              <template #label><span data-testid="center-tab-single" @click.stop="switchCenterTab('single')">手动单发</span></template>
              <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
                <SingleShotPanel @switch-to-model="switchCenterTab('model')" />
              </div>
            </el-tab-pane>
            <el-tab-pane name="meta" :lazy="false">
              <template #label><span data-testid="center-tab-meta" @click.stop="switchCenterTab('meta')">图片解析</span></template>
              <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
                <ImageMetaPanel />
              </div>
            </el-tab-pane>
            <el-tab-pane name="model" :lazy="false">
              <template #label><span data-testid="center-tab-model" @click.stop="switchCenterTab('model')">模型配置{{ modelKeyDot }}{{ connProfile.profile.apiKeyState === 'set' ? '已设' : '未设' }}</span></template>
              <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
                <ModelConfigPanel ref="modelPanelRef" />
              </div>
            </el-tab-pane>
          </el-tabs>
        </section>

        <!-- 右上角浮动按钮：收纳右栏（历史/收藏/模板） -->
        <button
          data-testid="history-fab"
          type="button"
          class="absolute right-4 top-3 z-30 inline-flex h-9 w-9 items-center justify-center rounded-full border bg-card text-foreground shadow-md transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="历史 / 收藏 / 模板（Ctrl+H）"
          aria-label="打开历史记录面板"
          @click="toggleHistoryDrawer"
        >
          🕘
          <span
            v-if="historyStore.recent.length > 0"
            data-testid="history-fab-badge"
            class="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-primary px-1 text-[10px] leading-[18px] text-primary-foreground"
          >{{ historyStore.recent.length > 99 ? '99+' : historyStore.recent.length }}</span>
        </button>
      </div>

      <StatusBar :dim-count="dimCount" :module-count="moduleCount" @toggle-library="toggleLibrary" @toggle-segment-import="toggleSegmentImport" @toggle-db-manager="showDbManager = true" />
      <HistoryDrawer v-model:open="historyDrawerOpen" />

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

      <ImageTaskDetailDialog />
      <StatsReportDialog />
    </div>
  </el-config-provider>
</template>
