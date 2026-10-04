<script setup lang="ts">
/**
 * need03 S4：ImageQueueSettings 的循环/随机/内嵌开关组（自 408 行主文件抽出，
 * 保证单文件 ≤400 行；testid 原样透传）。
 */
const props = defineProps<{
  loopEnabled: boolean
  autoRandomOnStart: boolean
  loopUsePartial: boolean
  loopAllowNsfw: boolean
  embedMeta: boolean
  anchorCount: number
}>()

const emit = defineEmits<{
  (e: 'update:loopEnabled', v: boolean): void
  (e: 'update:autoRandomOnStart', v: boolean): void
  (e: 'update:loopUsePartial', v: boolean): void
  (e: 'update:loopAllowNsfw', v: boolean): void
  (e: 'update:embedMeta', v: boolean): void
}>()
</script>

<template>
  <div class="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
    <label class="flex min-w-0 items-center gap-1.5" title="队列见底自动补货">
      <input
        data-testid="iq-loop"
        type="checkbox"
        class="h-3.5 w-3.5 shrink-0 accent-primary"
        :checked="props.loopEnabled"
        @change="emit('update:loopEnabled', ($event.target as HTMLInputElement).checked)"
      />
      <span class="truncate">循环生成</span>
    </label>
    <label class="flex min-w-0 items-center gap-1.5" title="开始前备料（数量取并发数）">
      <input
        data-testid="iq-auto-random-on-start"
        type="checkbox"
        class="h-3.5 w-3.5 shrink-0 accent-primary"
        :checked="props.autoRandomOnStart"
        @change="emit('update:autoRandomOnStart', ($event.target as HTMLInputElement).checked)"
      />
      <span class="truncate">自动备料</span>
    </label>
    <div class="col-span-2 text-[11px] text-muted-foreground">运行中每次起生成自动补足到并发量（关即仅饿死补货）</div>
    <label
      class="flex min-w-0 items-center gap-1.5"
      title="以画布已选项为锚点，仅随机缺口维度；画布为空时按纯随机降级"
    >
      <input
        data-testid="iq-loop-partial"
        type="checkbox"
        class="h-3.5 w-3.5 shrink-0 accent-primary"
        :checked="props.loopUsePartial"
        @change="emit('update:loopUsePartial', ($event.target as HTMLInputElement).checked)"
      />
      <span class="truncate">可控随机</span>
    </label>
    <label class="flex min-w-0 items-center gap-1.5" title="队列随机是否包含 NSFW 条目">
      <input
        data-testid="iq-loop-nsfw"
        type="checkbox"
        class="h-3.5 w-3.5 shrink-0 accent-primary"
        :checked="props.loopAllowNsfw"
        @change="emit('update:loopAllowNsfw', ($event.target as HTMLInputElement).checked)"
      />
      <span class="truncate">含NSFW</span>
    </label>
    <div v-if="props.loopUsePartial && props.anchorCount === 0" class="col-span-2 text-[11px] text-amber-600">
      可控已开但画布为空，将按纯随机补货
    </div>
    <label class="col-span-2 flex min-w-0 items-center gap-1.5" title="关即纯原图">
      <input
        data-testid="iq-embed-meta"
        type="checkbox"
        class="h-3.5 w-3.5 shrink-0 accent-primary"
        :checked="props.embedMeta"
        @change="emit('update:embedMeta', ($event.target as HTMLInputElement).checked)"
      />
      <span class="truncate">图片内嵌参数<span class="text-muted-foreground">（关即纯原图）</span></span>
    </label>
  </div>
</template>