<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useImageMeta } from '@/composables/useImageMeta'
import { useToast } from '@/composables/useToast'
import { useImageQueueStore } from '@/stores/imageQueue'
import { dbRevealInExplorer } from '@/lib/db'
import { IQ_RATIOS, IQ_SIZES } from '@/lib/imageQueue'
import { groupMeta, buildCopyText } from '@/lib/imageMeta'

const im = useImageMeta()
const { push } = useToast()

const grouped = computed(() => groupMeta(im.meta.value))

const fileInput = ref<HTMLInputElement | null>(null)
const showIrHash = ref(false)
const reusing = ref(false)

async function onPickClick(): Promise<void> {
  try {
    await im.pickFile()
  } catch (err) {
    // Web / plugin 缺失：降级走隐藏 file input
    const msg = String(err)
    if (/Cannot find module|Failed to fetch|plugin-dialog|open is not/i.test(msg)) {
      fileInput.value?.click()
      return
    }
    // 用户取消（null）不提示；其余报错提示
    if (!/cancel/i.test(msg)) push(`选择文件失败：${msg}`, 'error')
    // dialog open 在取消时直接 return（无抛），此处仅兜底
    try {
      fileInput.value?.click()
    } catch { /* ignore */ }
  }
}

function onFileInputChange(e: Event): void {
  const input = e.target as HTMLInputElement
  const files = input.files
  input.value = ''
  if (!files || !files.length) return
  void im.handleDrop(files)
}

function onDragOver(e: DragEvent): void {
  e.preventDefault()
  im.isDragging.value = true
}

function onDragLeave(e: DragEvent): void {
  e.preventDefault()
  im.isDragging.value = false
}

async function onDrop(e: DragEvent): Promise<void> {
  e.preventDefault()
  im.isDragging.value = false
  const files = e.dataTransfer?.files
  if (files && files.length) {
    await im.handleDrop(files)
  }
}

let unlistenTauriDrop: (() => void) | null = null

onMounted(async () => {
  // Tauri WebView 拖入拿绝对路径（HTML5 File 拿不到路径，需事件链路）
  try {
    const mod = (await import('@tauri-apps/api/webview')) as unknown as {
      getCurrentWebview?: () => { onDragDropEvent: (cb: (e: { payload: { type: string; paths?: string[] } }) => void) => Promise<() => void> }
    }
    const view = mod.getCurrentWebview?.()
    if (view) {
      unlistenTauriDrop = await view.onDragDropEvent((event) => {
        const t = event.payload?.type
        if (t === 'enter' || t === 'over') im.isDragging.value = true
        else if (t === 'leave') im.isDragging.value = false
        else if (t === 'drop') {
          im.isDragging.value = false
          const paths = event.payload?.paths ?? []
          if (paths.length) void im.handleDrop(paths)
        }
      })
    }
  } catch { /* 非 Tauri / 旧版本：仅 HTML5 链路 */ }
})

onBeforeUnmount(() => {
  try {
    unlistenTauriDrop?.()
  } catch { /* ignore */ }
  unlistenTauriDrop = null
})

async function copyText(text: string, okMsg: string): Promise<void> {
  if (!text.trim()) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  push(okMsg, 'success', 1200)
}

function onCopyPrompt(): void {
  const t = buildCopyText(im.meta.value)
  if (!t) return
  void copyText(t, '已复制 prompt')
}

async function onReuse(): Promise<void> {
  const m = im.meta.value
  if (!m || reusing.value) return
  const prompt = (m.prompt ?? '').trim()
  if (!prompt) {
    push('内嵌 prompt 为空，无法复用', 'warning')
    return
  }
  const iq = useImageQueueStore()
  let size = iq.config.size
  let ratio = iq.config.ratio
  if ((IQ_SIZES as readonly string[]).includes(m.size)) size = m.size
  if ((IQ_RATIOS as readonly string[]).includes(m.ratio)) ratio = m.ratio
  if (size !== m.size || ratio !== m.ratio) {
    push('内嵌 size/ratio 已失效，已用当前配置入队', 'warning')
  }
  reusing.value = true
  try {
    const { enqueued } = await iq.enqueueBatch([{ prompt, irHash: m.irHash ?? null, size, ratio }])
    if (enqueued > 0) push(`已复用参数入队（${size} ${ratio}），可开始生图`, 'success', 2000)
  } finally {
    reusing.value = false
  }
}

