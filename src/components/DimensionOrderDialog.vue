<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useOverlayClose } from '@/composables/useOverlayClose'
import { useLibraryStore } from '@/stores/library'
import { dbUpdateDimension } from '@/lib/db/dimensions'
import { emit as emitLib, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import { notify } from '@/lib/notify'
import { logger } from '@/lib/logger'
import { calcInsertIndex } from '@/lib/orderDrag'
import type { Dimension } from '@/engine/models'

const props = defineProps<{
  open: boolean
  /** 全量维度（调用方传 library.dimensions，不要传 keyword 过滤后的） */
  dimensions: Dimension[]
}>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'applied', order: { id: string; sortOrder: number }[]): void
}>()

const library = useLibraryStore()
const saving = ref(false)
const localOrder = ref<Dimension[]>([])
const openSnapshot = ref<string>('')
/** 单选中的行 id（同时最多一个；按 id 存，移动后跟随行走） */
const selectedId = ref<string | null>(null)

function snapshotOf(list: Dimension[]): string {
  return list.map((d) => d.id).join('')
 }
 watch(
   () => props.open,
   (v) => {
     if (!v) return
     localOrder.value = [...props.dimensions].sort((a, b) => a.sortOrder - b.sortOrder)
     openSnapshot.value = snapshotOf(localOrder.value)
     selectedId.value = null
     // 注：open 翻 true 时不可能有进行中的拖拽（拖拽只能在 open 时发起），
     // 故不在此调 cancelDrag（其引用的 draggingId 声明在后，会触发 TDZ）
   },
   { immediate: true },
 )

const dirty = computed(() => snapshotOf(localOrder.value) !== openSnapshot.value)

function onClose(): void {
  if (saving.value) return
  cancelDrag()
  emit('update:open', false)
}

const oc = useOverlayClose(onClose, { open: computed(() => props.open), isBusy: saving })

function resetOrder(): void {
  const byId = new Map(localOrder.value.map((d) => [d.id, d]))
  const ids = openSnapshot.value ? openSnapshot.value.split('') : []
  const restored: Dimension[] = []
  for (const id of ids) {
    const d = byId.get(id)
    if (d) restored.push(d)
  }
  // 打开期间新增的维度追加末尾
  for (const d of localOrder.value) {
    if (!ids.includes(d.id)) restored.push(d)
  }
  localOrder.value = restored
  if (selectedId.value != null && !restored.some((d) => d.id === selectedId.value)) selectedId.value = null
}

function moveUp(i: number): void {
  if (saving.value || i <= 0) return
  const arr = [...localOrder.value]
  const t = arr[i - 1]!
  arr[i - 1] = arr[i]!
  arr[i] = t
  localOrder.value = arr
}

function moveDown(i: number): void {
  if (saving.value || i >= localOrder.value.length - 1) return
  const arr = [...localOrder.value]
  const t = arr[i + 1]!
  arr[i + 1] = arr[i]!
  arr[i] = t
  localOrder.value = arr
}

// —— 单选框：再点取消，同时最多选中一个 ——
function toggleSelect(id: string): void {
  if (saving.value || draggingId.value != null) return
  selectedId.value = selectedId.value === id ? null : id
}

// —— 方向键移动选中行（仅 ↑↓；忽略组合键/输入框/IME） ——
function onKeyDown(e: KeyboardEvent): void {
  if (!props.open || saving.value || draggingId.value != null) return
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if ((e as KeyboardEvent & { isComposing?: boolean }).isComposing) return
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  if (selectedId.value == null) return
  const idx = localOrder.value.findIndex((d) => d.id === selectedId.value)
  if (idx < 0) return
  e.preventDefault()
  if (e.key === 'ArrowUp') moveUp(idx)
  else moveDown(idx)
}

watch(
  () => props.open,
  (v) => {
    if (typeof window === 'undefined') return
    window.removeEventListener('keydown', onKeyDown)
    if (v) window.addEventListener('keydown', onKeyDown)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeyDown)
  detachDragListeners()
})

// —— 方案B：指针手写拖拽（不依赖原生 HTML5 DnD / Sortable） ——
const listRef = ref<HTMLElement | null>(null)
const draggingId = ref<string | null>(null)
const dragFrom = ref(0)
const dragTarget = ref(0)
const dragDy = ref(0)
const dragH = ref(0)
 let dragAnchorY = 0
 let dragPointerId: number | null = null

