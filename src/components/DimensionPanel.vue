<script setup lang="ts">
import DimensionToolbar from '@/components/dimension/DimensionToolbar.vue'
import DimensionList from '@/components/dimension/DimensionList.vue'
import ModuleList from '@/components/dimension/ModuleList.vue'
import DimensionEditDialog from '@/components/DimensionEditDialog.vue'
import ModuleEditDialog from '@/components/ModuleEditDialog.vue'
import ModuleBatchDialog from '@/components/ModuleBatchDialog.vue'
import PromptPreviewDialog from '@/components/PromptPreviewDialog.vue'
import SaveDialog from '@/components/SaveDialog.vue'
import DimensionTranslateDialog from '@/components/DimensionTranslateDialog.vue'
import DimensionGenerateDialog from '@/components/DimensionGenerateDialog.vue'
import DimensionMigrateDialog from '@/components/DimensionMigrateDialog.vue'
import { useDimensionPanel } from '@/composables/useDimensionPanel'
import type { Module } from '@/engine/models'

const p = useDimensionPanel()

function onSelectedCardClick(ev: MouseEvent, moduleId: string): void {
  const m = findModule(moduleId)
  if (m) p.onSelectedCardClick(ev, m)
}
function findModule(id: string): Module | null {
  for (const lst of Object.values(p.modulesByDim.value)) {
    const f = lst.find((x) => x.id === id)
    if (f) return f
  }
  const sel = p.assembly.selectedItems.find((it) => it.module.id === id)
  return (sel?.module as Module) ?? null
}

defineExpose({ refresh: p.refresh, keyword: p.keyword, allowNsfw: p.allowNsfw, dimensions: p.dimensions, modulesByDim: p.modulesByDim, onCreateDimension: p.onCreateDimension, dimPanelMode: p.dimPanelMode })
</script>