async function onReveal(): Promise<void> {
  const p = im.filePath.value
  if (!p) return
  try {
    await dbRevealInExplorer(p)
  } catch (err) {
    try {
      const mod: unknown = await import('@tauri-apps/plugin-opener')
      const fn = (mod as { openPath?: (x: string) => Promise<void>; open?: (x: string) => Promise<void> }).openPath
        ?? (mod as { open?: (x: string) => Promise<void> }).open
      if (typeof fn === 'function') await (fn as (x: string) => Promise<void>)(p)
      else throw new Error('opener unavailable')
    } catch {
      push(`定位失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }
}
</script>

<template>
  <section data-testid="image-meta-panel" class="flex min-h-0 flex-1 flex-col overflow-auto p-3">
    <!-- DropZone：点击选择 + 拖入 -->
    <div
      data-testid="meta-dropzone"
      role="button"
      tabindex="0"
      class="flex shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-4 text-center text-sm"
      :class="im.isDragging.value ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 text-muted-foreground'"
      @click="onPickClick"
      @keydown.enter="onPickClick"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div class="text-sm font-medium text-foreground">点击选择 / 把图片拖进来</div>
      <div class="text-xs text-muted-foreground">支持 png / jpg（含自家内嵌参数解析），单文件</div>
      <div v-if="im.fileName.value" class="max-w-full truncate font-mono text-xs text-foreground">
        {{ im.fileName.value }}
      </div>
    </div>
    <input
      ref="fileInput"
      data-testid="meta-file-input"
      type="file"
      accept=".png,.jpg,.jpeg"
      class="hidden"
      @change="onFileInputChange"
    />

    <!-- 空态 -->
    <div v-if="im.status.value === 'idle'" data-testid="meta-empty" class="mt-4 flex flex-col items-center gap-2 rounded-lg border p-8 text-center">
      <div class="text-3xl">🖼️</div>
      <div class="text-sm font-medium">尚未选择图片</div>
      <div class="text-xs text-muted-foreground">点上方虚线框选择，或从文件管理器拖一张本机生成的图进来</div>
      <Button size="sm" variant="outline" class="h-7 text-xs" @click="onPickClick">选择图片</Button>
    </div>

    <div v-else-if="im.status.value === 'reading'" class="mt-4 rounded-lg border p-6 text-center text-xs text-muted-foreground">
      读取解析中…
    </div>

    <!-- 无内嵌 -->
    <div v-else-if="im.status.value === 'empty'" data-testid="meta-none" class="mt-3 flex flex-col gap-3">
      <div class="rounded border border-amber-500/30 bg-amber-50 px-2 py-1 text-xs text-amber-700">
        {{ im.webNotice.value || '该图无内嵌生图参数（外部图或未嵌入）' }}
      </div>
      <div class="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" class="h-7 text-xs" @click="onPickClick">重新选择</Button>
        <Button size="sm" variant="ghost" class="h-7 text-xs" data-testid="meta-reset" @click="im.reset()">清空</Button>
        <Button v-if="im.filePath.value" size="sm" variant="outline" class="h-7 text-xs" data-testid="meta-reveal" @click="onReveal">在文件管理器中定位</Button>
      </div>
    </div>

    <!-- 错误态 -->
    <div v-else-if="im.status.value === 'error'" data-testid="meta-error" class="mt-4 rounded-lg border border-red-500/40 bg-red-50 p-4 dark:bg-red-950">
      <div class="text-sm font-medium text-red-700 dark:text-red-300">解析失败</div>
      <div class="mt-1 break-all text-xs text-red-600 dark:text-red-400">{{ im.errorMsg.value || '未知错误' }}</div>
      <div class="mt-3 flex gap-2">
        <Button size="sm" variant="outline" class="h-7 text-xs" data-testid="meta-retry" @click="im.filePath.value ? im.read(im.filePath.value) : onPickClick()">重试</Button>
        <Button size="sm" variant="ghost" class="h-7 text-xs" data-testid="meta-reset" @click="im.reset()">清空</Button>
      </div>
    </div>

    <!-- 成功态：元数据卡片 -->
    <div v-else-if="im.status.value === 'done' && im.meta.value" class="mt-3 flex max-w-2xl flex-col gap-2">
      <Card class="p-3">
        <div class="flex items-center gap-2">
          <span data-testid="meta-model" class="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{{ grouped.model }}</span>
          <span class="text-xs text-muted-foreground">{{ grouped.size }} · {{ grouped.ratio }}</span>
        </div>
        <dl class="mt-2 flex flex-col gap-1 text-xs">
          <div class="flex gap-2">
            <dt class="w-16 shrink-0 text-muted-foreground">生成时间</dt>
            <dd data-testid="meta-created-at" class="min-w-0 flex-1 break-all">{{ grouped.createdAtText }}</dd>
          </div>
          <div class="flex gap-2">
            <dt class="w-16 shrink-0 text-muted-foreground">耗时</dt>
            <dd class="min-w-0 flex-1 break-all">{{ grouped.elapsedText }}</dd>
          </div>
          <div class="flex gap-2">
            <dt class="w-16 shrink-0 text-muted-foreground">任务ID</dt>
            <dd class="flex min-w-0 flex-1 items-center gap-1">
              <span class="min-w-0 flex-1 truncate font-mono">{{ grouped.taskId }}</span>
              <button v-if="grouped.taskId !== '—'" class="shrink-0 text-primary" @click="copyText(im.meta.value?.taskId ?? '', '已复制任务ID')">复制</button>
            </dd>
          </div>
          <div class="flex gap-2">
            <dt class="w-16 shrink-0 text-muted-foreground">图片来源</dt>
            <dd class="flex min-w-0 flex-1 items-center gap-1">
              <span class="min-w-0 flex-1 truncate font-mono" :title="im.meta.value?.imageUrl ?? ''">{{ grouped.imageUrl }}</span>
              <button v-if="grouped.imageUrl !== '—'" class="shrink-0 text-primary" @click="copyText(im.meta.value?.imageUrl ?? '', '已复制图片来源')">复制</button>
            </dd>
          </div>
          <div class="flex gap-2">
            <dt class="w-16 shrink-0 text-muted-foreground">irHash</dt>
            <dd class="min-w-0 flex-1">
              <button class="font-mono text-primary" @click="showIrHash = !showIrHash">{{ showIrHash ? '收起' : '展开' }}</button>
              <span v-if="showIrHash" class="mt-1 block break-all font-mono">{{ grouped.irHash }}</span>
            </dd>
          </div>
        </dl>
        <div class="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" class="h-7 text-xs" data-testid="meta-reveal" @click="onReveal">定位文件</Button>
          <Button size="sm" variant="ghost" class="h-7 text-xs" data-testid="meta-reset" @click="im.reset()">清空</Button>
        </div>
      </Card>
      <Card class="p-3">
        <div class="flex items-center gap-2">
          <h5 class="text-xs font-semibold">提示词</h5>
          <span class="text-[11px] text-muted-foreground">{{ grouped.promptLength }} 字</span>
          <div class="ml-auto flex gap-1">
            <Button size="sm" variant="outline" class="h-6 text-[11px]" data-testid="meta-copy-prompt" :disabled="!grouped.hasPrompt" @click="onCopyPrompt">复制prompt</Button>
            <Button size="sm" class="h-6 text-[11px]" data-testid="meta-reuse" :disabled="!grouped.hasPrompt || reusing" @click="onReuse">{{ reusing ? '入队中…' : '复用参数下单' }}</Button>
          </div>
        </div>
        <p data-testid="meta-prompt" class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border p-2 font-mono text-xs">{{ im.meta.value?.prompt }}</p>
      </Card>
    </div>
  </section>
</template>
