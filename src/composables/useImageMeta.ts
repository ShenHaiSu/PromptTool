/**
 * need02-02 图片解析状态机：idle|reading|done|empty(none)|error。
 * Tauri 下优先绝对路径链路（dialog open / 拖拽路径 → readImageMeta）；
 * 浏览器 File 降级仅提示需桌面端（无图片预览）。
 */
import { ref } from 'vue'
import { readImageMeta, type EmbeddedImageMeta } from '@/lib/imageQueueApi'
import { stripVerbatim } from '@/lib/pathDisplay'

export type ImageMetaStatus = 'idle' | 'reading' | 'done' | 'empty' | 'error'

const MAX_BYTES = 100 * 1024 * 1024
const IMAGE_EXTS = ['png', 'jpg', 'jpeg']

function fileBaseName(p: string): string {
  const t = p.replace(/\\/g, '/')
  const i = t.lastIndexOf('/')
  return i >= 0 ? t.slice(i + 1) : t
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function useImageMeta() {
  const status = ref<ImageMetaStatus>('idle')
  const filePath = ref<string | null>(null)
  const fileName = ref<string>('')
  const meta = ref<EmbeddedImageMeta | null>(null)
  const errorMsg = ref<string>('')
  const isDragging = ref(false)
  const webNotice = ref<string>('')

  function setError(msg: string): void {
    status.value = 'error'
    errorMsg.value = msg
    meta.value = null
  }

  function reset(): void {
    status.value = 'idle'
    filePath.value = null
    fileName.value = ''
    meta.value = null
    errorMsg.value = ''
    webNotice.value = ''
    isDragging.value = false
  }

  async function read(absPath: string): Promise<void> {
    const cleaned = stripVerbatim((absPath ?? '').trim())
    if (!cleaned) {
      setError('路径为空，请重新选择')
      return
    }
    const ext = extOf(fileBaseName(cleaned))
    if (ext && !IMAGE_EXTS.includes(ext)) {
      filePath.value = cleaned
      fileName.value = fileBaseName(cleaned)
      status.value = 'empty'
      meta.value = null
      errorMsg.value = ''
      return
    }
    status.value = 'reading'
    errorMsg.value = ''
    meta.value = null
    filePath.value = cleaned
    fileName.value = fileBaseName(cleaned)
    try {
      const m = await readImageMeta(cleaned)
      if (!m) {
        status.value = 'empty'
        meta.value = null
        return
      }
      meta.value = m
      status.value = 'done'
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function pickFile(): Promise<void> {
    const mod = (await import('@tauri-apps/plugin-dialog')) as unknown as {
      open: (opts: unknown) => Promise<string | string[] | null>
    }
    const picked = await mod.open({
      multiple: false,
      title: '选择图片解析',
      filters: [{ name: 'Images', extensions: IMAGE_EXTS }],
    })
    const p = Array.isArray(picked) ? (picked[0] ?? null) : picked
    if (typeof p !== 'string' || !p.trim()) return
    await read(p.trim())
  }

  async function handleDrop(input: string[] | File[] | FileList): Promise<void> {
    const arr: Array<string | File> = Array.isArray(input) ? [...input] : Array.from(input)
    if (!arr.length) return
    const first = arr[0]
    if (typeof first === 'string') {
      const cleaned = stripVerbatim(first.trim())
      if (!cleaned) return
      await read(cleaned)
      return
    }
    // Web File 降级：无内嵌解析能力，仅提示用桌面端
    const f = first as File
    if (f.size > MAX_BYTES) {
      fileName.value = f.name || '未命名图片'
      setError(`文件过大（${(f.size / 1024 / 1024).toFixed(1)}MB），超过 100MB 上限`)
      return
    }
    filePath.value = null
    fileName.value = f.name || '未命名图片'
    meta.value = null
    errorMsg.value = ''
    webNotice.value = 'Web 模式暂不支持解析，请使用桌面端选择文件'
    status.value = 'empty'
  }

  return {
    status,
    filePath,
    fileName,
    meta,
    errorMsg,
    isDragging,
    webNotice,
    pickFile,
    handleDrop,
    read,
    reset,
  }
}