function rowEls(): HTMLElement[] {
  if (!listRef.value) return []
  return Array.from(listRef.value.querySelectorAll<HTMLElement>('[data-testid="dimension-order-row"]'))
}

 function onHandlePointerDown(e: PointerEvent, id: string): void {
   if (saving.value || draggingId.value != null) return
   if (e.button !== 0) return
   const idx = localOrder.value.findIndex((d) => d.id === id)
   if (idx < 0) return
   e.preventDefault()
   const els = rowEls()
   dragH.value = els[idx]?.getBoundingClientRect().height || 0
   dragAnchorY = e.clientY
   dragPointerId = e.pointerId
   dragFrom.value = idx
   dragTarget.value = idx
   dragDy.value = 0
   draggingId.value = id
   try {
     ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
   } catch {
     /* jsdom 无 setPointerCapture，忽略 */
   }
   if (typeof window !== 'undefined') {
     window.addEventListener('pointermove', onDragMove)
     window.addEventListener('pointerup', onDragEnd)
     window.addEventListener('pointercancel', onDragEnd)
   }
 }
 
 function onDragMove(e: PointerEvent): void {
   if (draggingId.value == null) return
   if (dragPointerId != null && e.pointerId !== dragPointerId) return
   dragDy.value = e.clientY - dragAnchorY
   // 边缘自动滚动
   const cont = listRef.value
   if (cont) {
     const r = cont.getBoundingClientRect()
     if (e.clientY < r.top + 48) cont.scrollTop -= 12
     else if (e.clientY > r.bottom - 48) cont.scrollTop += 12
   }
   const rects = rowEls().map((el) => {
     const r = el.getBoundingClientRect()
     return { top: r.top, height: r.height }
   })
   dragTarget.value = calcInsertIndex(e.clientY, rects, dragFrom.value)
 }

function onDragEnd(e: PointerEvent): void {
  if (draggingId.value == null) return
  if (dragPointerId != null && e.pointerId !== dragPointerId && e.type !== 'pointercancel') return
  detachDragListeners()
  const id = draggingId.value
  const from = dragFrom.value
  const to = dragTarget.value
  draggingId.value = null
  dragPointerId = null
  dragDy.value = 0
  if (to !== from) {
    const arr = [...localOrder.value]
    const [item] = arr.splice(from, 1)
    arr.splice(to, 0, item!)
    localOrder.value = arr
    selectedId.value = id // 拖拽行保持选中跟随，键盘可继续微调
  }
}

function detachDragListeners(): void {
  if (typeof window === 'undefined') return
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointercancel', onDragEnd)
}

function cancelDrag(): void {
  detachDragListeners()
  draggingId.value = null
  dragPointerId = null
  dragDy.value = 0
}

/** 拖拽中的行位移（含被拖行跟随指针、其余行让位） */
function rowStyle(i: number, id: string): Record<string, string> {
  if (draggingId.value == null) return {}
  const from = dragFrom.value
  const to = dragTarget.value
  if (id === draggingId.value) {
    return {
      transform: `translateY(${dragDy.value}px)`,
      transition: 'none',
      zIndex: '10',
    }
  }
  const h = dragH.value || 0
  if (from < to && i > from && i <= to) {
    return { transform: `translateY(${-h}px)`, transition: 'transform 150ms' }
  }
  if (from > to && i >= to && i < from) {
    return { transform: `translateY(${h}px)`, transition: 'transform 150ms' }
  }
  return { transition: 'transform 150ms' }
}

/** 拖拽预览位序：被拖行显示目标位，其余让位行 ∓1 */
function displayIndex(i: number, id: string): number {
  if (draggingId.value == null) return i + 1
  const from = dragFrom.value
  const to = dragTarget.value
  if (id === draggingId.value) return to + 1
  if (from < to && i > from && i <= to) return i
  if (from > to && i >= to && i < from) return i + 2
  return i + 1
}

