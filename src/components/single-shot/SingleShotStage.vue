<script setup lang="ts">
import { ref } from 'vue'
import { useImageZoomPan } from '@/composables/useImageZoomPan'

const props = defineProps<{
  previewUrl: string
  hasPreview: boolean
  generating: boolean
  lastError: string | null
  failedAt: string | null
  saved: { filename: string; filePath: string } | null
  elapsedMs: number
  keyMissing: boolean
}>()

const emit = defineEmits<{
  (e: 'retry'): void
  (e: 'open-original'): void
  (e: 'locate'): void
  (e: 'copy-filename'): void
  (e: 'goto-model'): void
}>()

const stageRef = ref<HTMLElement | null>(null)
const zoom = useImageZoomPan(stageRef)

defineExpose({ zoom })
</script>

<template>
  <div
    ref="stageRef"
    data-testid="single-shot-stage"
    class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-background"
    :class="hasPreview ? (zoom.dragging.value ? 'cursor-grabbing' : 'cursor-grab') : ''"
    style="touch-action: none; user-select: none"
    @wheel="zoom.onWheel"
    @pointerdown="zoom.onPointerDown"
    @pointermove="zoom.onPointerMove"
    @pointerup="zoom.onPointerUp"
    @pointercancel="zoom.onPointerUp"
    @dblclick="zoom.onDblClick"
  >
    <!-- 缩放工具条 -->
    <div
      v-if="hasPreview"
      class="absolute right-2 top-2 z-10 flex items-center gap-1 rounded border bg-card/95 px-1.5 py-1 text-xs shadow-sm"
    >
      <el-button data-testid="single-shot-zoom-fit" text size="small" @click="zoom.fit()">适应</el-button>
      <el-button data-testid="single-shot-zoom-actual" text size="small" @click="zoom.actualSize()">1:1</el-button>
      <el-button data-testid="single-shot-zoom-out" text size="small" @click="zoom.zoomOut()">−</el-button>
      <span data-testid="single-shot-zoom-label" class="min-w-11 text-center tabular-nums text-muted-foreground">
        {{ zoom.percentLabel.value }}
      </span>
      <el-button data-testid="single-shot-zoom-in" text size="small" @click="zoom.zoomIn()">+</el-button>
      <el-button data-testid="single-shot-zoom-reset" text size="small" @click="zoom.reset()">重置</el-button>
      <el-button data-testid="single-shot-open-original" text size="small" @click="emit('open-original')">原图</el-button>
    </div>

    <!-- 图片：以容器中心为原点，transform 缩放平移 -->
    <img
      v-if="hasPreview"
      data-testid="single-shot-preview"
      :src="props.previewUrl"
      alt="单发预览"
      decoding="async"
      class="max-h-full max-w-full select-none"
      :style="{
        transform: `translate3d(${zoom.transform.value.x}px, ${zoom.transform.value.y}px, 0) scale(${zoom.transform.value.scale})`,
        transformOrigin: 'center center',
        willChange: 'transform',
      }"
      draggable="false"
      @load="zoom.onImageLoad($event.target as HTMLImageElement)"
    />

    <!-- 加载态：生成中骨架 + 禁生成（防 base64 堆积） -->
    <div
      v-else-if="generating"
      data-testid="single-shot-loading"
      class="flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground"
    >
      <div class="h-24 w-24 animate-pulse rounded bg-muted" />
      <div>生成中…（请勿重复点击）</div>
    </div>

    <!-- 失败态：存 lastError + 失败时间，展示重试 -->
    <div
      v-else-if="lastError"
      data-testid="single-shot-error"
      class="flex max-w-sm flex-col items-center justify-center gap-2 p-6 text-center text-xs"
    >
      <div class="text-red-600">单发失败{{ failedAt ? `（${failedAt}）` : '' }}：{{ lastError }}</div>
      <el-button data-testid="single-shot-retry" type="primary" size="small" :disabled="generating" @click="emit('retry')">
        重试
      </el-button>
    </div>

    <!-- 空态 -->
    <el-empty
      v-else
      data-testid="single-shot-empty"
      description="暂无预览 — 填写 prompt 后点「生成」"
      :image-size="48"
    >
      <template #default>
        <div class="text-[11px]">生成后：鼠标滚轮缩放 · 左键拖拽移动 · 双击复位</div>
        <div v-if="keyMissing" class="text-[11px] text-amber-600">
          未检测到 API 密钥 — 去右上「模型配置」设置
          <el-button data-testid="iq-goto-model" text size="small" @click="emit('goto-model')">去模型配置</el-button>
        </div>
      </template>
    </el-empty>

    <!-- 已保存信息 -->
    <div
      v-if="saved"
      data-testid="single-shot-saved"
      class="absolute bottom-2 left-2 z-10 max-w-[70%] rounded border bg-card/95 p-2 font-mono text-[11px] shadow-sm"
    >
      <div class="mb-1 flex items-center gap-2 text-muted-foreground">
        <span>已落盘</span>
        <span>{{ elapsedMs / 1000 }}s 生成</span>
      </div>
      <div data-testid="single-shot-filename" class="break-all">{{ saved.filename }}</div>
      <div class="mt-1 flex gap-2">
        <el-button data-testid="single-shot-locate" text size="small" @click="emit('locate')">定位文件</el-button>
        <el-button data-testid="single-shot-copy" text size="small" @click="emit('copy-filename')">复制文件名</el-button>
      </div>
    </div>
  </div>
</template>