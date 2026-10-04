 <script setup lang="ts">
 import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
 import { Button } from '@/components/ui/button'
 import { useToast } from '@/composables/useToast'
 import { useImageQueueStore } from '@/stores/imageQueue'
 import { useConnectionProfileStore } from '@/stores/connectionProfile'
 import { isConnectionReady } from '@/lib/connectionProfile'
 import { dbRevealInExplorer } from '@/lib/db'
 import { iqGetResolvedOutputDir } from '@/lib/imageQueueApi'
 import { iqGenerateOnePreview, iqSavePreview } from '@/lib/statsApi'
 import { IQ_SIZES, IQ_RATIOS } from '@/lib/imageQueue'
 import { useImageZoomPan } from '@/composables/useImageZoomPan'
 
 const iq = useImageQueueStore()
 const conn = useConnectionProfileStore()
 const { push } = useToast()

const DRAFT_KEY = 'singleShotDraft'
/** 上下分栏比例持久化（与主三栏 useSash 的 pmf:sash 相互独立） */
const VSPLIT_KEY = 'pmf:single-shot-vsplit'
const VSPLIT_DEFAULT = 0.4
const VSPLIT_MIN = 0.15
const VSPLIT_MAX = 0.7

const prompt = ref('')
const size = ref('1K')
const ratio = ref('1:1')
const outputDir = ref('')
const outputPlaceholder = ref('')
 const generating = ref(false)
 const saving = ref(false)
 const preview = ref<{ b64: string; mime: string; elapsedMs: number } | null>(null)
 const saved = ref<{ filename: string; filePath: string } | null>(null)
 // need01-02A: 失败态（重试入口）+ 密钥缺失引导
 const lastError = ref<string | null>(null)
 const failedAt = ref<string | null>(null)
 
 const previewUrl = computed(() =>
   preview.value ? `data:${preview.value.mime};base64,${preview.value.b64}` : '',
 )
 const canGenerate = computed(() => !generating.value && prompt.value.trim().length > 0)
 const canSave = computed(() => !saving.value && !generating.value && preview.value != null)
 const promptOverlong = computed(() => prompt.value.trim().length > 4000)
 /** 连接就绪：连接域或队列域任一就绪即放行（过渡期双写，兼容旧单测直设 iq）。 */
 const keyMissing = computed(() => {
   const connReady = isConnectionReady(conn.profile)
   const iqReady = iq.config.apiKeyState === 'set' || Boolean(iq.config.apiKey)
   return !(connReady || iqReady)
 })

/* ---------------- 上下分栏（可拖动分隔条） ---------------- */

const panelRef = ref<HTMLElement | null>(null)
const topFrac = ref(VSPLIT_DEFAULT)
const sashActive = ref(false)

const topPct = computed(() => `${(topFrac.value * 100).toFixed(4)}%`)

function loadVSplit(): void {
  try {
    const raw = localStorage.getItem(VSPLIT_KEY)
    if (raw) {
      const v = Number.parseFloat(raw)
      if (Number.isFinite(v) && v >= VSPLIT_MIN && v <= VSPLIT_MAX) {
        topFrac.value = v
        return
      }
    }
  } catch { /* ignore */ }
  topFrac.value = VSPLIT_DEFAULT
}

watch(topFrac, () => {
  try { localStorage.setItem(VSPLIT_KEY, String(topFrac.value)) } catch { /* ignore */ }
})

let sashPointerId: number | null = null
let sashStartY = 0
let sashStartFrac = 0
let sashPending = 0
let sashRafId: number | null = null

function onSashPointerDown(e: PointerEvent): void {
  sashPointerId = e.pointerId
  sashStartY = e.clientY
  sashStartFrac = topFrac.value
  sashPending = 0
  sashActive.value = true
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
    const next = Math.min(VSPLIT_MAX, Math.max(VSPLIT_MIN, sashStartFrac + deltaFrac))
    topFrac.value = next
  })
}

function onSashPointerUp(e: PointerEvent): void {
  if (sashPointerId !== null && e.pointerId !== sashPointerId) return
  sashPointerId = null
  window.removeEventListener('pointermove', onSashPointerMove)
  window.removeEventListener('pointerup', onSashPointerUp)
  if (sashRafId != null) { cancelAnimationFrame(sashRafId); sashRafId = null }
  sashActive.value = false
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}

/** 双击手柄恢复默认比例 */
function onSashDblClick(): void {
  topFrac.value = VSPLIT_DEFAULT
}

