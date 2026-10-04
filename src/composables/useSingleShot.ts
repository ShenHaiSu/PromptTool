import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { notify } from '@/lib/notify'
import { logger } from '@/lib/logger'
import { useImageQueueStore } from '@/stores/imageQueue'
import { useConnectionProfileStore } from '@/stores/connectionProfile'
import { isConnectionReady } from '@/lib/connectionProfile'
import { dbRevealInExplorer } from '@/lib/db'
import { iqGetResolvedOutputDir } from '@/lib/imageQueueApi'
import { iqGenerateOnePreview, iqSavePreview } from '@/lib/statsApi'
import { IQ_SIZES, IQ_RATIOS } from '@/lib/imageQueue'
import { STORAGE_KEYS } from '@/lib/storageKeys'

/** need03 S4：单发面板状态与动作，内存预览不进 Pinia。 */
export function useSingleShot(emit: { (e: 'switch-to-model'): void }) {
  const iq = useImageQueueStore()
  const conn = useConnectionProfileStore()

  const DRAFT_KEY = STORAGE_KEYS.SINGLE_SHOT_DRAFT
  /** 上下分栏比例持久化（与主三栏 useSash 的 pmf:sash 相互独立） */
  const VSPLIT_KEY = STORAGE_KEYS.SINGLE_SHOT_VSPLIT
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
  const lastError = ref<string | null>(null)
  const failedAt = ref<string | null>(null)

  const previewUrl = computed(() => (preview.value ? `data:${preview.value.mime};base64,${preview.value.b64}` : ''))
  const canGenerate = computed(() => !generating.value && prompt.value.trim().length > 0)
  const canSave = computed(() => !saving.value && !generating.value && preview.value != null)
  const promptOverlong = computed(() => prompt.value.trim().length > 4000)
  /** need02 只读：连接就绪只读模型 SSOT（conn.profile），不再双读 iq。 */
  const keyMissing = computed(() => !isConnectionReady(conn.profile))

  /* ---------------- 上下分栏（可拖动分隔条） ---------------- */
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
    } catch (e) {
      logger.warn('singleShot', '读取上下分栏比例失败，使用默认值：', e)
    }
    topFrac.value = VSPLIT_DEFAULT
  }

  watch(topFrac, () => {
    try {
      localStorage.setItem(VSPLIT_KEY, String(topFrac.value))
    } catch (e) {
      logger.warn('singleShot', '保存上下分栏比例失败：', e)
    }
  })

  /* ---------------- 图片缩放 / 拖拽（由面板注入 stageRef） ---------------- */
  let zoom: ReturnType<typeof import('@/composables/useImageZoomPan').useImageZoomPan> | null = null

  function bindZoom(z: NonNullable<typeof zoom>): void {
    zoom = z
  }

  function zoomReset(): void {
    try {
      zoom?.reset()
    } catch (e) {
      logger.warn('singleShot', '重置缩放失败：', e)
    }
  }

  /* ---------------- 生成 / 保存 / 重来 ---------------- */
  function persistDraft(): void {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ prompt: prompt.value, size: size.value, ratio: ratio.value }))
    } catch (e) {
      logger.warn('singleShot', '保存草稿失败：', e)
    }
  }

  function restoreDraft(): void {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const d = JSON.parse(raw) as { prompt?: string; size?: string; ratio?: string }
      if (typeof d.prompt === 'string') prompt.value = d.prompt
      if (typeof d.size === 'string' && (IQ_SIZES as readonly string[]).includes(d.size)) size.value = d.size
      if (typeof d.ratio === 'string' && (IQ_RATIOS as readonly string[]).includes(d.ratio)) ratio.value = d.ratio
    } catch (e) {
      logger.warn('singleShot', '恢复草稿失败：', e)
    }
  }

  watch([prompt, size, ratio], () => persistDraft())

  async function onGenerate(): Promise<void> {
    const p = prompt.value.trim()
    if (!p) {
      notify('prompt 不能为空', 'warning')
      return
    }
    if (p.length > 4000) {
      notify('prompt 超 4000 字符已截断', 'warning')
    }
    if (keyMissing.value) {
      notify('未设置 API 密钥', 'warning')
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
      if (r.imageBase64.length > 25 * 1024 * 1024) {
        notify('预览较大（>25MB），建议先保存再继续生成', 'warning')
      }
      // 新图：回到适应窗口
      zoomReset()
      notify(`单发预览已生成（${(r.elapsedMs / 1000).toFixed(1)}s，未落盘）`, 'success', 2000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      lastError.value = msg
      try {
        failedAt.value = new Date().toLocaleTimeString()
      } catch (e) {
        logger.warn('singleShot', '读取失败时间失败：', e)
        failedAt.value = ''
      }
      notify(`单发失败：${msg}`, 'error')
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
   * silent=true 时新生成前释放不通知。
   */
  function releasePreview(silent = false): void {
    preview.value = null
    zoomReset()
    if (!silent) {
      saved.value = null
    }
  }

  async function onSave(): Promise<void> {
    if (!preview.value) {
      notify('先生成预览再保存', 'warning')
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
      notify(`已落盘 ${r.filename}（已计入统计）`, 'success', 2500)
    } catch (err) {
      notify(`保存失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      saving.value = false
    }
  }

  function onReset(): void {
    // 重来：丢弃内存预览（不落盘），保留 prompt 草稿
    releasePreview()
    saved.value = null
    lastError.value = null
    notify('已重来（预览已丢弃）', 'info', 1200)
  }

  async function onBrowseDir(): Promise<void> {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({ directory: true, multiple: false, title: '选择保存目录' })
      const dir = Array.isArray(picked) ? (picked[0] ?? null) : picked
      if (typeof dir === 'string' && dir) outputDir.value = dir
    } catch (err) {
      notify(`选择目录失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  async function onOpenOriginal(): Promise<void> {
    if (!previewUrl.value) return
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(previewUrl.value)
    } catch (err) {
      notify(`打开原图失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  async function copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      logger.warn('singleShot', '剪贴板 API 不可用，回退 execCommand：', err)
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
  }

  async function onCopyPrompt(): Promise<void> {
    const text = prompt.value.trim()
    if (!text) {
      notify('暂无可复制的 prompt', 'warning')
      return
    }
    await copyText(text)
    notify('已复制 prompt', 'success', 1200)
  }

  async function onLocate(): Promise<void> {
    if (!saved.value) return
    try {
      await dbRevealInExplorer(saved.value.filePath)
    } catch (err) {
      notify(`定位失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  async function onCopyFilename(): Promise<void> {
    if (!saved.value) return
    await copyText(saved.value.filename)
    notify('已复制文件名', 'success', 1200)
  }

  function gotoModel(): void {
    emit('switch-to-model')
  }

  onMounted(async () => {
    restoreDraft()
    loadVSplit()
    if (!size.value) size.value = iq.config.size || '1K'
    if (!ratio.value) ratio.value = iq.config.ratio || '1:1'
    // need01-02B：直进单发即加载连接，不再依赖队列面板 onMounted
    if (!conn.loaded) {
      try {
        await conn.loadModel()
      } catch (e) {
        logger.warn('singleShot', '连接配置加载失败（降级沿用 iq 配置）：', e)
      }
    }
    try {
      outputPlaceholder.value = await iqGetResolvedOutputDir()
    } catch (e) {
      logger.warn('singleShot', '读取默认输出目录失败：', e)
    }
  })

  onBeforeUnmount(() => {
    // 未保存切 Tab/关闭：内存丢弃（base64 不持久化），prompt 草稿已留 localStorage
    releasePreview()
  })

  return {
    prompt, size, ratio, outputDir, outputPlaceholder,
    generating, saving, preview, saved, lastError, failedAt,
    previewUrl, canGenerate, canSave, promptOverlong, keyMissing,
    topFrac, topPct, sashActive,
    bindZoom, zoomReset,
    onGenerate, onRetry, releasePreview, onSave, onReset, onBrowseDir, onOpenOriginal,
    onCopyPrompt, onLocate, onCopyFilename, gotoModel,
  }
}