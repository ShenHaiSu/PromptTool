import { ref, computed, watch, nextTick, onBeforeUnmount, onMounted } from 'vue'
import { useAssemblyStore } from '@/stores/assembly'
import { useHistoryStore } from '@/stores/history'
import { notify } from '@/lib/notify'
import { logger } from '@/lib/logger'
import { emit, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import {
  dbCreateDimension, dbUpdateDimension,
  dbCreateModule, dbUpdateModule, dbSoftDeleteModule, dbClearDimension, dbMigrateDimension,
} from '@/lib/db'
import type { Dimension, Module } from '@/engine/models'
import { calcPopoverPos, POPOVER_W, POPOVER_H_EST, MENU_W, MENU_H_EST, calcMenuPos } from '@/lib/need05Position'
import { useLibraryStore } from '@/stores/library'
import { useDimensionPanelStore } from '@/stores/dimensionPanel'

/** DimensionPanel 全量逻辑（EP化：无 ui/* 引用，空 catch 收敛为 logger） */
export function useDimensionPanel() {
  const assembly = useAssemblyStore()
  const history = useHistoryStore()
  const library = useLibraryStore()
  const panelStore = useDimensionPanelStore()

  const keyword = ref('')
  const allowNsfw = ref(false)
  const dimensions = computed(() => library.dimensions)
  const rawGrouped = computed(() => library.modulesByDim as Record<string, Module[]>)
  // 结果与上次等价时复用旧引用，避免消费方（列表/滚动容器）因引用变化整体失效重绘
  let modulesByDimCache: Record<string, Module[]> | null = null
  function sameGrouped(a: Record<string, Module[]>, b: Record<string, Module[]>): boolean {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    for (const k of ka) {
      const la = a[k]
      const lb = b[k]
      if (!lb || !la || la.length !== lb.length) return false
      for (let i = 0; i < la.length; i++) {
        if (la[i] !== lb[i]) return false
      }
    }
    return true
  }
  const modulesByDim = computed<Record<string, Module[]>>(() => {
    const grouped = rawGrouped.value
    const out: Record<string, Module[]> = {}
    for (const d of library.dimensions) {
      const byId = grouped[d.id]
      const byKey = grouped[d.key]
      if (byId) out[d.id] = byId
      else if (byKey) out[d.id] = byKey
      else out[d.id] = []
    }
    for (const [k, v] of Object.entries(grouped)) {
      const dim = library.dimensions.find((d) => d.id === k)
      if (dim && !out[dim.id]) out[dim.id] = v
    }
    if (modulesByDimCache && sameGrouped(modulesByDimCache, out)) return modulesByDimCache
    modulesByDimCache = out
    return out
  })
  const loading = computed(() => library.loading)

  watch(() => library.dimensions.map((d) => d.key).join(''), () => {
    const valid = new Set(library.dimensions.map((d) => d.key))
    panelStore.prune(valid)
  })

  type DimPanelMode = 'browse' | 'selected'
  function loadMode(): DimPanelMode {
    try {
      const v = localStorage.getItem('pmf:dimPanelMode')
      if (v === 'browse' || v === 'selected') return v
    } catch (err) { logger.warn('DimensionPanel', 'loadMode', err) }
    return 'browse'
  }
  const dimPanelMode = ref<DimPanelMode>(loadMode())
  watch(dimPanelMode, (v) => { try { localStorage.setItem('pmf:dimPanelMode', v) } catch (err) { logger.warn('DimensionPanel', 'persistMode', err) } })
  const previewOpen = ref(false)
  const selectedCount = computed(() => assembly.selectedItems.length)
  const filteredSelected = computed(() => {
    const kw = keyword.value.trim().toLowerCase()
    if (!kw) return assembly.selectedItems
    return assembly.selectedItems.filter((it) => {
      const m = it.module
      const dim = dimensions.value.find((d) => d.id === m.dimensionId)
      return m.displayName.toLowerCase().includes(kw)
        || m.contentEn.toLowerCase().includes(kw)
        || (m.dimensionKey ?? '').toLowerCase().includes(kw)
        || (dim?.nameCn ?? '').toLowerCase().includes(kw)
    })
  })
  const draggableSelected = computed({
    get: () => assembly.selectedItems,
    set: (val) => assembly.setSelected(val as typeof assembly.selectedItems),
  })

  const activeWeightId = ref<string | null>(null)
  const draftWeight = ref(1.0)
  const weightPos = ref<{ top: number; left: number }>({ top: 0, left: 0 })
  const weightAnchorEl = ref<HTMLElement | null>(null)
  function clampWeight(v: number): number { if (!Number.isFinite(v)) return 1.0; return Math.min(2.0, Math.max(0.5, Math.round(v * 10) / 10)) }
  function openWeightPopover(id: string, cur: number, evt?: MouseEvent): void {
    activeWeightId.value = id
    draftWeight.value = cur
    const el = (evt?.currentTarget as HTMLElement) ?? (typeof document !== 'undefined' ? document.querySelector<HTMLElement>(`[data-testid="selected-weight-btn"][data-module-id="${id}"]`) : null)
    const rect = (el as HTMLElement | null)?.getBoundingClientRect?.() ?? null
    if (rect) {
      weightAnchorEl.value = el as HTMLElement | null
      weightPos.value = calcPopoverPos(rect, POPOVER_W, POPOVER_H_EST, typeof window !== 'undefined' ? window.innerWidth : 1024, typeof window !== 'undefined' ? window.innerHeight : 768)
      nextTick(() => {
        const popEl = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('[data-testid="selected-weight-popover"]') : null
        if (popEl && rect) {
          const h = popEl.getBoundingClientRect().height || POPOVER_H_EST
          weightPos.value = calcPopoverPos(rect, POPOVER_W, h, typeof window !== 'undefined' ? window.innerWidth : 1024, typeof window !== 'undefined' ? window.innerHeight : 768)
        }
      })
    }
  }
  function closeWeightPopover(): void { activeWeightId.value = null; weightAnchorEl.value = null }
  function confirmWeight(id: string): void { const v = clampWeight(draftWeight.value); assembly.updateWeight(id, v === 1 ? null : v); closeWeightPopover() }
  function cancelWeight(): void { closeWeightPopover() }
  function onDraftInput(e: Event): void {
    const raw = (e.target as HTMLInputElement).value
    const n = parseFloat(raw)
    draftWeight.value = Number.isFinite(n) ? n : draftWeight.value
  }
  function onSliderInput(e: Event): void {
    const n = parseFloat((e.target as HTMLInputElement).value)
    if (Number.isFinite(n)) draftWeight.value = Math.round(n * 10) / 10
  }
  function onDocClickForPopover(e: MouseEvent): void {
    if (!activeWeightId.value) return
    const pop = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('[data-testid="selected-weight-popover"]') : null
    const btn = weightAnchorEl.value
    if (pop?.contains(e.target as Node) || btn?.contains(e.target as Node)) return
    closeWeightPopover()
  }
  function onDocKeydownForPopover(e: KeyboardEvent): void { if (e.key === 'Escape' && activeWeightId.value) closeWeightPopover() }
  function onScrollOrResizeForPopover(): void { if (activeWeightId.value) closeWeightPopover() }
  watch(activeWeightId, (v) => {
    if (typeof document === 'undefined') return
    if (v) {
      document.addEventListener('click', onDocClickForPopover)
      document.addEventListener('keydown', onDocKeydownForPopover)
      window.addEventListener('scroll', onScrollOrResizeForPopover, true)
      window.addEventListener('resize', onScrollOrResizeForPopover)
    } else {
      document.removeEventListener('click', onDocClickForPopover)
      document.removeEventListener('keydown', onDocKeydownForPopover)
      window.removeEventListener('scroll', onScrollOrResizeForPopover, true)
      window.removeEventListener('resize', onScrollOrResizeForPopover)
    }
  })
  onBeforeUnmount(() => {
    if (typeof document === 'undefined') return
    document.removeEventListener('click', onDocClickForPopover)
    document.removeEventListener('keydown', onDocKeydownForPopover)
    window.removeEventListener('scroll', onScrollOrResizeForPopover, true)
    window.removeEventListener('resize', onScrollOrResizeForPopover)
  })

  function isCtrlClick(e: MouseEvent): boolean { return e.ctrlKey || e.metaKey }
  function onDimHeaderClick(e: MouseEvent, dim: Dimension): void {
    if (isCtrlClick(e)) { e.preventDefault(); void onToggleDimension(dim); return }
    toggleExpand(dim.key)
  }
  function onModuleRowClick(e: MouseEvent, m: Module, dim: Dimension): void {
    if (isCtrlClick(e)) { e.preventDefault(); void onToggleModule(m, dim); return }
    onAdd(m, dim)
  }
  function onSelectedCardClick(e: MouseEvent, m: Module): void {
    if (!isCtrlClick(e)) return
    const target = e.target as HTMLElement | null
    if (target?.closest?.('button')) return
    e.preventDefault()
    void onDisableSelected(m)
  }

  async function onToggleDimension(dim: Dimension): Promise<void> {
    const nextEnabled = !dim.isEnabled
    const prev = dim.isEnabled
    const idx = library.dimensions.findIndex((d) => d.id === dim.id)
    if (idx !== -1) library.dimensions[idx] = { ...dim, isEnabled: nextEnabled } as Dimension
    try {
      await dbUpdateDimension({ ...dim, isEnabled: nextEnabled })
      emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: nextEnabled ? 'enable-dimension' : 'disable-dimension' })
      notify(nextEnabled ? `已启用维度「${dim.nameCn}」` : `已禁用维度「${dim.nameCn}」，不参与可控随机`, nextEnabled ? 'success' : 'info', 1800)
    } catch (e) {
      if (idx !== -1) library.dimensions[idx] = { ...dim, isEnabled: prev } as Dimension
      notify(`操作失败: ${String(e)}`, 'error')
    }
  }

  async function onToggleModule(m: Module, dim: Dimension): Promise<void> {
    const willDisable = m.isEnabled
    const wasSelected = willDisable && isSelected(m.id)
    if (willDisable && wasSelected) assembly.removeModule(m.id)
    const grouped = library.modulesByDim as Record<string, Module[]>
    const listKey = (grouped[dim.id] ? dim.id : (grouped[dim.key] ? dim.key : dim.id))
    const list = grouped[listKey] ?? []
    const mi = list.findIndex((x) => x.id === m.id)
    const prevEnabled = m.isEnabled
    if (mi !== -1) {
      const nextList = [...list]
      nextList[mi] = { ...m, isEnabled: !prevEnabled }
      grouped[listKey] = nextList
      library.modulesByDim = { ...grouped }
    }
    try {
      await dbUpdateModule({ ...m, isEnabled: !prevEnabled })
      emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: willDisable ? 'disable-module' : 'enable-module' })
      if (willDisable) notify(wasSelected ? `已禁用并移出已选「${m.displayName}」` : `已禁用词条「${m.displayName}」，不参与可控随机`, 'info', 1800)
      else notify(`已启用词条「${m.displayName}」`, 'success', 1500)
    } catch (e) {
      if (mi !== -1) {
        const g2 = library.modulesByDim as Record<string, Module[]>
        const lk2 = (g2[dim.id] ? dim.id : (g2[dim.key] ? dim.key : dim.id))
        const l2 = g2[lk2] ?? []
        const idx2 = l2.findIndex((x) => x.id === m.id)
        if (idx2 !== -1) {
          const nl = [...l2]
          nl[idx2] = { ...m, isEnabled: prevEnabled }
          g2[lk2] = nl
          library.modulesByDim = { ...g2 }
        }
      }
      notify(`操作失败: ${String(e)}`, 'error')
    }
  }

  async function onDisableSelected(m: Module): Promise<void> {
    let fresh: Module | null = null
    for (const lst of Object.values(modulesByDim.value)) {
      const f = lst.find((x) => x.id === m.id)
      if (f) { fresh = f; break }
    }
    const src = fresh ?? m
    assembly.removeModule(m.id)
    const dim = dimensions.value.find((d) => d.id === src.dimensionId)
    const grouped = library.modulesByDim as Record<string, Module[]>
    const listKey = dim ? (grouped[dim.id] ? dim.id : (grouped[dim.key] ? dim.key : dim.id)) : null
    const list = listKey ? (grouped[listKey] ?? []) : []
    const mi = list.findIndex((x) => x.id === src.id)
    const prevEnabled = src.isEnabled
    if (mi !== -1 && listKey) {
      const nl = [...list]
      nl[mi] = { ...src, isEnabled: false }
      grouped[listKey] = nl
      library.modulesByDim = { ...grouped }
    }
    try {
      await dbUpdateModule({ ...src, isEnabled: false })
      emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: 'disable-module' })
      notify(`已禁用并移出已选「${src.displayName}」`, 'info', 1800)
    } catch (e) {
      if (mi !== -1 && listKey) {
        const g2 = library.modulesByDim as Record<string, Module[]>
        const l2 = g2[listKey] ?? []
        const idx2 = l2.findIndex((x) => x.id === src.id)
        if (idx2 !== -1) {
          const nl2 = [...l2]
          nl2[idx2] = { ...src, isEnabled: prevEnabled }
          g2[listKey] = nl2
          library.modulesByDim = { ...g2 }
        }
      }
      notify(`操作失败: ${String(e)}`, 'error')
    }
  }

  function onSelectedRemove(id: string): void { assembly.removeModule(id) }
  function onToggleLock(id: string): void { assembly.toggleLocked(id) }
  function onSelectedClear(): void {
    if (!assembly.selectedItems.length) return
    if (!window.confirm('清空全部已选？')) return
    assembly.clear()
  }
  function onDragEnd(): void { /* v-model 已同步 */ }

  const showSettings = ref(false)
  function onSeparatorChange(e: Event): void { assembly.setConfig({ separator: (e.target as HTMLSelectElement).value }) }
  function onBracketToggle(e: Event): void { assembly.setConfig({ useWeightBrackets: (e.target as HTMLInputElement).checked }) }
  function onSortChange(e: Event): void { assembly.setConfig({ sortBy: (e.target as HTMLSelectElement).value as never }) }

  const showSaveDialog = ref(false)
  const showTemplateDialog = ref(false)
  async function onSaveConfirm(payload: { name: string; desc: string | null }): Promise<void> {
    const irJson = JSON.stringify(assembly.ir.toJSON())
    await history.save(payload.name.trim() || null, irJson, assembly.finalPrompt, assembly.config, [...assembly.selectedItems], false)
  }
  async function onTemplateConfirm(payload: { name: string; desc: string | null }): Promise<void> {
    const name = payload.name.trim(); if (!name) return; if (!assembly.selectedItems.length) return
    if (assembly.selectedItems.some((it) => !it.module.dimensionKey?.trim())) return
    const enabledKeys = [...new Set(assembly.selectedItems.map((it) => it.module.dimensionKey).filter(Boolean) as string[])]
    await history.saveTemplate(name, payload.desc, assembly.config, enabledKeys, assembly.finalPrompt || null, [...assembly.selectedItems])
  }

  const showDimDialog = ref(false)
  const dimDialogMode = ref<'create' | 'edit'>('create')
  const editingDimension = ref<Dimension | null>(null)
  const showModuleDialog = ref(false)
  const moduleDialogMode = ref<'create' | 'edit'>('create')
  const editingModule = ref<Module | null>(null)
  const newModuleDimId = ref<string | null>(null)
  const showBatchDialog = ref(false)
  const batchDimension = ref<Dimension | null>(null)
   const showOrderDialog = ref(false)

  const nsfwCount = computed(() => {
    let c = 0
    for (const mods of Object.values(modulesByDim.value)) for (const m of mods) if (m.isNsfw) c++
    return c
  })
  const filteredDimensions = computed(() => {
    const kw = keyword.value.trim().toLowerCase()
    if (!kw) return dimensions.value
    return dimensions.value.filter((d) => {
      if (d.nameCn.toLowerCase().includes(kw) || d.nameEn.toLowerCase().includes(kw) || d.key.toLowerCase().includes(kw)) return true
      const mods = modulesByDim.value[d.id] ?? []
      return mods.some((m) => m.displayName.toLowerCase().includes(kw) || m.contentEn.toLowerCase().includes(kw))
    })
  })
  function filteredModules(dimId: string): Module[] {
    const list = modulesByDim.value[dimId] ?? []
    const kw = keyword.value.trim().toLowerCase()
    let out = list
    if (kw) out = out.filter((m) => m.displayName.toLowerCase().includes(kw) || m.contentEn.toLowerCase().includes(kw))
    if (!allowNsfw.value) out = out.filter((m) => !m.isNsfw)
    return out
  }
  function toggleExpand(key: string): void { panelStore.toggleExpand(key) }
  function isExpanded(key: string): boolean { return panelStore.isExpanded(key) }
  function isSelected(moduleId: string): boolean { return assembly.selectedItems.some((it) => it.module.id === moduleId) }
  function onAdd(m: Module, dim: Dimension): void {
    if (!m.isEnabled) { notify('该词条已禁用，Ctrl+点击可启用', 'warning', 1800); return }
    if (!dim.isEnabled) { notify('该维度已禁用，Ctrl+点击维度头可启用', 'warning', 1800); return }
    if (isSelected(m.id)) return
    if (!dim.isMultiSelect) {
      const existing = assembly.selectedItems.find((it) => it.module.dimensionId === dim.id)
      if (existing) assembly.removeModule(existing.module.id)
    }
    assembly.addModule({ module: { ...m, dimensionKey: dim.key }, locked: false, weightOverride: null })
  }

  function onCreateDimension(): void { dimDialogMode.value = 'create'; editingDimension.value = null; showDimDialog.value = true }
  function onEditDimension(dim: Dimension): void { dimDialogMode.value = 'edit'; editingDimension.value = dim; showDimDialog.value = true }
  async function onDimConfirm(payload: { key: string; nameCn: string; nameEn: string; sortOrder: number; isMultiSelect: boolean }): Promise<void> {
    try {
      if (dimDialogMode.value === 'create') {
        const created = await dbCreateDimension(payload.key, payload.nameCn, payload.nameEn || undefined, payload.sortOrder, payload.isMultiSelect)
        library.dimensions = [...library.dimensions, created as Dimension]
        notify('维度已创建', 'success', 1500)
      } else if (editingDimension.value) {
        const prev = editingDimension.value
        const next = { ...prev, key: payload.key, nameCn: payload.nameCn, nameEn: payload.nameEn, sortOrder: payload.sortOrder, isMultiSelect: payload.isMultiSelect } as Dimension
        const idx = library.dimensions.findIndex((d) => d.id === prev.id)
        if (idx !== -1) library.dimensions[idx] = next
        try { await dbUpdateDimension(next) } catch (e) { if (idx !== -1) library.dimensions[idx] = prev; throw e }
        notify('维度已更新', 'success', 1500)
      }
      emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: dimDialogMode.value === 'create' ? 'create-dimension' : 'update-dimension' })
    } catch (e) { notify(`操作失败: ${String(e)}`, 'error') }
  }

  function onCreateModule(dimId: string): void { moduleDialogMode.value = 'create'; editingModule.value = null; newModuleDimId.value = dimId; showModuleDialog.value = true }
  function onEditModule(m: Module): void { moduleDialogMode.value = 'edit'; editingModule.value = m; newModuleDimId.value = null; showModuleDialog.value = true }
  async function onModuleConfirm(payload: { dimensionId: string; contentEn: string; displayName: string; weight: number; isNsfw: boolean; notes: string }): Promise<void> {
    try {
      if (moduleDialogMode.value === 'create') {
        const created = await dbCreateModule(payload.dimensionId, payload.contentEn, payload.displayName, payload.weight)
        let finalMod: Module = created as Module
        if (payload.isNsfw || payload.notes) {
          const patched = { ...created, isNsfw: payload.isNsfw, notes: payload.notes || null } as Module
          try { await dbUpdateModule(patched); finalMod = patched } catch (err) { logger.warn('DimensionPanel', 'patchModule', err) }
        }
        const dim = library.dimensions.find((d) => d.id === payload.dimensionId)
        if (dim) {
          const grouped = library.modulesByDim as Record<string, Module[]>
          const key = grouped[dim.id] ? dim.id : (grouped[dim.key] ? dim.key : dim.id)
          const list = grouped[key] ?? []
          grouped[key] = [...list, finalMod]
          library.modulesByDim = { ...grouped }
        }
        notify('词条已创建', 'success', 1500)
      } else if (editingModule.value) {
        const prev = editingModule.value
        const grouped = library.modulesByDim as Record<string, Module[]>
        const dim = library.dimensions.find((d) => d.id === prev.dimensionId)
        const key = dim ? (grouped[dim.id] ? dim.id : (grouped[dim.key] ? dim.key : dim.id)) : prev.dimensionId
        const list = grouped[key] ?? []
        const idx = list.findIndex((x) => x.id === prev.id)
        const nextMod = { ...prev, contentEn: payload.contentEn, displayName: payload.displayName, weight: payload.weight, isNsfw: payload.isNsfw, notes: payload.notes || null } as Module
        if (idx !== -1) {
          const nl = [...list]
          nl[idx] = nextMod
          grouped[key] = nl
          library.modulesByDim = { ...grouped }
        }
        await dbUpdateModule(nextMod)
        notify('词条已更新', 'success', 1500)
      }
      emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: moduleDialogMode.value === 'create' ? 'create-module' : 'update-module' })
    } catch (e) { notify(`操作失败: ${String(e)}`, 'error') }
  }

  function onBatchCreate(dim: Dimension): void { batchDimension.value = dim; showBatchDialog.value = true }
  async function onBatchImported(): Promise<void> {
    emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: 'batch-create-modules' })
    if (batchDimension.value) panelStore.setExpanded(batchDimension.value.key, true)
    notify('批量创建完成', 'success', 1500)
  }
  async function onDeleteModule(m: Module): Promise<void> {
    if (!confirm(`确定删除词条「${m.displayName}」？`)) return
    try {
      const grouped = library.modulesByDim as Record<string, Module[]>
      let removedFrom: string | null = null
      let removedIndex = -1
      for (const [k, list] of Object.entries(grouped)) {
        const idx = list.findIndex((x) => x.id === m.id)
        if (idx !== -1) { removedFrom = k; removedIndex = idx; grouped[k] = list.filter((x) => x.id !== m.id); library.modulesByDim = { ...grouped }; break }
      }
      try { await dbSoftDeleteModule(m.id) } catch (e) {
        if (removedFrom != null) {
          const restored = [...((library.modulesByDim as Record<string, Module[]>)[removedFrom] ?? [])]
          restored.splice(removedIndex, 0, m)
          library.modulesByDim = { ...(library.modulesByDim as Record<string, Module[]>), [removedFrom]: restored }
        }
        throw e
      }
      notify('词条已删除', 'success', 1500)
      emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: 'delete-module' })
    } catch (e) { notify(`删除失败: ${String(e)}`, 'error') }
  }
  async function refresh(): Promise<void> { await library.fetchAll() }

  const contextMenu = ref<{ key: string; x: number; y: number; dim: Dimension } | null>(null)
  const menuPos = ref<{ top: number; left: number }>({ top: 0, left: 0 })
  const showTranslateDialog = ref(false)
  const translateTarget = ref<{ dim: Dimension; modules: Module[] } | null>(null)
  const showGenerateDialog = ref(false)
  const generateTarget = ref<{ dim: Dimension; modules: Module[] } | null>(null)
  function onDimContextMenu(e: MouseEvent, dim: Dimension): void {
    e.preventDefault()
    contextMenu.value = { key: dim.key, x: e.clientX, y: e.clientY, dim }
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768
    menuPos.value = calcMenuPos(e.clientX, e.clientY, MENU_W, MENU_H_EST, vw, vh)
  }
  function closeContextMenu(): void { contextMenu.value = null }
  function onTranslateFromMenu(): void {
    const cur = contextMenu.value
    if (!cur) return
    translateTarget.value = { dim: cur.dim, modules: [...(modulesByDim.value[cur.dim.id] ?? [])] }
    showTranslateDialog.value = true
    closeContextMenu()
  }
  function onGenerateFromMenu(): void {
    const cur = contextMenu.value
    if (!cur) return
    generateTarget.value = { dim: cur.dim, modules: [...(modulesByDim.value[cur.dim.id] ?? [])] }
    showGenerateDialog.value = true
    closeContextMenu()
  }
  function onToggleFromMenu(): void {
    const cur = contextMenu.value
    if (!cur) return
    const fresh = library.dimensions.find((d) => d.id === cur.dim.id) ?? cur.dim
    closeContextMenu()
    void onToggleDimension(fresh)
  }
  function onClearFromMenu(): void {
    const cur = contextMenu.value
    if (!cur) return
    closeContextMenu()
    openClearConfirm(cur.dim)
  }
  function onMigrateFromMenu(): void {
    const cur = contextMenu.value
    if (!cur) return
    closeContextMenu()
    openMigrateDialog(cur.dim)
  }
   function onOrderFromMenu(): void {
     if (!contextMenu.value) return
     closeContextMenu()
     showOrderDialog.value = true
   }

  const clearTarget = ref<Dimension | null>(null)
  const clearConfirmOpen = ref(false)
  const clearing = ref(false)
  const clearAgreed = ref(false)
  const clearCount = computed(() => (clearTarget.value ? (modulesByDim.value[clearTarget.value.id]?.length ?? 0) : 0))
  const clearSelectedK = computed(() => {
    const dim = clearTarget.value
    if (!dim) return 0
    const ids = new Set((modulesByDim.value[dim.id] ?? []).map((m) => m.id))
    return assembly.selectedItems.filter((it) => it.module.dimensionId === dim.id || ids.has(it.module.id)).length
  })
  function openClearConfirm(dim: Dimension): void { clearTarget.value = dim; clearAgreed.value = false; clearConfirmOpen.value = true }
  function closeClearConfirm(): void { if (clearing.value) return; clearConfirmOpen.value = false }
  async function doClearDimension(): Promise<void> {
    const dim = clearTarget.value
    if (!dim) return
    if (clearing.value) { notify('正在清空中…', 'info', 1500); return }
    const list = [...(modulesByDim.value[dim.id] ?? [])]
    if (list.length === 0) { clearConfirmOpen.value = false; return }
    clearing.value = true
    const snapshot = [...list]
    const g0 = library.modulesByDim as Record<string, Module[]>
    library.modulesByDim = { ...g0, [dim.id]: [] }
    try {
      const r = await dbClearDimension({ dimensionId: dim.id })
      const ids = new Set(list.map((m) => m.id))
      const linked = assembly.selectedItems.filter((it) => it.module.dimensionId === dim.id || ids.has(it.module.id))
      for (const it of linked) assembly.removeModule(it.module.id)
      emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: 'clear-dimension' })
      await library.fetchAll()
      notify(`已清空维度「${dim.nameCn}」，删除 ${r.cleared} 条` + (linked.length ? `，移出已选 ${linked.length} 条` : ''), 'success', 2200)
      clearConfirmOpen.value = false
    } catch (e) {
      const g2 = library.modulesByDim as Record<string, Module[]>
      g2[dim.id] = snapshot
      library.modulesByDim = { ...g2 }
      emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: 'clear-dimension-failed' })
      await library.fetchAll()
      notify(`清空失败：${String(e)}，未删除任何条目`, 'error')
    } finally { clearing.value = false }
  }

  const migrateTarget = ref<Dimension | null>(null)
  const migrateOpen = ref(false)
  const migrating = ref(false)
  const migrateCount = computed(() => (migrateTarget.value ? (modulesByDim.value[migrateTarget.value.id]?.length ?? 0) : 0))
  const migrateSelectedK = computed(() => {
    const dim = migrateTarget.value
    if (!dim) return 0
    const ids = new Set((modulesByDim.value[dim.id] ?? []).map((m) => m.id))
    return assembly.selectedItems.filter((it) => it.module.dimensionId === dim.id || ids.has(it.module.id)).length
  })
  function openMigrateDialog(dim: Dimension): void {
    if ((modulesByDim.value[dim.id]?.length ?? 0) === 0) return
    migrateTarget.value = dim
    migrateOpen.value = true
  }
  async function doMigrateDimension(): Promise<void> {
    const dim = migrateTarget.value
    if (!dim || migrating.value) return
    migrating.value = true
    try {
      const r = await dbMigrateDimension({ dimensionId: dim.id })
      for (const it of [...assembly.selectedItems]) {
        if (it.module.dimensionId === dim.id) assembly.removeModule(it.module.id)
      }
      emit(LIBRARY_CHANGED, { source: 'dimension-panel', op: 'migrate-dimension' })
      await library.fetchAll()
      panelStore.setExpanded(dim.key, true)
      notify(`已迁移 ${r.moved} 条到归档「${r.archive.key}」，新生空白维度「${dim.nameCn}」可用`, 'success', 2600)
      migrateOpen.value = false
    } catch (e) { notify(`迁移失败: ${String(e)}`, 'error') } finally { migrating.value = false }
  }
  async function onCopyDimKey(key: string): Promise<void> {
    try { await navigator.clipboard.writeText(key); notify(`已复制维度键名 ${key}`, 'success', 1500) }
    catch (err) { logger.warn('DimensionPanel', 'copyKey', err); notify('复制失败', 'warning') }
    closeContextMenu()
  }
  async function onCopyDimName(nameCn: string): Promise<void> {
    try { await navigator.clipboard.writeText(nameCn); notify(`已复制维度中文名 ${nameCn}`, 'success', 1500) }
    catch (err) { logger.warn('DimensionPanel', 'copyName', err); notify('复制失败', 'warning') }
    closeContextMenu()
  }
  function onDocClickForMenu(e: MouseEvent): void {
    if (!contextMenu.value) return
    const menu = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('[data-testid="dim-context-menu"]') : null
    if (menu?.contains(e.target as Node)) return
    closeContextMenu()
  }
  function onDocKeydownForMenu(e: KeyboardEvent): void { if (e.key === 'Escape' && contextMenu.value) closeContextMenu() }
  function onScrollOrResizeForMenu(): void { if (contextMenu.value) closeContextMenu() }
  watch(contextMenu, (v) => {
    if (typeof document === 'undefined') return
    if (v) {
      document.addEventListener('click', onDocClickForMenu)
      document.addEventListener('keydown', onDocKeydownForMenu)
      window.addEventListener('scroll', onScrollOrResizeForMenu, true)
      window.addEventListener('resize', onScrollOrResizeForMenu)
    } else {
      document.removeEventListener('click', onDocClickForMenu)
      document.removeEventListener('keydown', onDocKeydownForMenu)
      window.removeEventListener('scroll', onScrollOrResizeForMenu, true)
      window.removeEventListener('resize', onScrollOrResizeForMenu)
    }
  })
  onBeforeUnmount(() => {
    if (typeof document === 'undefined') return
    document.removeEventListener('click', onDocClickForMenu)
    document.removeEventListener('keydown', onDocKeydownForMenu)
    window.removeEventListener('scroll', onScrollOrResizeForMenu, true)
    window.removeEventListener('resize', onScrollOrResizeForMenu)
  })

  onMounted(() => {
    if (library.dimensions.length === 0 && !library.loading) void library.fetchAll().catch((err: unknown) => logger.warn('DimensionPanel', 'fetchAll', err))
  })

  return {
    assembly, history, library, panelStore,
    keyword, allowNsfw, dimensions, modulesByDim, loading,
    dimPanelMode, previewOpen, selectedCount, filteredSelected, draggableSelected,
    activeWeightId, draftWeight, weightPos, openWeightPopover, closeWeightPopover, confirmWeight, cancelWeight, onDraftInput, onSliderInput,
    onDimHeaderClick, onModuleRowClick, onSelectedCardClick, onToggleDimension, onToggleModule, onDisableSelected,
    onSelectedRemove, onToggleLock, onSelectedClear, onDragEnd,
    showSettings, onSeparatorChange, onBracketToggle, onSortChange,
    showSaveDialog, showTemplateDialog, onSaveConfirm, onTemplateConfirm,
    showDimDialog, dimDialogMode, editingDimension, showModuleDialog, moduleDialogMode, editingModule, newModuleDimId,
    showBatchDialog, batchDimension, nsfwCount, filteredDimensions, filteredModules,
    toggleExpand, isExpanded, isSelected, onAdd,
    onCreateDimension, onEditDimension, onDimConfirm, onCreateModule, onEditModule, onModuleConfirm,
    onBatchCreate, onBatchImported, onDeleteModule, refresh,
     contextMenu, menuPos, showTranslateDialog, translateTarget, showGenerateDialog, generateTarget, showOrderDialog,
     onDimContextMenu, closeContextMenu, onTranslateFromMenu, onGenerateFromMenu, onToggleFromMenu, onClearFromMenu, onMigrateFromMenu, onOrderFromMenu,
    clearTarget, clearConfirmOpen, clearing, clearAgreed, clearCount, clearSelectedK, openClearConfirm, closeClearConfirm, doClearDimension,
    migrateTarget, migrateOpen, migrating, migrateCount, migrateSelectedK, openMigrateDialog, doMigrateDimension,
    onCopyDimKey, onCopyDimName,
  }
}
