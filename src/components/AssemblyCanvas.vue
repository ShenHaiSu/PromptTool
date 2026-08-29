<script setup lang="ts">
import { ref, computed } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useAssemblyStore } from '@/stores/assembly'
import { useHistoryStore } from '@/stores/history'
import { useToast } from '@/composables/useToast'
import { dimColor } from '@/lib/utils'
import SaveDialog from '@/components/SaveDialog.vue'

const assembly = useAssemblyStore()
const history = useHistoryStore()
const { push } = useToast()

const showSaveDialog = ref(false)
const showTemplateDialog = ref(false)

// 权重 Popover：本地受控，确认后才写回 store（避免每像素 reassemble）
const activeWeightId = ref<string | null>(null)
const draftWeight = ref<number>(1.0)

function openWeightPopover(moduleId: string, current: number): void {
  activeWeightId.value = moduleId
  draftWeight.value = current
}

function confirmWeight(moduleId: string): void {
  const v = clampWeight(draftWeight.value)
  assembly.updateWeight(moduleId, v === 1.0 ? null : v)
  activeWeightId.value = null
}

function cancelWeight(): void {
  activeWeightId.value = null
}

function clampWeight(v: number): number {
  if (!Number.isFinite(v)) return 1.0
  return Math.min(2.0, Math.max(0.5, Math.round(v * 10) / 10))
}

function onDraftInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value
  const n = parseFloat(raw)
  draftWeight.value = Number.isFinite(n) ? n : draftWeight.value
}

function onSliderInput(e: Event): void {
  const n = parseFloat((e.target as HTMLInputElement).value)
  if (Number.isFinite(n)) draftWeight.value = Math.round(n * 10) / 10
}

// 设置弹层（分隔符 / 权重括号 / 排序）
const showSettings = ref(false)

const separatorOptions: Array<{ label: string; value: string }> = [
  { label: '逗号 , ', value: ', ' },
  { label: 'BREAK', value: ' BREAK ' },
  { label: '换行 \\n', value: '\n' },
]

const sortOptions: Array<{ label: string; value: 'dimensionOrder' | 'customDragOrder' }> = [
  { label: '维度顺序', value: 'dimensionOrder' },
  { label: '自定义拖拽', value: 'customDragOrder' },
]

function onSeparatorChange(e: Event): void {
  const v = (e.target as HTMLSelectElement).value
  assembly.setConfig({ separator: v })
  push('分隔符已更新', 'success', 1500)
}

function onBracketToggle(e: Event): void {
  const checked = (e.target as HTMLInputElement).checked
  assembly.setConfig({ useWeightBrackets: checked })
  push(checked ? '已启用权重括号' : '已关闭权重括号', 'success', 1500)
}

function onSortChange(e: Event): void {
  const v = (e.target as HTMLSelectElement).value as 'dimensionOrder' | 'customDragOrder'
  assembly.setConfig({ sortBy: v })
  push(v === 'customDragOrder' ? '已切换为自定义拖拽顺序' : '已切换为维度顺序', 'success', 1500)
}

// v-model 绑定：拖拽排序直接同步到 store
const draggableItems = computed({
  get: () => assembly.selectedItems,
  set: (val) => assembly.setSelected(val as typeof assembly.selectedItems),
})

function onDragEnd(): void {
  // vue-draggable-plus 已通过 v-model 同步顺序；setSelected 已触发 reassemble
}

function onRemove(id: string): void {
  assembly.removeModule(id)
}

function onToggleLock(id: string): void {
  assembly.toggleLocked(id)
}

function onClear(): void {
  assembly.clear()
  push('已清空画布', 'info', 1500)
}

function onCopy(): void {
  if (!assembly.finalPrompt) {
    push('暂无可复制 Prompt', 'warning')
    return
  }
  navigator.clipboard
    .writeText(assembly.finalPrompt)
    .then(() => push('已复制', 'success', 1500))
    .catch(() => push('复制失败', 'error'))
}

async function doSave(title: string | null, isFavorite: boolean): Promise<void> {
  if (!assembly.finalPrompt && assembly.selectedItems.length === 0) {
    push('空方案暂不保存 — 请先添加词条', 'warning')
    return
  }
  const irJson = JSON.stringify(assembly.ir.toJSON())
  try {
    await history.save(title, irJson, assembly.finalPrompt, assembly.config, [...assembly.selectedItems], isFavorite)
    push(isFavorite ? '已收藏并保存' : '已保存方案', 'success', 1500)
  } catch (e) {
    push(`保存失败: ${String(e)}`, 'error')
  }
}

function onSaveClick(): void {
  if (!assembly.finalPrompt && assembly.selectedItems.length === 0) {
    push('空方案暂不保存 — 请先添加词条', 'warning')
    return
  }
  showSaveDialog.value = true
}

async function onSaveConfirm(payload: { name: string; desc: string | null }): Promise<void> {
  await doSave(payload.name.trim() || null, false)
}

