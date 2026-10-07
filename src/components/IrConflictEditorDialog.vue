<script setup lang="ts">
/**
 * need02 IR 冲突编辑器（05/06 唯一口径）
 * 受控对话框：open 由父控，内部 draft 深拷贝，关闭时脏检查。
 * 左段表 + 右冲突/tabs + 底预览三区（展示层在 ir/ 下）。
 */
 import { watch, computed } from 'vue'
 import { useOverlayClose } from '@/composables/useOverlayClose'
 import { type PromptIR, type AssemblyConfig, type Finding } from '@/engine/models'
 import { toSelectedItems } from '@/lib/irEdit'
import { useIrEditor } from '@/composables/useIrEditor'
import { notify } from '@/lib/notify'
import { useAssemblyStore } from '@/stores/assembly'
import { useLibraryStore } from '@/stores/library'
import { useHistoryStore } from '@/stores/history'
import { exportSingleCsv } from '@/lib/export'
import { dbUpdateModule } from '@/lib/db'
import { emit, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import { logger } from '@/lib/logger'
import IrSegList from './ir/IrSegList.vue'
import IrFindingsPanel from './ir/IrFindingsPanel.vue'
 import SaveDialog from './SaveDialog.vue'

const props = withDefaults(defineProps<{
  open: boolean
  ir?: PromptIR | null
  config?: AssemblyConfig | null
  title?: string
}>(), {
  ir: null,
  config: null,
  title: 'IR 冲突编辑器',
})

const emitEv = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'applied', payload: { ir: PromptIR; finalPrompt: string }): void
  (e: 'close'): void
}>()

const {
  draft, lockedIndexes, dirty, tab, expandedPreview, expandedSeg,
  highlightIdx, fixingId, undoStack, previewProfile, previewSeparator, previewBrackets,
  textDrafts, showSaveDialog, weightIdx, weightVal, weightPos,
   findings, activeFindings, summary, badgeText, previewConfig, engineRules,
  finalPreview, previewIr, hashShort, hasLocks, ruleDims, ruleModulesByDimId, loadError,
  refresh, ensureInit,
  onUndo, onAddSeg, onTextInput, confirmText, onWeightFloat, confirmWeightFloat, cancelWeightFloat,
  onToggleLock, onUnlockAll, onDeleteSeg, onDragEnd, locateSegment,
  onIgnore, onUnignore, onIgnoreAll, onApplyFix,
} = useIrEditor(props)

defineExpose({ refresh })

const assembly = useAssemblyStore()
const library = useLibraryStore()
const historyStore = useHistoryStore()

function onClose(): void {
  if (dirty.value) {
    const ok = window.confirm('改动未应用，确定关闭？')
    if (!ok) return
  }
  emitEv('update:open', false)
  emitEv('close')
}
 
 const oc = useOverlayClose(onClose, { open: computed(() => props.open) })

function onKeydown(e: KeyboardEvent): void {
   if (e.key === 'Escape') {
     if (weightIdx.value != null) { cancelWeightFloat(); return }
     return
   }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) {
    e.preventDefault()
    onUndo()
  }
}

function buildSelected() {
  const dimKeyToId: Record<string, string> = {}
  for (const d of library.dimensions) dimKeyToId[d.key] = d.id
  return toSelectedItems(draft.value, { lockedIndexes: lockedIndexes.value, dimKeyToId })
}

function onApplyToCanvas(): void {
  const items = buildSelected()
  if (assembly.selectedItems.length > 0) {
    const ok = window.confirm('覆盖当前画布？')
    if (!ok) return
  }
  assembly.setSelected(items)
  emitEv('applied', { ir: previewIr.value, finalPrompt: finalPreview.value })
  dirty.value = false
  emitEv('update:open', false)
  notify('已应用到画布', 'success', 1500)
}

function onSaveAs(): void {
  showSaveDialog.value = true
}

async function onSaveConfirm(payload: { name: string; desc: string | null }): Promise<void> {
  try {
    const irJson = JSON.stringify(previewIr.value.toJSON())
    await historyStore.save(payload.name || null, irJson, finalPreview.value, previewConfig.value, buildSelected(), false)
    showSaveDialog.value = false
    notify('已另存方案', 'success', 1500)
  } catch (e) {
    logger.warn('IrEditor', '另存失败', e)
    notify(`另存失败: ${String(e)}`, 'error')
  }
}

