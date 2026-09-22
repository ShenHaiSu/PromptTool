/**
 * 生图任务详情 Dialog service（need06 复用 Dialog）。
 * 对齐 `useToast` 的模块级单例模式：任意卡片 `open(task)` 拉起，
 * 顶层 `ImageTaskDetailDialog` 订阅同一份 state 做展示。
 * 卡片身处虚拟化 `transform` 行容器内，Dialog 本体挂 App 顶层 + Teleport 到 body，
 * 从根上避开 `fixed` 被祖先 `transform` 劫持的问题。
 */
import { ref } from 'vue'
import { useToast } from '@/composables/useToast'
import { IQ_RATIOS, IQ_SIZES } from '@/lib/imageQueue'
import { readImageMeta, type EmbeddedImageMeta, type ImageTaskView } from '@/lib/imageQueueApi'
import { useImageQueueStore } from '@/stores/imageQueue'

const opened = ref(false)
const task = ref<ImageTaskView | null>(null)
const embedded = ref<EmbeddedImageMeta | null>(null)
const loading = ref(false)
const reusing = ref(false)

export function useImageTaskDialog() {
  const { push } = useToast()

  /** 拉起详情：先开骨架，异步读内嵌 meta；无内嵌/失败则 toast 并自动关闭。 */
  async function open(detail: ImageTaskView): Promise<void> {
    task.value = detail
    opened.value = true
    embedded.value = null
    if (!detail.filePath) {
      push('该任务暂无落盘文件', 'error', 2000)
      close()
      return
    }
    loading.value = true
    try {
      const meta = await readImageMeta(detail.filePath)
      if (!meta) {
        push('该图无内嵌参数（可能为旧图/外部图）', 'error', 2500)
        close()
        return
      }
      embedded.value = meta
    } catch (e) {
      push(`读取内嵌参数失败：${String(e)}`, 'error', 2500)
      close()
    } finally {
      loading.value = false
    }
  }

  function close(): void {
    opened.value = false
    task.value = null
    embedded.value = null
  }

  async function copyPrompt(): Promise<void> {
    const text = embedded.value?.prompt ?? task.value?.prompt ?? ''
    if (!text) return
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

  /**
   * 一键复用参数下单：把内嵌的 prompt/size/ratio 回填入队。
   * size/ratio 前端先验白名单（非法回落当前配置并提示），后端 `resolve_item_size_ratio` 再决议一次。
   * 入队成功即关 Dialog；全命中去重（enqueued=0）时 `enqueueBatch` 内部已 toast，Dialog 保持打开。
   */
  async function reuseParams(): Promise<void> {
    const meta = embedded.value
    if (!meta || reusing.value) return
    const prompt = meta.prompt.trim()
    if (!prompt) {
      push('内嵌 prompt 为空，无法复用', 'warning')
      return
    }
    const iq = useImageQueueStore()
    let size = iq.config.size
    let ratio = iq.config.ratio
    if ((IQ_SIZES as readonly string[]).includes(meta.size)) size = meta.size
    if ((IQ_RATIOS as readonly string[]).includes(meta.ratio)) ratio = meta.ratio
    if (size !== meta.size || ratio !== meta.ratio) {
      push('内嵌 size/ratio 已失效，已用当前配置入队', 'warning')
    }
    reusing.value = true
    try {
      const { enqueued } = await iq.enqueueBatch([
        { prompt, irHash: meta.irHash ?? null, size, ratio },
      ])
      if (enqueued > 0) {
        push(`已复用参数入队（${size} ${ratio}），可开始生图`, 'success', 2000)
        close()
      }
    } finally {
      reusing.value = false
    }
  }

  return { opened, task, embedded, loading, reusing, open, close, copyPrompt, reuseParams }
}