async function onSaveFavorite(): Promise<void> {
  await doSave(null, true)
}

async function onTemplateConfirm(payload: { name: string; desc: string | null }): Promise<void> {
  const name = payload.name.trim()
  if (!name) { push('模板名称不能为空', 'warning'); return }
  if (assembly.selectedItems.length === 0) { push('模板内容为空，请先配置画布', 'warning'); return }
  if (assembly.selectedItems.some((it) => !it.module.dimensionKey?.trim())) { push('存在缺失分类的词条，无法存为模板', 'error'); return }
  const enabledKeys = [...new Set(assembly.selectedItems.map((it) => it.module.dimensionKey).filter(Boolean) as string[])]
  try {
    await history.saveTemplate(name, payload.desc, assembly.config, enabledKeys, assembly.finalPrompt || null, [...assembly.selectedItems])
    push('已另存为模板', 'success', 1500)
  } catch (e) { push(`保存模板失败: ${String(e)}`, 'error') }
}
</script>

<template>
  <section data-testid="assembly-canvas" class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <!-- 头部：标题 + 计数 + ...设置 -->
    <div class="flex h-9 shrink-0 items-center justify-between border-b px-3">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold">拼装画布</h2>
        <Badge data-testid="assembly-count" variant="secondary" class="text-xs"
          >{{ assembly.selectedItems.length }} 已选</Badge
        >
      </div>
      <div class="flex items-center gap-1">
        <Button
          v-if="assembly.selectedItems.length"
          data-testid="assembly-save-btn"
          variant="default"
          size="sm"
          class="h-7 px-2 text-xs"
          title="保存方案（Ctrl+S）"
          @click="onSaveClick"
          >保存方案</Button
        >
        <Button
          v-if="assembly.selectedItems.length"
          data-testid="assembly-fav-save-btn"
          variant="outline"
          size="sm"
          class="h-7 px-2 text-xs"
          title="收藏并保存"
          @click="onSaveFavorite"
          >★ 收藏并保存</Button
        >
        <Button
          data-testid="assembly-template-btn"
          variant="outline"
          size="sm"
          class="h-7 px-2 text-xs"
          title="另存为模板"
          :disabled="!assembly.selectedItems.length"
          @click="showTemplateDialog = true"
          >另存为模板</Button
        >
        <Button
          v-if="assembly.selectedItems.length"
          data-testid="assembly-clear-btn"
          variant="ghost"
          size="sm"
          class="h-7 px-2 text-xs"
          @click="onClear"
          >清空</Button
        >
        <Button
          v-if="assembly.selectedItems.length"
          data-testid="assembly-copy-btn"
          variant="outline"
          size="sm"
          class="h-7 px-2 text-xs"
          @click="onCopy"
          >复制 Prompt</Button
        >
        <div class="relative">
          <Button
            data-testid="assembly-settings-btn"
            variant="ghost"
            size="sm"
            class="h-7 px-2 text-xs"
            title="分隔符 / 权重括号 / 排序设置"
            @click="showSettings = !showSettings"
            >… 设置</Button
          >
          <!-- 设置弹层 -->
          <div
            v-if="showSettings"
            data-testid="assembly-settings-panel"
            class="absolute right-0 top-8 z-20 w-64 rounded-md border bg-popover p-3 shadow-lg"
          >
            <p class="mb-2 text-xs font-semibold">拼装设置</p>
            <div class="space-y-3">
              <label class="flex flex-col gap-1">
                <span class="text-xs text-muted-foreground">分隔符</span>
                <select
                  data-testid="setting-separator"
                  class="h-8 rounded-md border bg-background px-2 text-sm"
                  :value="assembly.config.separator"
                  @change="onSeparatorChange"
                >
                  <option v-for="o in separatorOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </label>
              <label class="flex items-center justify-between gap-2">
                <span class="text-xs text-muted-foreground">权重括号</span>
                <input
                  data-testid="setting-brackets"
                  type="checkbox"
                  class="h-4 w-4 accent-primary"
                  :checked="assembly.config.useWeightBrackets"
                  @change="onBracketToggle"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-xs text-muted-foreground">排序</span>
                <select
                  data-testid="setting-sortBy"
                  class="h-8 rounded-md border bg-background px-2 text-sm"
                  :value="assembly.config.sortBy"
                  @change="onSortChange"
                >
                  <option v-for="o in sortOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </label>
            </div>
            <div class="mt-3 flex justify-end">
              <Button size="sm" variant="outline" class="h-7 text-xs" @click="showSettings = false">关闭</Button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-if="assembly.selectedItems.length === 0"
      data-testid="assembly-empty"
      class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <div class="text-2xl text-muted-foreground">◈</div>
      <p class="text-sm font-medium">空画布</p>
      <p class="max-w-[22rem] text-xs text-muted-foreground">从左侧双击添加词条 — 权重、锁定与拖拽排序在这里完成</p>
      <Card class="mt-1 w-full max-w-sm">
        <CardHeader class="p-3 pb-1">
          <CardTitle class="text-xs">示例 Chip</CardTitle>
          <CardDescription class="text-xs">权重 1.2 · 锁定 · 拖拽排序</CardDescription>
        </CardHeader>
        <CardContent class="p-3 pt-0">
          <div class="flex flex-wrap gap-2">
            <Badge>示例</Badge>
            <Badge variant="outline">w1.2</Badge>
            <Badge variant="secondary">🔒 锁定</Badge>
          </div>
        </CardContent>
      </Card>
      <Button data-testid="assembly-empty-random" size="sm" variant="outline" class="mt-1" @click="push('从批量工厂随机生成试试', 'info', 1800)"
        >试试随机生成</Button
      >
    </div>

    <!-- Chips 流式布局 + 拖拽 -->
    <div v-else class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="flex-1 overflow-y-auto p-2" data-testid="assembly-chips-scroll">
        <VueDraggable
          v-model="draggableItems"
          data-testid="assembly-draggable"
          class="flex flex-wrap gap-2"
          :animation="150"
          ghost-class="opacity-40"
          chosen-class="ring-1 ring-primary"
          handle=".drag-handle"
          @end="onDragEnd"
        >
          <div
            v-for="it in assembly.selectedItems"
            :key="it.module.id"
            data-testid="assembly-chip"
            :data-module-id="it.module.id"
            class="group inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-1.5 text-xs shadow-sm hover:shadow"
            :title="it.module.contentEn"
          >
            <span class="drag-handle cursor-grab select-none text-muted-foreground hover:text-foreground" title="拖拽排序">⋮⋮</span>
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              :style="{ background: dimColor(it.module.dimensionKey ?? '') }"
              :title="it.module.dimensionKey ?? ''"
            />
            <span class="max-w-[10rem] truncate font-medium">{{ it.module.displayName }}</span>

            <!-- 权重 pill：点击弹 Popover -->
            <button
              data-testid="chip-weight-btn"
              class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent"
              :title="`权重 ${(it.weightOverride ?? it.module.weight).toFixed(1)} — 点击修改`"
              @click="openWeightPopover(it.module.id, it.weightOverride ?? it.module.weight)"
            >
              w{{ (it.weightOverride ?? it.module.weight).toFixed(1) }}
            </button>

            <!-- 权重 Popover：本地 draft，确认后才写回 -->
            <div
              v-if="activeWeightId === it.module.id"
              data-testid="chip-weight-popover"
              class="absolute z-20 mt-8 flex w-56 flex-col gap-2 rounded-md border bg-popover p-3 shadow-xl"
              @click.stop
            >
              <p class="text-xs font-medium">权重 0.5 – 2.0 · 步进 0.1</p>
              <div class="flex items-center gap-2">
                <input
                  data-testid="weight-slider"
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  :value="String(draftWeight)"
                  class="flex-1 accent-primary"
                  @input="onSliderInput"
                />
                <span class="w-8 text-center font-mono text-xs">{{ draftWeight.toFixed(1) }}</span>
              </div>
              <div class="flex items-center gap-2">
                <Input
                  data-testid="weight-input"
                  type="number"
                  :model-value="String(draftWeight)"
                  :value="String(draftWeight)"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  class="h-7 flex-1 text-xs"
                  @input="onDraftInput"
                />
              </div>
              <div class="flex justify-end gap-1.5">
                <Button size="sm" variant="ghost" class="h-7 text-xs" data-testid="weight-cancel" @click="cancelWeight">取消</Button>
                <Button size="sm" class="h-7 text-xs" data-testid="weight-confirm" @click="confirmWeight(it.module.id)">确定</Button>
              </div>
              <p class="text-[11px] text-muted-foreground">确认后 TopBar 同步为 <span class="font-mono">(text:1.4)</span> 等</p>
            </div>

            <button
              data-testid="chip-lock-btn"
              class="rounded px-1 hover:bg-accent"
              :title="it.locked ? '已锁定 — 随机时保留' : '未锁定 — 点击锁定'"
              @click="onToggleLock(it.module.id)"
            >
              {{ it.locked ? '🔒' : '🔓' }}
            </button>
            <button
              data-testid="chip-remove-btn"
              class="rounded px-1 hover:bg-accent hover:text-destructive"
              title="移除"
              @click="onRemove(it.module.id)"
            >
              ✕
            </button>
          </div>
        </VueDraggable>
      </div>
    </div>

    <!-- 弹窗 -->
    <SaveDialog :open="showSaveDialog" mode="assembly" :initial-name="''" @update:open="showSaveDialog = $event" @confirm="onSaveConfirm" />
    <SaveDialog :open="showTemplateDialog" mode="template" @update:open="showTemplateDialog = $event" @confirm="onTemplateConfirm" />
  </section>
</template>
