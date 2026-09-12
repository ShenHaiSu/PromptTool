<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { useToast } from '@/composables/useToast'
import {
  dbClearLocalData,
  dbExportLibrary,
  dbGetAllModulesGrouped,
  dbGetDimensions,
  dbImportLibraryText,
  dbPreviewLibraryText,
  LIBRARY_LARGE_EXPORT_BYTES,
} from '@/lib/db'
import { buildLibraryCsvText, exportLibraryCsv, type LibraryCsvRow } from '@/lib/export'
import { emit as emitEvent, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import type { ImportMode, LibraryImportReport } from '@/lib/db'

const emit = defineEmits<{ (e: 'close'): void; (e: 'imported'): void }>()

/** 阶段五隐私固定文案（状态栏/设置页同一份，见 08§3）。 */
const PRIVACY_TEXT =
  '纯本地版：数据仅保存在本浏览器 IndexedDB，不上传、不鉴权；换浏览器/清数据会丢失，请定期导出备份。'

const { push } = useToast()
const exporting = ref(false)
const exportingCsv = ref(false)
const includeHistory = ref(false)
const importing = ref(false)
const confirming = ref(false)
const mode = ref<ImportMode>('skip')
const fileName = ref('')
const pendingText = ref('')
const preview = ref<LibraryImportReport | null>(null)
const report = ref<LibraryImportReport | null>(null)
const error = ref('')
const showErrors = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const clearArmed = ref(false)
const clearing = ref(false)

function blobFilename(prefix: string, ext: string): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${prefix}-${ts}.${ext}`
}

function triggerBlobDownload(json: string): void {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = blobFilename('pmf-library', 'json')
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** 大文件（>50MB）导出前提示（08§2），返回是否继续。 */
function largeExportGuard(label: string, bytes: number): boolean {
  if (bytes <= LIBRARY_LARGE_EXPORT_BYTES) return true
  const mb = (bytes / 1048576).toFixed(1)
  return window.confirm(`导出${label}约 ${mb}MB（超过 50MB），下载/打开可能较慢，仍要继续吗？`)
}

/** 导出词库：纯 Web Blob 下载（无落盘/目录概念）。默认不含历史/模板，勾选完整备份才含。 */
async function onExport(): Promise<void> {
  if (exporting.value) return
  exporting.value = true
  try {
    const json = await dbExportLibrary(undefined, { includeHistory: includeHistory.value })
    if (!largeExportGuard(' JSON', new TextEncoder().encode(json).length)) return
    triggerBlobDownload(json)
    push(includeHistory.value ? '完整备份已导出为 JSON（含历史/模板）' : '词库已导出为 JSON', 'success', 1500)
  } catch (err) {
    push(`导出失败: ${String(err)}`, 'error')
  } finally {
    exporting.value = false
  }
}

/** 导出词库 CSV：维度/词条明细，Blob 直接下载。 */
async function onExportCsv(): Promise<void> {
  if (exportingCsv.value) return
  exportingCsv.value = true
  try {
    const [dims, grouped] = await Promise.all([dbGetDimensions(), dbGetAllModulesGrouped()])
    const dimById = new Map(dims.map((d) => [d.id, d]))
    const dimByKey = new Map(dims.map((d) => [d.key, d]))
    const rows: LibraryCsvRow[] = []
    for (const [gk, mods] of Object.entries(grouped)) {
      const dim = dimById.get(gk) ?? dimByKey.get(gk)
      const key = dim?.key ?? gk
      const name = dim?.nameCn ?? key
      for (const m of mods) {
        rows.push({
          dimensionKey: m.dimensionKey ?? key,
          dimensionName: name,
          contentEn: m.contentEn,
          displayName: m.displayName,
          weight: m.weight,
          isEnabled: m.isEnabled,
        })
      }
    }
    const bytes = new TextEncoder().encode(buildLibraryCsvText(rows)).length
    if (!largeExportGuard(' CSV', bytes)) return
    exportLibraryCsv(rows)
    push(`词库已导出为 CSV（${rows.length} 条）`, 'success', 1500)
  } catch (err) {
    push(`导出失败: ${String(err)}`, 'error')
  } finally {
    exportingCsv.value = false
  }
}

function close(): void {
  emit('close')
}

function onPickFile(): void {
  fileInput.value?.click()
}

function resetPending(): void {
  pendingText.value = ''
  preview.value = null
  fileName.value = ''
}

/** 读取所选 JSON 文件 → 解析 → 预览计数（不写库），二次确认后才真正导入。 */
async function onFileSelected(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fileName.value = file.name
  error.value = ''
  report.value = null
  showErrors.value = false
  importing.value = true
  try {
    const text = await file.text()
    preview.value = await dbPreviewLibraryText(text, mode.value)
    pendingText.value = text
  } catch (err) {
    error.value = String(err)
    resetPending()
    push(`解析失败: ${String(err)}`, 'error')
  } finally {
    importing.value = false
    input.value = ''
  }
}

/** 切换去重模式后，若已有待确认文件则重新预览。 */
async function onModeChange(): Promise<void> {
  if (!pendingText.value) return
  try {
    preview.value = await dbPreviewLibraryText(pendingText.value, mode.value)
  } catch (err) {
    error.value = String(err)
    resetPending()
  }
}

/** 二次确认后真正写 IDB → LIBRARY_CHANGED 刷新。 */
async function onConfirmImport(): Promise<void> {
  if (confirming.value || !pendingText.value) return
  confirming.value = true
  try {
    report.value = await dbImportLibraryText(pendingText.value, mode.value)
    push('词库导入完成', 'success', 1500)
    resetPending()
    emitEvent(LIBRARY_CHANGED)
    emit('imported')
  } catch (err) {
    error.value = String(err)
    push(`导入失败: ${String(err)}`, 'error')
  } finally {
    confirming.value = false
  }
}

function onCancelPending(): void {
  resetPending()
  error.value = ''
}

/** 清空本地数据：二次确认 + 建议先导出（08§2）。 */
async function onClearConfirm(): Promise<void> {
  if (clearing.value) return
  clearing.value = true
  try {
    await dbClearLocalData()
    clearArmed.value = false
    push('本地数据已清空，请刷新页面重建初始词库', 'warning', 4000)
    emitEvent(LIBRARY_CHANGED)
    emit('imported')
  } catch (err) {
    push(`清空失败: ${String(err)}`, 'error')
  } finally {
    clearing.value = false
  }
}

const totalErrors = (): number => (preview.value?.errors.length ?? report.value?.errors.length ?? 0)
const shownErrors = computed(() => preview.value?.errors ?? report.value?.errors ?? [])
const hasPending = computed(() => preview.value != null && pendingText.value !== '')
</script>

<template>
  <div
    data-testid="library-dialog"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    @click.self="close"
  >
    <div class="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border bg-background shadow-xl">
      <!-- 标题 -->
      <div class="flex items-center justify-between border-b px-4 py-3">
        <h2 class="text-base font-semibold">词库管理</h2>
        <Button data-testid="library-close" variant="ghost" size="sm" @click="close">✕</Button>
      </div>

      <div class="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <!-- 导出 -->
        <section data-testid="library-export-section">
          <p class="mb-2 text-sm font-medium text-muted-foreground">导出（标准 JSON，可跨实例导入）</p>
          <div class="flex flex-wrap items-center gap-2">
            <Button data-testid="library-export-btn" variant="outline" size="sm" :disabled="exporting" @click="onExport">
              {{ exporting ? '导出中…' : '导出词库 JSON' }}
            </Button>
            <Button data-testid="library-export-csv-btn" variant="outline" size="sm" :disabled="exportingCsv" @click="onExportCsv">
              {{ exportingCsv ? '导出中…' : '导出 CSV' }}
            </Button>
          </div>
          <label class="mt-2 flex items-center gap-1.5 text-sm">
            <input v-model="includeHistory" type="checkbox" data-testid="library-export-full-backup" />
            完整备份（含历史/模板）
          </label>
          <p class="mt-2 text-xs text-muted-foreground">纯 Web 版通过浏览器下载保存文件，下载后请自行打开文件夹查看。历史/拼装快照默认不随词库导出，避免臃肿。</p>
        </section>

        <!-- 导入 -->
        <section data-testid="library-import-section">
          <p class="mb-2 text-sm font-medium text-muted-foreground">
            去重导入（维度按 key、词条按 id/内容、规则按 id/签名、标签按 name 判重）
          </p>
          <input
            ref="fileInput"
            data-testid="library-file-input"
            type="file"
            accept=".json,application/json"
            class="hidden"
            @change="onFileSelected"
          />
          <div class="flex flex-wrap items-center gap-2">
            <Button data-testid="library-pick-file" variant="outline" size="sm" :disabled="importing" @click="onPickFile">
              {{ importing ? '解析中…' : '选择文件' }}
            </Button>
            <span v-if="fileName" data-testid="library-file-name" class="truncate text-xs text-muted-foreground">{{ fileName }}</span>
          </div>
          <div class="mt-2 flex items-center gap-4 text-sm">
            <label class="flex items-center gap-1.5">
              <input v-model="mode" type="radio" value="skip" data-testid="library-mode-skip" @change="onModeChange" />
              跳过重复（推荐）
            </label>
            <label class="flex items-center gap-1.5">
              <input v-model="mode" type="radio" value="overwrite" data-testid="library-mode-overwrite" @change="onModeChange" />
              覆盖重复
            </label>
          </div>
          <p class="mt-2 text-xs text-muted-foreground">
            旧数据迁移：Tauri 版 → 词库导出 JSON → Web 版在此导入。
          </p>

          <!-- 导入预览（解析后、写库前二次确认） -->
          <div v-if="hasPending && preview" data-testid="library-import-preview" class="mt-3 space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
            <p class="font-medium">导入预览（尚未写库，请确认）</p>
            <div class="grid grid-cols-2 gap-x-6 gap-y-1">
              <p data-testid="library-preview-dims">维度：新增 {{ preview.dimensionsCreated }} · 覆盖 {{ preview.dimensionsUpdated }} · 跳过 {{ preview.dimensionsSkipped }}</p>
              <p data-testid="library-preview-modules">词条：新增 {{ preview.modulesCreated }} · 覆盖 {{ preview.modulesUpdated }} · 跳过 {{ preview.modulesSkipped }}</p>
              <p data-testid="library-preview-rules">规则：新增 {{ preview.rulesCreated }} · 覆盖 {{ preview.rulesUpdated }} · 跳过 {{ preview.rulesSkipped }}</p>
              <p data-testid="library-preview-tags">标签：新增 {{ preview.tagsCreated ?? 0 }} · 跳过 {{ preview.tagsSkipped }}</p>
              <p data-testid="library-preview-templates">模板：新增 {{ preview.templatesCreated ?? 0 }} · 覆盖 {{ preview.templatesUpdated ?? 0 }} · 跳过 {{ preview.templatesSkipped ?? 0 }}</p>
              <p data-testid="library-preview-history">历史：新增 {{ preview.assembliesCreated ?? 0 }} · 跳过 {{ preview.assembliesSkipped ?? 0 }}</p>
            </div>
            <div class="flex items-center gap-2 pt-1">
              <Button data-testid="library-import-confirm" size="sm" :disabled="confirming" @click="onConfirmImport">
                {{ confirming ? '导入中…' : '确认导入' }}
              </Button>
              <Button data-testid="library-import-cancel" variant="ghost" size="sm" @click="onCancelPending">
                取消
              </Button>
            </div>
          </div>
        </section>

        <!-- 结果 -->
        <section v-if="report" data-testid="library-report" class="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
          <div class="flex items-center justify-between">
            <p class="font-medium">导入结果</p>
            <span class="text-xs text-muted-foreground" data-testid="library-report-mode">模式：{{ mode === 'skip' ? '跳过' : '覆盖' }}</span>
          </div>
          <div class="grid grid-cols-2 gap-x-6 gap-y-1">
            <p data-testid="library-report-dims">维度：新增 {{ report.dimensionsCreated }} · 更新 {{ report.dimensionsUpdated }} · 跳过 {{ report.dimensionsSkipped }}</p>
            <p data-testid="library-report-modules">词条：新增 {{ report.modulesCreated }} · 更新 {{ report.modulesUpdated }} · 跳过 {{ report.modulesSkipped }}</p>
            <p data-testid="library-report-rules">规则：新增 {{ report.rulesCreated }} · 更新 {{ report.rulesUpdated }} · 跳过 {{ report.rulesSkipped }}</p>
            <p data-testid="library-report-tags">标签：新增 {{ report.tagsCreated }} · 跳过 {{ report.tagsSkipped }}</p>
            <p data-testid="library-report-templates">模板：新增 {{ report.templatesCreated ?? 0 }} · 更新 {{ report.templatesUpdated ?? 0 }} · 跳过 {{ report.templatesSkipped ?? 0 }}</p>
            <p data-testid="library-report-history">历史：新增 {{ report.assembliesCreated ?? 0 }} · 跳过 {{ report.assembliesSkipped ?? 0 }}</p>
          </div>
          <div v-if="totalErrors() > 0">
            <Button
              data-testid="library-report-errors-toggle"
              variant="ghost"
              size="sm"
              class="h-6 px-2 text-xs text-amber-600"
              @click="showErrors = !showErrors"
            >
              冲突/错误：{{ totalErrors() }} 条 {{ showErrors ? '▲' : '▼' }}
            </Button>
            <ul v-if="showErrors" data-testid="library-report-errors" class="mt-1 max-h-28 space-y-0.5 overflow-y-auto rounded bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <li v-for="(er, i) in shownErrors" :key="i">· {{ er }}</li>
            </ul>
          </div>
        </section>

        <p v-if="error" data-testid="library-error" class="rounded-md border border-red-500/30 bg-red-50 p-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-300">
          {{ error }}
        </p>

        <!-- 隐私 -->
        <section data-testid="library-privacy-section" class="rounded-md border p-3">
          <p data-testid="library-privacy" class="text-xs leading-5 text-muted-foreground">{{ PRIVACY_TEXT }}</p>
        </section>

        <!-- 危险区：清空本地数据 -->
        <section data-testid="library-danger-section" class="space-y-2 rounded-md border border-red-500/30 p-3">
          <p class="text-sm font-medium text-red-600 dark:text-red-400">危险区</p>
          <p class="text-xs text-muted-foreground">清空本浏览器 IndexedDB 中的全部本地数据。建议先导出备份，清空后请刷新页面重建初始词库。</p>
          <div class="flex items-center gap-2">
            <Button
              v-if="!clearArmed"
              data-testid="library-clear-btn"
              variant="outline"
              size="sm"
              class="border-red-500/40 text-red-600"
              @click="clearArmed = true"
            >
              清空本地数据
            </Button>
            <template v-else>
              <Button
                data-testid="library-clear-confirm"
                variant="outline"
                size="sm"
                class="border-red-500/40 text-red-600"
                :disabled="clearing"
                @click="onClearConfirm"
              >
                {{ clearing ? '清空中…' : '再次确认：清空全部数据' }}
              </Button>
              <Button data-testid="library-clear-cancel" variant="ghost" size="sm" @click="clearArmed = false">
                取消
              </Button>
            </template>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
