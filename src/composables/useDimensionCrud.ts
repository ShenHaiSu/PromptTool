import { ref } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { notify } from '@/lib/notify'
import { logger } from '@/lib/logger'
import { emit, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import {
  dbCreateDimension,
  dbUpdateDimension,
  dbCreateModule,
  dbUpdateModule,
  dbSoftDeleteModule,
  dbClearDimension,
  dbMigrateDimension,
} from '@/lib/db'
import type { Dimension, Module } from '@/engine/models'

/**
 * need03 S4: CRUD 对话框编排（调 db.ts，调 emit LIBRARY_CHANGED）。
 * 从 DimensionPanel 抽出，保持行为不变。
 */
export function useDimensionCrud() {
  const library = useLibraryStore()

  const dimDialogOpen = ref(false)
  const dimDialogMode = ref<'create' | 'edit'>('create')
  const editingDim = ref<Dimension | null>(null)

  const modDialogOpen = ref(false)
  const modDialogMode = ref<'create' | 'edit'>('create')
  const editingMod = ref<Module | null>(null)
  const modDimId = ref<string | null>(null)

  function openCreateDimension(): void {
    dimDialogMode.value = 'create'
    editingDim.value = null
    dimDialogOpen.value = true
  }
  function openEditDimension(d: Dimension): void {
    dimDialogMode.value = 'edit'
    editingDim.value = d
    dimDialogOpen.value = true
  }
  async function confirmDimension(payload: { key: string; nameCn: string; nameEn: string; sortOrder: number; isMultiSelect: boolean }): Promise<void> {
    try {
      if (dimDialogMode.value === 'edit' && editingDim.value) {
        await dbUpdateDimension({ ...editingDim.value, ...payload })
        notify('维度已更新', 'success', 1500)
      } else {
        await dbCreateDimension(payload.key, payload.nameCn, payload.nameEn, payload.sortOrder, payload.isMultiSelect)
        notify('维度已创建', 'success', 1500)
      }
      dimDialogOpen.value = false
      await library.fetchAll()
      emit(LIBRARY_CHANGED, { source: 'dimension-crud', op: 'dimension-changed' })
    } catch (e) {
      logger.error('useDimensionCrud', 'confirmDimension', e)
      notify(`保存失败: ${String(e)}`, 'error')
    }
  }

  function openCreateModule(dimId: string): void {
    modDialogMode.value = 'create'
    editingMod.value = null
    modDimId.value = dimId
    modDialogOpen.value = true
  }
  function openEditModule(m: Module): void {
    modDialogMode.value = 'edit'
    editingMod.value = m
    modDimId.value = m.dimensionId
    modDialogOpen.value = true
  }
  async function confirmModule(payload: { dimensionId: string; contentEn: string; displayName: string; weight: number; isNsfw: boolean; notes: string }): Promise<void> {
    try {
      if (modDialogMode.value === 'edit' && editingMod.value) {
        await dbUpdateModule({ ...editingMod.value, ...payload })
        notify('词条已更新', 'success', 1500)
      } else {
        await dbCreateModule(payload.dimensionId, payload.contentEn, payload.displayName, payload.weight)
        const created = await dbUpdateModule ? null : null
        void created
        notify('词条已创建', 'success', 1500)
      }
      modDialogOpen.value = false
      await library.fetchAll()
      emit(LIBRARY_CHANGED, { source: 'dimension-crud', op: 'module-changed' })
    } catch (e) {
      logger.error('useDimensionCrud', 'confirmModule', e)
      notify(`保存失败: ${String(e)}`, 'error')
    }
  }

  async function removeModule(id: string): Promise<void> {
    try {
      await dbSoftDeleteModule(id)
      notify('已删除词条', 'success', 1500)
      await library.fetchAll()
      emit(LIBRARY_CHANGED, { source: 'dimension-crud', op: 'module-deleted' })
    } catch (e) {
      notify(`删除失败: ${String(e)}`, 'error')
    }
  }

  async function clearDimension(dimensionId: string): Promise<void> {
    try {
      const r = await dbClearDimension({ dimensionId })
      notify(`已清空 ${r.cleared} 条`, 'success', 1500)
      await library.fetchAll()
      emit(LIBRARY_CHANGED, { source: 'dimension-crud', op: 'dimension-cleared' })
    } catch (e) {
      notify(`清空失败: ${String(e)}`, 'error')
    }
  }

  async function migrateDimension(dimensionId: string): Promise<void> {
    try {
      const r = await dbMigrateDimension({ dimensionId })
      notify(`已迁移 ${r.moved} 条`, 'success', 1500)
      await library.fetchAll()
      emit(LIBRARY_CHANGED, { source: 'dimension-crud', op: 'dimension-migrated' })
    } catch (e) {
      notify(`迁移失败: ${String(e)}`, 'error')
    }
  }

  return {
    dimDialogOpen, dimDialogMode, editingDim, openCreateDimension, openEditDimension, confirmDimension,
    modDialogOpen, modDialogMode, editingMod, modDimId, openCreateModule, openEditModule, confirmModule,
    removeModule, clearDimension, migrateDimension,
  }
}