/* ---------------- 图片缩放 / 拖拽 ---------------- */

const stageRef = ref<HTMLElement | null>(null)
const zoom = useImageZoomPan(stageRef)

/* ---------------- 生成 / 保存 / 重来 ---------------- */

function persistDraft(): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ prompt: prompt.value, size: size.value, ratio: ratio.value }))
  } catch { /* ignore */ }
}

function restoreDraft(): void {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return
    const d = JSON.parse(raw) as { prompt?: string; size?: string; ratio?: string }
    if (typeof d.prompt === 'string') prompt.value = d.prompt
    if (typeof d.size === 'string' && (IQ_SIZES as readonly string[]).includes(d.size)) size.value = d.size
    if (typeof d.ratio === 'string' && (IQ_RATIOS as readonly string[]).includes(d.ratio)) ratio.value = d.ratio
  } catch { /* ignore */ }
}

watch([prompt, size, ratio], () => persistDraft())

 async function onGenerate(): Promise<void> {
   const p = prompt.value.trim()
   if (!p) {
     push('prompt 不能为空', 'warning')
     return
   }
   if (p.length > 4000) {
     push('prompt 超 4000 字符已截断', 'warning')
   }
   if (keyMissing.value) {
     push('未设置 API 密钥', 'warning')
     return
   }
   if (generating.value) return
   generating.value = true
   lastError.value = null
   saved.value = null
   try {
     const r = await iqGenerateOnePreview(p.slice(0, 4000), size.value, ratio.value)
     // need01-02A3 单实例：先释放旧 base64 再赋值，避免两份大图并存
     releasePreview(true)
     preview.value = { b64: r.imageBase64, mime: r.mime, elapsedMs: r.elapsedMs }
     // 超限提醒（b64 > 25MB 仍可看但建议先保存）
     try {
       if (r.imageBase64.length > 25 * 1024 * 1024) {
         push('预览较大（>25MB），建议先保存再继续生成', 'warning')
       }
     } catch { /* ignore */ }
     // 新图：回到适应窗口
     zoom.reset()
     zoom.fit()
     push(`单发预览已生成（${(r.elapsedMs / 1000).toFixed(1)}s，未落盘）`, 'success', 2000)
   } catch (err) {
     const msg = err instanceof Error ? err.message : String(err)
     lastError.value = msg
     try { failedAt.value = new Date().toLocaleTimeString() } catch { failedAt.value = '' }
     push(`单发失败：${msg}`, 'error')
   } finally {
     generating.value = false
   }
 }
 
 /** 失败重试：清错后重调 onGenerate（沿用截断后 prompt + size/ratio）。 */
 async function onRetry(): Promise<void> {
   if (generating.value) return
   lastError.value = null
   await onGenerate()
 }
 
 /**
  * need01-02A3 大图内存释放：置空 + zoom.reset()，onReset/切 Tab/卸载统一走此。
  * silent=true 时新生成前释放不 toast。
  */
 function releasePreview(silent = false): void {
   preview.value = null
   try { zoom.reset() } catch { /* ignore */ }
   if (!silent) {
     saved.value = null
   }
 }
 
 async function onSave(): Promise<void> {
   if (!preview.value) {
     push('先生成预览再保存', 'warning')
     return
   }
   if (saving.value) return
   saving.value = true
   try {
     const r = await iqSavePreview(
       preview.value.b64,
       prompt.value.trim().slice(0, 4000),
       size.value,
       ratio.value,
       outputDir.value.trim() || undefined,
     )
     saved.value = r
     push(`已落盘 ${r.filename}（已计入统计）`, 'success', 2500)
   } catch (err) {
     push(`保存失败：${err instanceof Error ? err.message : String(err)}`, 'error')
   } finally {
     saving.value = false
   }
 }
 
 function onReset(): void {
   // 重来：丢弃内存预览（不落盘），保留 prompt 草稿
   releasePreview()
   saved.value = null
   lastError.value = null
   push('已重来（预览已丢弃）', 'info', 1200)
 }