async function onCopy(): Promise<void> {
  const text = finalPreview.value
  if (!text.trim()) { notify('暂无可复制的 Prompt', 'warning'); return }
  try {
    await navigator.clipboard.writeText(text)
    notify('已复制到剪贴板', 'success', 1500)
  } catch (err) {
    logger.warn('IrEditor', 'clipboard降级', err)
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    notify('已复制到剪贴板', 'success', 1500)
  }
}

function onExport(): void {
  if (!finalPreview.value.trim()) { notify('暂无可导出的 Prompt', 'warning'); return }
  exportSingleCsv(previewIr.value, finalPreview.value)
  notify('已导出 CSV', 'success', 1500)
}

async function onWritebackWeight(index: number): Promise<void> {
  const s = draft.value[index]
  if (!s?.sourceModuleId) return
  const ok = window.confirm(`将词条默认权重写为 ${s.weight.toFixed(1)}？`)
  if (!ok) return
  try {
    const mod = Object.values(library.modulesByDim).flat().find((m) => m.id === s.sourceModuleId)
    if (!mod) { notify('库中找不到该条目', 'warning'); return }
    await dbUpdateModule({ ...mod, weight: s.weight })
    emit(LIBRARY_CHANGED, { source: 'ir-editor', op: 'update-module-weight' })
    notify('已写回词条默认权重', 'success', 1500)
  } catch (e) {
    logger.warn('IrEditor', '写回权重失败', e)
    notify(`写回失败: ${String(e)}`, 'error')
  }
}

function onFixToggle(ruleId: string): void {
  fixingId.value = fixingId.value === ruleId ? null : ruleId
}

function onFixConfirm(f: Finding): void {
  onApplyFix(f)
}

watch(() => props.open, (v) => { if (v) { tab.value = 'findings'; ensureInit() } })
</script>