<template>
  <section data-testid="dimension-panel" class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <DimensionToolbar
      :keyword="p.keyword.value"
      :dim-panel-mode="p.dimPanelMode.value"
      :filtered-count="p.filteredDimensions.value.length"
      :selected-count="p.selectedCount.value"
      :nsfw-on="p.allowNsfw.value"
      :nsfw-count="p.nsfwCount.value"
      @update:keyword="p.keyword.value = $event"
      @update:mode="p.dimPanelMode.value = $event"
      @create-dimension="p.onCreateDimension()"
      @toggle-nsfw="p.allowNsfw.value = !p.allowNsfw.value"
      @open-preview="p.previewOpen.value = true"
    />

    <DimensionList
      v-if="p.dimPanelMode.value === 'browse'"
      :loading="p.loading.value"
      :dims="p.filteredDimensions.value"
      :keyword="p.keyword.value"
      :modules-of="p.filteredModules"
      :is-expanded="p.isExpanded"
      :is-selected="p.isSelected"
      @dim-click="(ev, dim) => p.onDimHeaderClick(ev, dim)"
      @dim-context="(ev, dim) => p.onDimContextMenu(ev, dim)"
      @create-module="p.onCreateModule($event)"
      @batch-create="p.onBatchCreate($event)"
      @edit-dimension="p.onEditDimension($event)"
      @module-click="(ev, m, dim) => p.onModuleRowClick(ev, m, dim)"
      @edit-module="p.onEditModule($event)"
      @delete-module="p.onDeleteModule($event)"
      @clear-search="p.keyword.value = ''"
    />

    <ModuleList
      v-else
      :selected-count="p.selectedCount.value"
      :filtered-selected="p.filteredSelected.value"
      :keyword="p.keyword.value"
      :show-settings="p.showSettings.value"
      :separator="p.assembly.config.separator"
      :use-weight-brackets="p.assembly.config.useWeightBrackets"
      :sort-by="p.assembly.config.sortBy"
      :active-weight-id="p.activeWeightId.value"
      :draft-weight="p.draftWeight.value"
      :weight-pos="p.weightPos.value"
      @clear="p.onSelectedClear()"
      @open-save="p.showSaveDialog.value = true"
      @toggle-settings="p.showSettings.value = !p.showSettings.value"
      @close-settings="p.showSettings.value = false"
      @separator-change="p.onSeparatorChange($event)"
      @bracket-toggle="p.onBracketToggle($event)"
      @sort-change="p.onSortChange($event)"
      @clear-search="p.keyword.value = ''"
      @drag-end="p.onDragEnd()"
      @update:drag="p.draggableSelected.value = $event"
      @card-click="(ev, id) => onSelectedCardClick(ev, id)"
      @weight-open="(id, cur, ev) => p.openWeightPopover(id, cur, ev)"
      @weight-confirm="p.confirmWeight($event)"
      @weight-cancel="p.cancelWeight()"
      @draft-input="p.onDraftInput($event)"
      @slider-input="p.onSliderInput($event)"
      @toggle-lock="p.onToggleLock($event)"
      @remove="p.onSelectedRemove($event)"
    />

    <DimensionEditDialog
      v-model:open="p.showDimDialog.value"
      :mode="p.dimDialogMode.value"
      :initial-dimension="p.editingDimension.value"
      @confirm="p.onDimConfirm"
    />

    <ModuleEditDialog
      v-model:open="p.showModuleDialog.value"
      :mode="p.moduleDialogMode.value"
      :dimensions="p.dimensions.value"
      :initial-dimension-id="p.newModuleDimId.value"
      :initial-module="p.editingModule.value"
      @confirm="p.onModuleConfirm"
    />

    <ModuleBatchDialog
      :open="p.showBatchDialog.value"
      :dimension="p.batchDimension.value"
      @update:open="p.showBatchDialog.value = $event"
      @imported="p.onBatchImported()"
    />

    <PromptPreviewDialog :open="p.previewOpen.value" :prompt="p.assembly.finalPrompt" :warnings="p.assembly.warnings" :ir="p.assembly.ir" @update:open="p.previewOpen.value = $event" />

    <SaveDialog :open="p.showSaveDialog.value" mode="assembly" @update:open="p.showSaveDialog.value = $event" @confirm="p.onSaveConfirm" />
    <SaveDialog :open="p.showTemplateDialog.value" mode="template" @update:open="p.showTemplateDialog.value = $event" @confirm="p.onTemplateConfirm" />

    <Teleport to="body">
      <div
        v-if="p.contextMenu.value"
        data-testid="dim-context-menu"
        :data-dim-key="p.contextMenu.value.key"
        class="fixed z-[70] w-52 rounded-md border bg-popover p-1 shadow-xl"
        :style="{ top: p.menuPos.value.top + 'px', left: p.menuPos.value.left + 'px' }"
        role="menu"
        @click.stop
      >
        <button
          :data-testid="`dim-ctx-translate-${p.contextMenu.value.key}`"
          role="menuitem"
          class="flex w-full items-center rounded px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
          :disabled="(p.modulesByDim.value[p.contextMenu.value.dim.id]?.length ?? 0) === 0"
          :title="(p.modulesByDim.value[p.contextMenu.value.dim.id]?.length ?? 0) === 0 ? '该维度暂无词条' : '批量翻译本维度中文描述'"
          @click="p.onTranslateFromMenu()"
        >批量翻译（中文描述）</button>
        <button
          :data-testid="`dim-ctx-generate-${p.contextMenu.value.key}`"
          role="menuitem"
          title="按倾向为该维度批量生成新片段"
          class="flex w-full items-center rounded px-3 py-2 text-left text-sm hover:bg-accent"
          @click="p.onGenerateFromMenu()"
        >片段批量生成</button>
        <button
          :data-testid="`dim-ctx-toggle-${p.contextMenu.value.key}`"
          role="menuitem"
          class="flex w-full items-center rounded px-3 py-2 text-left text-sm hover:bg-accent"
          :title="p.contextMenu.value.dim.isEnabled ? '禁用后不参与可控随机' : '启用后恢复参与可控随机'"
          @click="p.onToggleFromMenu()"
        >{{ p.contextMenu.value.dim.isEnabled ? '禁用维度' : '启用维度' }}</button>
        <div class="my-1 border-t" />
        <button
          :data-testid="`dim-ctx-clear-${p.contextMenu.value.key}`"
          role="menuitem"
          class="flex w-full items-center rounded px-3 py-2 text-left text-sm text-destructive hover:bg-accent disabled:opacity-50"
          :disabled="(p.modulesByDim.value[p.contextMenu.value.dim.id]?.length ?? 0) === 0"
          :title="(p.modulesByDim.value[p.contextMenu.value.dim.id]?.length ?? 0) === 0 ? '该维度暂无词条' : '删除本维度全部片段（不可恢复）'"
          @click="p.onClearFromMenu()"
        >清空维度内容…</button>
        <button
          :data-testid="`dim-ctx-migrate-${p.contextMenu.value.key}`"
          role="menuitem"
          class="flex w-full items-center rounded px-3 py-2 text-left text-sm text-destructive hover:bg-accent disabled:opacity-50"
          :disabled="(p.modulesByDim.value[p.contextMenu.value.dim.id]?.length ?? 0) === 0"
          :title="(p.modulesByDim.value[p.contextMenu.value.dim.id]?.length ?? 0) === 0 ? '空维度无需迁移' : '归档全部片段并重建空白维度'"
          @click="p.onMigrateFromMenu()"
        >迁移维度…</button>
        <div class="my-1 border-t" />
        <button :data-testid="`dim-ctx-copy-key-${p.contextMenu.value.key}`" role="menuitem" class="flex w-full rounded px-3 py-1.5 text-left text-xs hover:bg-accent" @click="p.onCopyDimKey(p.contextMenu.value.key)">复制维度键名</button>
        <button :data-testid="`dim-ctx-copy-name-${p.contextMenu.value.key}`" role="menuitem" class="flex w-full rounded px-3 py-1.5 text-left text-xs hover:bg-accent" @click="p.onCopyDimName(p.contextMenu.value.dim.nameCn)">复制维度中文名</button>
      </div>
    </Teleport>
    <DimensionTranslateDialog
      :open="p.showTranslateDialog.value"
      :dimension="p.translateTarget.value?.dim ?? null"
      :modules="p.translateTarget.value?.modules ?? []"
      @update:open="p.showTranslateDialog.value = $event"
      @applied="() => { /* library 已通过事件刷新 */ }"
    />

    <DimensionGenerateDialog
      :open="p.showGenerateDialog.value"
      :dimension="p.generateTarget.value?.dim ?? null"
      :modules="p.generateTarget.value?.modules ?? []"
      @update:open="p.showGenerateDialog.value = $event"
      @imported="() => { /* library 已通过事件刷新 */ }"
    />

    <div
      v-if="p.clearConfirmOpen.value"
      data-testid="clear-confirm-dialog"
      role="dialog"
      aria-label="清空维度"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      @click.self="p.closeClearConfirm()"
    >
      <div class="w-[420px] rounded-lg border bg-card p-4 shadow-xl">
        <h3 class="text-sm font-semibold">清空维度</h3>
        <p class="mt-2 text-sm">该维度现有 {{ p.clearCount.value }} 条片段，清空后不可恢复。</p>
        <p v-if="p.clearSelectedK.value > 0" class="mt-1 text-sm text-muted-foreground">其中 {{ p.clearSelectedK.value }} 条正在“已选”中，将一并移出已选。</p>
        <label class="mt-3 flex items-center gap-2 text-sm">
          <input v-model="p.clearAgreed.value" type="checkbox" data-testid="clear-confirm-check" :disabled="p.clearing.value" />
          <span>我已确认要删除全部 {{ p.clearCount.value }} 条</span>
        </label>
        <div class="mt-4 flex justify-end gap-1">
          <el-button data-testid="clear-confirm-cancel" text size="small" :disabled="p.clearing.value" @click="p.closeClearConfirm()">取消</el-button>
          <el-button data-testid="clear-confirm-btn" type="danger" size="small" :disabled="!p.clearAgreed.value || p.clearing.value" @click="p.doClearDimension()">{{ p.clearing.value ? '清空中…' : `确认清空（${p.clearCount.value} 条）` }}</el-button>
        </div>
      </div>
    </div>

    <DimensionMigrateDialog
      :open="p.migrateOpen.value"
      :dimension="p.migrateTarget.value"
      :count="p.migrateCount.value"
      :selected-count="p.migrateSelectedK.value"
      :busy="p.migrating.value"
      @update:open="p.migrateOpen.value = $event"
      @confirm="p.doMigrateDimension()"
    />

    <Teleport to="body">
      <div v-if="p.activeWeightId.value" data-testid="selected-weight-popover" class="hidden" />
    </Teleport>
  </section>
</template>