async function onBrowseDir(): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ directory: true, multiple: false, title: '选择保存目录' })
    const dir = Array.isArray(picked) ? (picked[0] ?? null) : picked
    if (typeof dir === 'string' && dir) outputDir.value = dir
  } catch (err) {
    push(`选择目录失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}

async function onOpenOriginal(): Promise<void> {
  if (!previewUrl.value) return
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(previewUrl.value)
  } catch (err) {
    push(`打开原图失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}

async function onCopyPrompt(): Promise<void> {
  const text = prompt.value.trim()
  if (!text) {
    push('暂无可复制的 prompt', 'warning')
    return
  }
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
  push('已复制 prompt', 'success', 1200)
}

async function onLocate(): Promise<void> {
  if (!saved.value) return
  try {
    await dbRevealInExplorer(saved.value.filePath)
  } catch (err) {
    push(`定位失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}

async function onCopyFilename(): Promise<void> {
  if (!saved.value) return
  try {
    await navigator.clipboard.writeText(saved.value.filename)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = saved.value.filename
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  push('已复制文件名', 'success', 1200)
}

 onMounted(async () => {
   restoreDraft()
   loadVSplit()
   if (!size.value) size.value = iq.config.size || '1K'
   if (!ratio.value) ratio.value = iq.config.ratio || '1:1'
   // need01-02B：直进单发即加载连接，不再依赖队列面板 onMounted
   if (!conn.loaded) {
     try { await conn.loadConnection() } catch { /* 降级：回落 iq */ }
   }
   try {
     outputPlaceholder.value = await iqGetResolvedOutputDir()
   } catch { /* ignore */ }
 })
 
 onBeforeUnmount(() => {
   // 未保存切 Tab/关闭：内存丢弃（base64 不持久化），prompt 草稿已留 localStorage
   releasePreview()
   window.removeEventListener('pointermove', onSashPointerMove)
   window.removeEventListener('pointerup', onSashPointerUp)
   if (sashRafId != null) { cancelAnimationFrame(sashRafId); sashRafId = null }
   document.body.style.userSelect = ''
   document.body.style.cursor = ''
 })
</script>

<template>
  <section
    ref="panelRef"
    data-testid="single-shot-panel"
    class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
  >
    <!-- ============ 上栏：参数配置 ============ -->
    <div
      data-testid="single-shot-config"
      class="flex shrink-0 flex-col gap-2 overflow-auto border-b bg-card p-3"
      :style="{ height: topPct }"
    >
      <div class="flex items-center gap-2">
        <h3 class="text-xs font-semibold">手动单发</h3>
        <span class="text-[11px] text-muted-foreground">生成只预览不落盘，点保存才落盘计入统计</span>
      </div>

      <label class="flex min-h-0 flex-1 flex-col gap-1 text-xs">
        <span class="text-muted-foreground">prompt（必填，≤4000字）</span>
        <textarea
          v-model="prompt"
          data-testid="single-shot-prompt"
          placeholder="描述想要的画面…"
          class="min-h-16 w-full flex-1 resize-none rounded border bg-background p-2 font-mono text-xs outline-none focus:border-primary"
        />
        <span
          class="self-end text-[11px]"
          :class="promptOverlong ? 'text-warning' : 'text-muted-foreground'"
        >{{ prompt.trim().length }}/4000</span>
      </label>

      <div class="flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-1 text-xs">
          <span class="text-muted-foreground">尺寸</span>
          <select v-model="size" data-testid="single-shot-size" class="h-7 rounded border bg-background px-2 text-xs">
            <option v-for="s in IQ_SIZES" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <label class="flex items-center gap-1 text-xs">
          <span class="text-muted-foreground">比例</span>
          <select v-model="ratio" data-testid="single-shot-ratio" class="h-7 rounded border bg-background px-2 text-xs">
            <option v-for="r in IQ_RATIOS" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label class="flex min-w-0 flex-1 items-center gap-1 text-xs">
          <span class="shrink-0 text-muted-foreground">保存路径</span>
          <input
            v-model="outputDir"
            data-testid="single-shot-output"
            :placeholder="outputPlaceholder || '留空=队列默认 outputDir'"
            class="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs outline-none focus:border-primary"
          />
          <Button
            data-testid="single-shot-output-browse"
            size="sm"
            variant="outline"
            class="h-7 shrink-0 text-xs"
            @click="onBrowseDir"
          >浏览…</Button>
        </label>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Button data-testid="single-shot-generate" size="sm" class="h-7 text-xs" :disabled="!canGenerate" @click="onGenerate">
          {{ generating ? '生成中…' : '生成' }}
        </Button>
        <Button data-testid="single-shot-save" size="sm" variant="outline" class="h-7 text-xs" :disabled="!canSave" @click="onSave">
          {{ saving ? '保存中…' : '保存' }}
        </Button>
        <Button data-testid="single-shot-reset" size="sm" variant="ghost" class="h-7 text-xs" @click="onReset">重来</Button>
        <Button data-testid="single-shot-prompt-copy" size="sm" variant="ghost" class="h-7 text-xs" @click="onCopyPrompt">复制 prompt</Button>
        <span class="ml-auto text-[11px] text-muted-foreground">单发不占用队列并发、不触发备料/熔断；队列运行时可并行单发。</span>
      </div>
    </div>

    <!-- ============ 分隔条：上下栏比例可拖动 ============ -->
    <div
      data-testid="single-shot-sash"
      class="group h-1.5 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-primary/50"
      :class="sashActive ? 'bg-primary' : ''"
      title="拖动调整上下比例，双击恢复默认"
      @pointerdown="onSashPointerDown"
      @dblclick="onSashDblClick"
    />

    <!-- ============ 下栏：图片工作区（占据全部剩余空间） ============ -->
    <div
      ref="stageRef"
      data-testid="single-shot-stage"
      class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-background"
      :class="preview ? (zoom.dragging.value ? 'cursor-grabbing' : 'cursor-grab') : ''"
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
        v-if="preview"
        class="absolute right-2 top-2 z-10 flex items-center gap-1 rounded border bg-card/95 px-1.5 py-1 text-xs shadow-sm"
      >
        <button data-testid="single-shot-zoom-fit" class="rounded px-1.5 py-0.5 hover:bg-accent" title="适应窗口" @click="zoom.fit()">适应</button>
        <button data-testid="single-shot-zoom-actual" class="rounded px-1.5 py-0.5 hover:bg-accent" title="原始尺寸 100%" @click="zoom.actualSize()">1:1</button>
        <button data-testid="single-shot-zoom-out" class="rounded px-1.5 py-0.5 hover:bg-accent" title="缩小" @click="zoom.zoomOut()">−</button>
        <span data-testid="single-shot-zoom-label" class="min-w-11 text-center tabular-nums text-muted-foreground">{{ zoom.percentLabel.value }}</span>
        <button data-testid="single-shot-zoom-in" class="rounded px-1.5 py-0.5 hover:bg-accent" title="放大" @click="zoom.zoomIn()">+</button>
        <button data-testid="single-shot-zoom-reset" class="rounded px-1.5 py-0.5 hover:bg-accent" title="重置缩放与位置" @click="zoom.reset()">重置</button>
        <button data-testid="single-shot-open-original" class="rounded px-1.5 py-0.5 hover:bg-accent" title="打开原图" @click="onOpenOriginal">原图</button>
      </div>

       <!-- 图片：以容器中心为原点，transform 缩放平移 -->
       <img
         v-if="preview"
         data-testid="single-shot-preview"
         :src="previewUrl"
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
         <Button data-testid="single-shot-retry" size="sm" class="h-7 text-xs" :disabled="generating" @click="onRetry">重试</Button>
       </div>
 
       <!-- 空态 -->
       <div
         v-else
         data-testid="single-shot-empty"
         class="flex flex-col items-center justify-center gap-1 p-6 text-center text-xs text-muted-foreground"
       >
         <div>暂无预览 — 填写 prompt 后点「生成」</div>
         <div class="text-[11px]">生成后：鼠标滚轮缩放 · 左键拖拽移动 · 双击复位</div>
         <div v-if="keyMissing" class="text-[11px] text-amber-600">未检测到 API 密钥 — 先到生图队列保存密钥/或新连接配置页设置</div>
       </div>

      <!-- 已保存信息 -->
      <div
        v-if="saved"
        data-testid="single-shot-saved"
        class="absolute bottom-2 left-2 z-10 max-w-[70%] rounded border bg-card/95 p-2 font-mono text-[11px] shadow-sm"
      >
        <div class="mb-1 flex items-center gap-2 text-muted-foreground">
          <span>已落盘</span>
          <span>{{ (preview?.elapsedMs ?? 0) / 1000 }}s 生成</span>
        </div>
        <div data-testid="single-shot-filename" class="break-all">{{ saved.filename }}</div>
        <div class="mt-1 flex gap-2">
          <button data-testid="single-shot-locate" class="text-primary" @click="onLocate">定位文件</button>
          <button data-testid="single-shot-copy" class="text-primary" @click="onCopyFilename">复制文件名</button>
        </div>
      </div>
    </div>
  </section>
</template>