<template>
  <div
    v-if="open"
    data-testid="ir-editor-overlay"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
     @mousedown="oc.onMouseDown" @click="oc.onClick" @keydown="onKeydown"
  >
    {{ ensureInit() }}
    <div data-testid="ir-editor-dialog" class="flex max-h-[min(84vh,800px)] w-[min(1120px,94vw)] flex-col rounded-lg border bg-background p-4 shadow-xl" @click.stop>
      <!-- 标题行 -->
      <div class="flex h-9 items-center justify-between">
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-semibold">{{ title }}</h3>
          <el-tag data-testid="ir-editor-badge" :type="summary.errors > 0 ? 'danger' : summary.warnings > 0 ? 'warning' : 'success'">{{ badgeText }}</el-tag>
        </div>
        <div class="flex items-center gap-1">
          <el-button data-testid="ir-editor-undo" text size="small" title="撤销段表操作（Ctrl+Z）" aria-label="撤销" :disabled="undoStack.length === 0" @click="onUndo">↩ 撤销</el-button>
          <el-button data-testid="ir-editor-close" text size="small" title="关闭" aria-label="关闭" @click="onClose">✕</el-button>
        </div>
      </div>

      <!-- 工具行 -->
      <div class="mt-2 flex items-center gap-2">
        <el-button data-testid="ir-editor-add-seg" plain size="small" @click="onAddSeg">+ 添加空段</el-button>
        <el-button v-if="hasLocks" data-testid="ir-editor-unlock-all" text size="small" @click="onUnlockAll">全部解锁</el-button>
        <div class="ml-auto flex items-center gap-2">
          <select v-model="previewProfile" data-testid="ir-editor-profile" class="h-7 rounded-md border bg-background px-2 text-xs" title="模型配置">
            <option value="sd">SD</option>
            <option value="mj">MJ</option>
            <option value="flux">Flux</option>
          </select>
          <select v-model="previewSeparator" data-testid="ir-editor-separator" class="h-7 rounded-md border bg-background px-2 text-xs" title="分隔符">
            <option value=", ">, 逗号</option>
            <option value=" ">空格</option>
            <option value="\n">换行</option>
          </select>
          <label class="flex items-center gap-1 text-xs text-muted-foreground">
            <input v-model="previewBrackets" data-testid="ir-editor-brackets" type="checkbox" class="accent-primary" />
            <span>权重括号</span>
          </label>
        </div>
      </div>

      <!-- 左右区 -->
      <div class="mt-2 flex min-h-0 flex-1 gap-3 max-[900px]:flex-col">
        <IrSegList
          :draft="draft"
          :locked-indexes="lockedIndexes"
          :highlight-idx="highlightIdx"
          :expanded-seg="expandedSeg"
          :text-drafts="textDrafts"
          @update:expanded-seg="expandedSeg = $event"
          @text-input="onTextInput"
          @text-confirm="confirmText"
          @weight-open="onWeightFloat"
          @lock-toggle="onToggleLock"
          @seg-delete="onDeleteSeg"
          @writeback="onWritebackWeight"
          @drag-end="onDragEnd"
        />
        <IrFindingsPanel
          :draft="draft"
          :tab="tab"
          :findings="findings"
          :active-count="activeFindings.length"
           :engine-rules-count="engineRules.length"
          :load-error="loadError"
          :fixing-id="fixingId"
          :rule-dims="ruleDims"
          :rule-modules-by-dim-id="ruleModulesByDimId"
          @tab-change="tab = $event"
          @retry="refresh"
          @ignore-all="onIgnoreAll"
          @locate="locateSegment"
          @fix-toggle="onFixToggle"
          @fix-confirm="onFixConfirm"
          @fix-cancel="fixingId = null"
          @ignore="onIgnore"
          @unignore="onUnignore"
        />
      </div>

      <!-- 底栏预览 -->
      <div class="mt-2 rounded-md border bg-muted/20 p-2.5">
        <p data-testid="ir-editor-preview" class="font-mono text-xs whitespace-pre-wrap break-words" :class="expandedPreview ? '' : 'line-clamp-3'">{{ finalPreview || '（空预览：段表为空或全为空文本）' }}</p>
        <div class="mt-1.5 flex items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            <span>{{ draft.length }} 段 · {{ finalPreview.length }} 字符</span>
            <span data-testid="ir-editor-hash" class="font-mono" :title="`IR hash ${previewIr.hash()}`">#{{ hashShort }}</span>
            <el-button v-if="finalPreview.length > 400" data-testid="ir-editor-preview-expand" text size="small" @click="expandedPreview = !expandedPreview">{{ expandedPreview ? '折叠' : '展开' }}</el-button>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <el-button data-testid="ir-editor-copy" plain size="small" :disabled="!finalPreview.trim()" @click="onCopy">复制全文</el-button>
            <el-button data-testid="ir-editor-export" plain size="small" :disabled="!finalPreview.trim()" @click="onExport">导出 CSV</el-button>
            <el-button data-testid="ir-editor-save" plain size="small" :disabled="!finalPreview.trim()" @click="onSaveAs">另存方案</el-button>
            <el-button data-testid="ir-editor-apply" type="primary" size="small" :disabled="draft.length === 0" @click="onApplyToCanvas">应用到画布</el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 权重浮窗 -->
    <Teleport to="body">
      <div
        v-if="weightIdx != null"
        data-testid="ir-editor-weight-popover"
        class="fixed z-[70] flex w-56 flex-col gap-2 rounded-md border bg-popover p-3 shadow-xl"
        :style="{ top: weightPos.top + 'px', left: weightPos.left + 'px' }"
        @click.stop
      >
        <p class="text-xs font-medium">权重 0.5 – 2.0 · 步进 0.1</p>
        <div class="flex items-center gap-2">
          <input type="range" min="0.5" max="2.0" step="0.1" :value="String(weightVal)" class="flex-1 accent-primary" @input="weightVal = parseFloat(($event.target as HTMLInputElement).value)" />
          <span class="w-8 text-center font-mono text-xs">{{ weightVal.toFixed(1) }}</span>
        </div>
        <div class="flex justify-end gap-1.5">
          <el-button text size="small" @click="cancelWeightFloat">取消</el-button>
          <el-button type="primary" size="small" @click="confirmWeightFloat">确定</el-button>
        </div>
      </div>
    </Teleport>

    <SaveDialog :open="showSaveDialog" mode="assembly" @update:open="showSaveDialog = $event" @confirm="onSaveConfirm" />
  </div>
</template>
