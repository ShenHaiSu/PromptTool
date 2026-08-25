<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { useToast } from '@/composables/useToast'
import { dbExportLibrary, dbImportLibraryText } from '@/lib/db'
import type { ImportMode, LibraryImportReport } from '@/lib/db'

const emit = defineEmits<{ (e: 'close'): void; (e: 'imported'): void }>()

const { push } = useToast()
const exporting = ref(false)
const importing = ref(false)
const mode = ref<ImportMode>('skip')
const fileName = ref('')
const report = ref<LibraryImportReport | null>(null)
const error = ref('')
const showErrors = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function close(): void {
  emit('close')
}

/** 导出词库：Rust 组装 JSON → 前端 Blob 下载 pmf-library-*.json */
async function onExport(): Promise<void> {
  exporting.value = true
  try {
    const json = await dbExportLibrary()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const d = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    a.href = url
    a.download = `pmf-library-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    push('词库已导出为 JSON', 'success', 1500)
  } catch (err) {
    push(`导出失败: ${String(err)}`, 'error')
  } finally {
    exporting.value = false
  }
}

function onPickFile(): void {
  fileInput.value?.click()
}

/** 读取所选 JSON 文件内容 → 去重导入 */
async function onFileSelected(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fileName.value = file.name
  error.value = ''
  report.value = null
  importing.value = true
  try {
    const text = await file.text()
    report.value = await dbImportLibraryText(text, mode.value)
    push('词库导入完成', 'success', 1500)
    emit('imported')
  } catch (err) {
    error.value = String(err)
    push(`导入失败: ${String(err)}`, 'error')
  } finally {
    importing.value = false
    input.value = ''
  }
}

const totalErrors = (): number => report.value?.errors.length ?? 0
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
          <Button data-testid="library-export-btn" variant="outline" size="sm" :disabled="exporting" @click="onExport">
            {{ exporting ? '导出中…' : '导出词库 JSON' }}
          </Button>
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
              {{ importing ? '导入中…' : '选择文件' }}
            </Button>
            <span v-if="fileName" data-testid="library-file-name" class="truncate text-xs text-muted-foreground">{{ fileName }}</span>
          </div>
          <div class="mt-2 flex items-center gap-4 text-sm">
            <label class="flex items-center gap-1.5">
              <input v-model="mode" type="radio" value="skip" data-testid="library-mode-skip" />
              跳过重复（推荐）
            </label>
            <label class="flex items-center gap-1.5">
              <input v-model="mode" type="radio" value="overwrite" data-testid="library-mode-overwrite" />
              覆盖重复
            </label>
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
              <li v-for="(er, i) in report.errors" :key="i">· {{ er }}</li>
            </ul>
          </div>
        </section>

        <p v-if="error" data-testid="library-error" class="rounded-md border border-red-500/30 bg-red-50 p-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-300">
          {{ error }}
        </p>
      </div>
    </div>
  </div>
</template>