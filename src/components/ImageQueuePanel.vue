<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { useToast } from '@/composables/useToast'
import { dbRevealInExplorer } from '@/lib/db'
import { iqOpenOutputDir } from '@/lib/imageQueueApi'
import { useImageQueueStore } from '@/stores/imageQueue'
import { refillFromEngine, cancelRefill, resetRefillCancel, prepareStartQueue } from '@/lib/imageLoop'
import { useVirtualizer } from '@tanstack/vue-virtual'
import ImageTaskCard from '@/components/ImageTaskCard.vue'
import ImageQueueSettings from '@/components/ImageQueueSettings.vue'

const emit = defineEmits<{ (e: 'switch-to-prompt'): void }>()

const iq = useImageQueueStore()
const { push } = useToast()

 const running = computed(() => iq.isRunning())
 const showSettings = ref(false)
 const statsText = computed(
   () => `成功 ${iq.stats.succeeded} · 失败 ${iq.stats.failed} · 排队 ${iq.stats.queued} · 运行 ${iq.stats.running}/并发${iq.config.concurrency}`,
 )
 const keyMissing = computed(() => iq.config.apiKeyState === 'unset' && !iq.config.apiKey)
 const keyDot = computed(() => (iq.config.apiKeyState === 'set' || iq.config.apiKey ? '●' : '○'))
 const keyDotClass = computed(() => (iq.config.apiKeyState === 'set' || iq.config.apiKey ? 'text-green-600' : 'text-amber-600'))
 const configSummary = computed(() => `${iq.config.size}·${iq.config.ratio}·并发${iq.config.concurrency}`)

 function requestCloseSettings(): void {
   if (iq.dirty && !window.confirm('配置未保存，确定关闭？')) return
   showSettings.value = false
 }

 function onSettingsKeydown(e: KeyboardEvent): void {
   if (e.key === 'Escape') requestCloseSettings()
 }

 watch(showSettings, (open) => {
   if (open) window.addEventListener('keydown', onSettingsKeydown)
   else window.removeEventListener('keydown', onSettingsKeydown)
 })

async function onStart(): Promise<void> {
  const prep = await prepareStartQueue()
  if (prep.kind === 'blocked') return
  await iq.start()
}

async function onStop(): Promise<void> {
  cancelRefill()
  await iq.stop()
}

async function onEnqueueCurrent(): Promise<void> {
  await iq.enqueueCurrentResults()
}

async function onClearFinished(): Promise<void> {
  await iq.clearFinished()
}

async function onOpenOutput(): Promise<void> {
  try {
    if (!iq.config.outputDir.trim()) {
      // need07：空配置走后端解析+保活+打开，不再透传 <data_dir> 占位符
      const dir = await iqOpenOutputDir()
      push(`已打开 ${dir}`, 'success', 1500)
    } else {
      await dbRevealInExplorer(iq.config.outputDir.trim())
    }
  } catch (err) {
    push(`打开失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}

function onGotoPrompt(): void {
  emit('switch-to-prompt')
}

// 虚拟化（参数与 BatchFactory 一致：estimateSize 110 / overscan 5 / measureElement）
const parentRef = ref<HTMLElement | null>(null)
const totalCount = computed(() => iq.order.length)
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
  if (el instanceof HTMLElement) virtualizer.value.measureElement(el as never)
}
watch(totalCount, async () => {
  await nextTick()
})

onMounted(async () => {
  resetRefillCancel()
  // hungry → F3 补货（store 只 emit，本处订阅后调引擎，保持依赖单向）
  iq.onHungry((want) => {
    void refillFromEngine(want)
  })
  try {
    await iq.loadConfig()
  } catch { /* 降级：缓存/默认 */ }
  await iq.initQueue()
})

 onBeforeUnmount(() => {
   window.removeEventListener('keydown', onSettingsKeydown)
   cancelRefill()
   iq.disposeQueue()
 })
</script>

<template>
  <section data-testid="image-queue" class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <!-- 运行条 -->
    <div data-testid="iq-runbar" class="relative flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
      <Button
        data-testid="iq-start"
        size="sm"
        class="h-7 text-xs"
        :disabled="running"
        @click="onStart"
        >{{ iq.order.length > 0 && iq.stats.stopped ? '继续' : '开始' }}</Button
      >
      <Button
        data-testid="iq-stop"
        size="sm"
        variant="outline"
        class="h-7 text-xs"
        :disabled="!running"
        @click="onStop"
        >停止</Button
      >
      <Button
        data-testid="iq-enqueue-current"
        size="sm"
        variant="outline"
        class="h-7 text-xs"
        @click="onEnqueueCurrent"
        >入队当前结果</Button
      >
      <span data-testid="iq-stats" class="text-[11px] text-muted-foreground">{{ statsText }}</span>
      <span v-if="iq.stats.consecFail > 0" data-testid="iq-consec" class="text-[11px] text-red-600">
        连续失败 {{ iq.stats.consecFail }}/5
      </span>
      <span v-if="!iq.stats.stopped && iq.stats.consecFail >= 5" class="text-[11px] text-red-600">熔断停止</span>
       <button
         class="ml-auto flex items-center gap-1.5 text-[11px]"
         :title="`当前配置：${configSummary}，点击展开配置`"
         @click="showSettings = !showSettings"
       >
         <span :class="keyDotClass" title="API 密钥状态">{{ keyDot }}</span>
         <span class="rounded border bg-muted/50 px-1.5 py-px text-muted-foreground">{{ configSummary }}</span>
         <span class="text-primary">{{ showSettings ? '收起配置' : '展开配置' }}</span>
       </button>
       <!-- 配置浮层：右对齐窄卡，不再全宽压住任务流 -->
       <div
         v-if="showSettings"
         class="absolute right-0 top-full z-20 max-h-[70vh] w-[min(640px,94%)] overflow-auto rounded-xl border bg-background shadow-xl"
       >
         <ImageQueueSettings />
       </div>
     </div>
     <div v-if="showSettings" class="fixed inset-0 z-10" @click="requestCloseSettings"></div>

    <div v-if="keyMissing" class="mx-3 mb-1 rounded border border-amber-500/30 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
      未设置 API 密钥
      <button class="ml-1 text-primary" @click="showSettings = true">去配置</button>
    </div>
    <div v-if="iq.degraded" class="mx-3 mb-1 rounded border border-amber-500/30 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
      事件通道不可用，已降级轮询
    </div>

    <!-- 任务流 -->
    <div
      v-if="iq.order.length === 0"
      data-testid="iq-empty"
      class="flex h-[160px] shrink-0 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground"
    >
      <span>暂无生图任务 — 先配好密钥，再从批量工厂入队</span>
      <Button size="sm" variant="outline" class="h-7 text-xs" @click="onGotoPrompt">去批量工厂随机</Button>
    </div>
    <div v-else ref="parentRef" data-testid="iq-virtual-scroll" class="min-h-0 flex-1 overflow-auto border-t">
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
          <ImageTaskCard :model="iq.tasks.get(iq.order[v.index]!)!" />
        </div>
      </div>
    </div>

    <!-- 底部栏 -->
    <div class="flex shrink-0 items-center gap-2 border-t px-3 py-2">
      <Button data-testid="iq-clear-finished" size="sm" variant="ghost" class="h-7 text-xs" @click="onClearFinished">
        清空已完成
      </Button>
      <Button data-testid="iq-open-output" size="sm" variant="outline" class="h-7 text-xs" @click="onOpenOutput">
        打开输出目录
      </Button>
    </div>
  </section>
</template>
