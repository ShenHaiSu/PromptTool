<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { useToast } from '@/composables/useToast'
import { useImageQueueStore } from '@/stores/imageQueue'
import { dbRevealInExplorer } from '@/lib/db'
import { iqGetResolvedOutputDir } from '@/lib/imageQueueApi'
import { iqGenerateOnePreview, iqSavePreview } from '@/lib/statsApi'
import { IQ_SIZES, IQ_RATIOS } from '@/lib/imageQueue'

const iq = useImageQueueStore()
const { push } = useToast()

const DRAFT_KEY = 'singleShotDraft'

const prompt = ref('')
const size = ref('1K')
const ratio = ref('1:1')
const outputDir = ref('')
const outputPlaceholder = ref('')
const generating = ref(false)
const saving = ref(false)
const preview = ref<{ b64: string; mime: string; elapsedMs: number } | null>(null)
const saved = ref<{ filename: string; filePath: string } | null>(null)

const previewUrl = computed(() =>
  preview.value ? `data:${preview.value.mime};base64,${preview.value.b64}` : '',
)
const canGenerate = computed(() => !generating.value && prompt.value.trim().length > 0)
const canSave = computed(() => !saving.value && !generating.value && preview.value != null)

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
  if (iq.config.apiKeyState === 'unset' && !iq.config.apiKey) {
    push('未设置 API 密钥', 'warning')
    return
  }
  if (generating.value) return
  generating.value = true
  saved.value = null
  try {
    const r = await iqGenerateOnePreview(p.slice(0, 4000), size.value, ratio.value)
    preview.value = { b64: r.imageBase64, mime: r.mime, elapsedMs: r.elapsedMs }
    push(`单发预览已生成（${(r.elapsedMs / 1000).toFixed(1)}s，未落盘）`, 'success', 2000)
  } catch (err) {
    push(`单发失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  } finally {
    generating.value = false
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
  preview.value = null
  saved.value = null
  push('已重来（预览已丢弃）', 'info', 1200)
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
  if (!size.value) size.value = iq.config.size || '1K'
  if (!ratio.value) ratio.value = iq.config.ratio || '1:1'
  try {
    outputPlaceholder.value = await iqGetResolvedOutputDir()
  } catch { /* ignore */ }
})

onBeforeUnmount(() => {
  // 未保存切 Tab/关闭：内存丢弃（base64 不持久化），prompt 草稿已留 localStorage
  preview.value = null
})
</script>

<template>
  <section data-testid="single-shot-panel" class="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
    <div class="grid gap-3 md:grid-cols-2">
      <div class="flex flex-col gap-2 rounded border bg-card p-3">
        <h3 class="text-xs font-semibold">手动单发</h3>
        <label class="flex flex-col gap-1 text-xs">
          <span class="text-muted-foreground">prompt（必填，≤4000字）</span>
          <textarea
            v-model="prompt"
            data-testid="single-shot-prompt"
            rows="6"
            placeholder="描述想要的画面…（生成只预览不落盘，点保存才落盘计入统计）"
            class="min-h-24 rounded border bg-background p-2 font-mono text-xs outline-none focus:border-primary"
          />
          <span class="text-[11px] text-muted-foreground">{{ prompt.trim().length }}/4000</span>
        </label>
        <div class="flex flex-wrap gap-2">
          <label class="flex items-center gap-1 text-xs">
            <span class="text-muted-foreground">尺寸</span>
            <select v-model="size" data-testid="single-shot-size" class="h-7 rounded border bg-background px-2 text-xs">
              <option v-for="s in ['1K', '2K', '3K', '4K']" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>
          <label class="flex items-center gap-1 text-xs">
            <span class="text-muted-foreground">比例</span>
            <select v-model="ratio" data-testid="single-shot-ratio" class="h-7 rounded border bg-background px-2 text-xs">
              <option v-for="r in ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9']" :key="r" :value="r">{{ r }}</option>
            </select>
          </label>
        </div>
        <label class="flex flex-col gap-1 text-xs">
          <span class="text-muted-foreground">保存路径（留空用队列默认）</span>
          <input
            v-model="outputDir"
            data-testid="single-shot-output"
            :placeholder="outputPlaceholder || '默认=队列 outputDir 解析值'"
            class="h-7 rounded border bg-background px-2 text-xs outline-none focus:border-primary"
          />
        </label>
        <div class="flex gap-2">
          <Button data-testid="single-shot-generate" size="sm" class="h-7 text-xs" :disabled="!canGenerate" @click="onGenerate">
            {{ generating ? '生成中…' : '生成' }}
          </Button>
          <Button data-testid="single-shot-save" size="sm" variant="outline" class="h-7 text-xs" :disabled="!canSave" @click="onSave">
            {{ saving ? '保存中…' : '保存' }}
          </Button>
          <Button data-testid="single-shot-reset" size="sm" variant="ghost" class="h-7 text-xs" @click="onReset">重来</Button>
        </div>
        <p class="text-[11px] text-muted-foreground">单发不占用队列并发、不触发备料/熔断；队列运行时可并行单发。</p>
      </div>
      <div class="flex min-h-40 flex-col gap-2 rounded border bg-card p-3">
        <h3 class="text-xs font-semibold">内存预览（未落盘）</h3>
        <div v-if="preview" class="flex flex-col gap-2">
          <img
            data-testid="single-shot-preview"
            :src="previewUrl"
            alt="单发预览"
            class="max-h-80 w-full rounded border object-contain"
          />
          <div class="text-[11px] text-muted-foreground">预览已生成（{{ (preview.elapsedMs / 1000).toFixed(1) }}s），点保存才落盘。</div>
        </div>
        <div v-else data-testid="single-shot-empty" class="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
          暂无预览 — 填写 prompt 后点「生成」
        </div>
        <div v-if="saved" data-testid="single-shot-saved" class="rounded border bg-muted/40 p-2 font-mono text-[11px]">
          <div data-testid="single-shot-filename" class="break-all">{{ saved.filename }}</div>
          <div class="mt-1 flex gap-2">
            <button data-testid="single-shot-locate" class="text-primary" @click="onLocate">定位文件</button>
            <button data-testid="single-shot-copy" class="text-primary" @click="onCopyFilename">复制文件名</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