async function onSave(): Promise<void> {
  if (saving.value || !dirty.value) return
  // 打开后维度集合变化（增删）则放弃保存，避免排错位
  const openIds = new Set(localOrder.value.map((d) => d.id))
  const curIds = new Set(props.dimensions.map((d) => d.id))
  if (openIds.size !== curIds.size || [...openIds].some((id) => !curIds.has(id))) {
    notify('维度列表已变化，请关闭重开后再排序', 'warning')
    return
  }
  // S1 稠密重编号：sortOrder = 拖后下标（0-based）
  const next = localOrder.value.map((d, i) => ({ ...d, sortOrder: i }))
  const memSnapshot = [...library.dimensions]
  library.dimensions = [...next].sort((a, b) => a.sortOrder - b.sortOrder)
  saving.value = true
  try {
    for (const d of next) await dbUpdateDimension(d)
    emit('applied', next.map(({ id, sortOrder }) => ({ id, sortOrder })))
    emit('update:open', false)
    await library.fetchAll()
    emitLib(LIBRARY_CHANGED, { source: 'dimension-panel', op: 'reorder-dimensions' })
    notify('维度顺序已保存', 'success', 1500)
  } catch (e) {
    logger.warn('DimensionOrder', 'save失败回滚', e)
    try {
      await library.fetchAll()
    } catch (err) {
      logger.warn('DimensionOrder', 'fetchAll降级用内存快照', err)
      library.dimensions = memSnapshot
    }
    notify(`保存失败，已按数据库刷新（部分可能已写入）：${String(e)}`, 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div
    v-if="open"
    data-testid="dimension-order-overlay"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    @mousedown="oc.onMouseDown"
    @click="oc.onClick"
  >
    <div
      data-testid="dimension-order-dialog"
      role="dialog"
      aria-label="维度排序"
      class="flex max-h-[80vh] w-[480px] max-w-full flex-col rounded-lg border bg-card shadow-xl"
      @click.stop
    >
      <div class="flex items-center justify-between border-b px-4 py-3">
        <h2 class="text-sm font-semibold">
          维度排序
          <span class="ml-2 text-xs font-normal text-muted-foreground">拖拽或选中后按 ↑↓ 调整，保存后全局生效</span>
        </h2>
        <el-button data-testid="dimension-order-close" text size="small" :disabled="saving" @click="onClose">✕</el-button>
      </div>
      <div
        v-if="localOrder.length > 0"
        ref="listRef"
        data-testid="dimension-order-list"
        role="list"
        aria-label="维度顺序"
        class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3"
      >
        <div
          v-for="(d, i) in localOrder"
          :key="d.id"
          data-testid="dimension-order-row"
          :data-dim-key="d.key"
          role="option"
          :aria-selected="selectedId === d.id"
          class="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-sm"
          :class="{
            'ring-1 ring-primary bg-accent': selectedId === d.id,
            'opacity-90 shadow-lg cursor-grabbing': draggingId === d.id,
          }"
          :style="rowStyle(i, d.id)"
        >
          <button
            :data-testid="`dimension-order-select-${d.key}`"
            class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs leading-none hover:bg-accent"
            :class="selectedId === d.id ? 'border-primary text-primary' : 'text-muted-foreground'"
            :aria-pressed="selectedId === d.id"
            :title="selectedId === d.id ? '已选中，再点取消；可用 ↑ / ↓ 移动' : '选中后可用 ↑ / ↓ 移动'"
            :disabled="saving"
            @click="toggleSelect(d.id)"
          >{{ selectedId === d.id ? '●' : '○' }}</button>
          <span
            class="drag-handle cursor-grab touch-none select-none text-muted-foreground hover:text-foreground"
            :data-testid="`dimension-order-handle-${d.key}`"
            title="按住拖拽排序"
            @pointerdown="onHandlePointerDown($event, d.id)"
          >⋮⋮</span>
          <span data-testid="dimension-order-index" class="w-6 shrink-0 text-center font-mono text-xs text-muted-foreground">{{ displayIndex(i, d.id) }}</span>
          <span class="min-w-0 flex-1 truncate" :title="`${d.nameCn} / ${d.key}`">{{ d.nameCn }} / {{ d.key }}</span>
          <el-tag v-if="!d.isEnabled" size="small" type="info">禁用</el-tag>
          <button
            :data-testid="`dimension-order-up-${d.key}`"
            class="rounded px-1 hover:bg-accent disabled:opacity-40"
            :disabled="saving || i === 0"
            title="上移"
            @click="moveUp(i)"
          >↑</button>
          <button
            :data-testid="`dimension-order-down-${d.key}`"
            class="rounded px-1 hover:bg-accent disabled:opacity-40"
            :disabled="saving || i === localOrder.length - 1"
            title="下移"
            @click="moveDown(i)"
          >↓</button>
        </div>
      </div>
      <div v-else class="flex flex-1 flex-col items-center justify-center gap-2 p-8">
        <el-empty description="暂无维度，去新建维度" />
      </div>
      <div class="flex justify-end gap-2 border-t px-4 py-3">
        <el-button data-testid="dimension-order-reset" plain size="small" :disabled="saving || !dirty" @click="resetOrder">恢复打开时顺序</el-button>
        <el-button data-testid="dimension-order-cancel" text size="small" :disabled="saving" @click="onClose">取消</el-button>
        <el-button data-testid="dimension-order-confirm" type="primary" size="small" :loading="saving" :disabled="!dirty" @click="onSave">保存排序</el-button>
      </div>
    </div>
  </div>
</template>
