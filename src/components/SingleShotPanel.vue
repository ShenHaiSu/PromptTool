<script setup lang="ts">
import { ref, onBeforeUnmount, watch, nextTick } from 'vue'
import SingleShotConfig from '@/components/single-shot/SingleShotConfig.vue'
import SingleShotStage from '@/components/single-shot/SingleShotStage.vue'
import { useSingleShot } from '@/composables/useSingleShot'

const emit = defineEmits<{ (e: 'switch-to-model'): void }>()

const s = useSingleShot(emit)

/* ---------------- 上下分栏分隔条拖拽（比例持久化在 composable） ---------------- */
const panelRef = ref<HTMLElement | null>(null)
const stageRef = ref<InstanceType<typeof SingleShotStage> | null>(null)

watch(
  () => stageRef.value?.zoom,
  (z) => {
    if (z) s.bindZoom(z)
  },
  { immediate: true },
)

const VSPLIT_DEFAULT = 0.4
const VSPLIT_MIN = 0.15
const VSPLIT_MAX = 0.7

let sashPointerId: number | null = null
let sashStartY = 0
let sashStartFrac = 0
let sashPending = 0
let sashRafId: number | null = null

function onSashPointerDown(e: PointerEvent): void {
  sashPointerId = e.pointerId
  sashStartY = e.clientY
  sashStartFrac = s.topFrac.value
  sashPending = 0
  s.sashActive.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onSashPointerMove)
  window.addEventListener('pointerup', onSashPointerUp)
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'row-resize'
}

function onSashPointerMove(e: PointerEvent): void {
  sashPending = e.clientY - sashStartY
  if (sashRafId != null) return
  sashRafId = requestAnimationFrame(() => {
    sashRafId = null
    const host = panelRef.value
    if (!host) return
    const h = host.getBoundingClientRect().height
    if (h < 10) return
    const deltaFrac = sashPending / h
    s.topFrac.value = Math.min(VSPLIT_MAX, Math.max(VSPLIT_MIN, sashStartFrac + deltaFrac))
  })
}

function onSashPointerUp(e: PointerEvent): void {
  if (sashPointerId !== null && e.pointerId !== sashPointerId) return
  sashPointerId = null
  window.removeEventListener('pointermove', onSashPointerMove)
  window.removeEventListener('pointerup', onSashPointerUp)
  if (sashRafId != null) {
    cancelAnimationFrame(sashRafId)
    sashRafId = null
  }
  s.sashActive.value = false
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}

/** 双击手柄恢复默认比例 */
function onSashDblClick(): void {
  s.topFrac.value = VSPLIT_DEFAULT
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onSashPointerMove)
  window.removeEventListener('pointerup', onSashPointerUp)
  if (sashRafId != null) {
    cancelAnimationFrame(sashRafId)
    sashRafId = null
  }
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
})

/** 新图生成后回到默认视图（与旧实现 zoom.reset() 语义一致）。 */
watch(
  () => s.preview.value,
  () => {
    void nextTick(() => s.zoomReset())
  },
)
</script>

<template>
  <section
    ref="panelRef"
    data-testid="single-shot-panel"
    class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
  >
    <!-- ============ 上栏：参数配置 ============ -->
    <SingleShotConfig
      :style="{ height: s.topPct.value }"
      :prompt="s.prompt.value"
      :size="s.size.value"
      :ratio="s.ratio.value"
      :output-dir="s.outputDir.value"
      :output-placeholder="s.outputPlaceholder.value"
      :generating="s.generating.value"
      :saving="s.saving.value"
      :can-generate="s.canGenerate.value"
      :can-save="s.canSave.value"
      :prompt-overlong="s.promptOverlong.value"
      :prompt-length="s.prompt.value.trim().length"
      @update:prompt="s.prompt.value = $event"
      @update:size="s.size.value = $event"
      @update:ratio="s.ratio.value = $event"
      @update:outputDir="s.outputDir.value = $event"
      @browse="s.onBrowseDir()"
      @generate="s.onGenerate()"
      @save="s.onSave()"
      @reset="s.onReset()"
      @copy-prompt="s.onCopyPrompt()"
    />

    <!-- ============ 分隔条：上下栏比例可拖动 ============ -->
    <div
      data-testid="single-shot-sash"
      class="group h-1.5 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-primary/50"
      :class="s.sashActive.value ? 'bg-primary' : ''"
      title="拖动调整上下比例，双击恢复默认"
      @pointerdown="onSashPointerDown"
      @dblclick="onSashDblClick"
    />

    <!-- ============ 下栏：图片工作区（占据全部剩余空间） ============ -->
    <SingleShotStage
      ref="stageRef"
      :preview-url="s.previewUrl.value"
      :has-preview="s.preview.value != null"
      :generating="s.generating.value"
      :last-error="s.lastError.value"
      :failed-at="s.failedAt.value"
      :saved="s.saved.value"
      :elapsed-ms="s.preview.value?.elapsedMs ?? 0"
      :key-missing="s.keyMissing.value"
      @retry="s.onRetry()"
      @open-original="s.onOpenOriginal()"
      @locate="s.onLocate()"
      @copy-filename="s.onCopyFilename()"
      @goto-model="s.gotoModel()"
    />
  </section>
</template>