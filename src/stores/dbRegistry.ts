import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  dbGetActiveInfo,
  dbListRegistry,
  dbSwitchActive,
  dbSetMaxActive,
  dbRepairPath,
  dbRebuildMissing,
  dbRemoveRegistry,
  dbUpdateRegistryMeta,
  dbSetTempCarry,
  dbCreateBusiness,
  dbCheckAlias,
  type RegistryRow,
  type ActiveInfo,
} from '@/lib/db'
import { useAssemblyStore } from '@/stores/assembly'
import { emit, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import { logger } from '@/lib/logger'

export type { RegistryRow, ActiveInfo }

/** 事件广播失败不得中断库切换主流程，但必须留痕（06 §3）。 */
/** 库变更事件广播：emit 内部已隔离单个 handler 异常，不再需要调用侧 try（06 §3）。 */
function safeEmit(payload: unknown): void {
  emit(LIBRARY_CHANGED, payload)
}

export const useDbRegistryStore = defineStore('dbRegistry', () => {
  const loading = ref(false)
  const activeInfo = ref<ActiveInfo | null>(null)
  const list = ref<RegistryRow[]>([])
  const onboardingOpen = ref(false)

  async function fetchActiveInfo(): Promise<void> {
    const info = await dbGetActiveInfo()
    activeInfo.value = info
    if (!info.foreground) onboardingOpen.value = true
  }

  async function fetchList(): Promise<void> {
    list.value = await dbListRegistry()
  }

  async function switchActive(path: string): Promise<void> {
    const assembly = useAssemblyStore()
    const payload = {
      selectedItemIds: assembly.selectedItems.map((it) => it.module.id),
      weightDraft: Object.fromEntries(
        assembly.selectedItems
          .filter((it) => it.weightOverride != null)
          .map((it) => [it.module.id, it.weightOverride as number]),
      ),
    }
    if (payload.selectedItemIds.length > 0) {
      try {
        await dbSetTempCarry(payload)
      } catch (e) {
        logger.warn('dbRegistry', '暂存选中项失败（切库后不影响主流程）：', e)
      }
    }
    await dbSwitchActive(path)
    safeEmit({ source: 'dbRegistry', op: 'switchActive', path })
    window.location.reload()
  }

  async function createBusiness(args: {
    path: string
    alias: string
    remark?: string
    withSeed: boolean
  }): Promise<void> {
    const assembly = useAssemblyStore()
    const payload = {
      selectedItemIds: assembly.selectedItems.map((it) => it.module.id),
      weightDraft: Object.fromEntries(
        assembly.selectedItems
          .filter((it) => it.weightOverride != null)
          .map((it) => [it.module.id, it.weightOverride as number]),
      ),
    }
    if (payload.selectedItemIds.length > 0) {
      try {
        await dbSetTempCarry(payload)
      } catch (e) {
        logger.warn('dbRegistry', '暂存选中项失败（新建库不影响主流程）：', e)
      }
    }
    await dbCreateBusiness(args)
    safeEmit({ source: 'dbRegistry', op: 'createBusiness', path: args.path })
    window.location.reload()
  }

  async function repairPath(oldPath: string, newPath: string): Promise<void> {
    await dbRepairPath(oldPath, newPath)
    await fetchList()
    await fetchActiveInfo()
    safeEmit({ source: 'dbRegistry', op: 'repairPath' })
  }

  async function rebuildMissing(path: string, withSeed: boolean): Promise<void> {
    await dbRebuildMissing(path, withSeed)
    await fetchList()
    await fetchActiveInfo()
    safeEmit({ source: 'dbRegistry', op: 'rebuildMissing', path })
  }

  async function removeRegistry(path: string): Promise<{ wasForeground: boolean; nextForeground: string | null }> {
    const res = await dbRemoveRegistry(path)
    if (res.wasForeground) {
      safeEmit({ source: 'dbRegistry', op: 'removeRegistry', path })
      window.location.reload()
    } else {
      await fetchList()
      await fetchActiveInfo()
    }
    return res
  }

  async function updateMeta(path: string, alias?: string, remark?: string): Promise<void> {
    await dbUpdateRegistryMeta(path, alias, remark)
    await fetchList()
    await fetchActiveInfo()
  }

  async function setMaxActive(n: number): Promise<void> {
    await dbSetMaxActive(n)
    await fetchActiveInfo()
  }

  async function checkAlias(alias: string): Promise<{ available: boolean; message: string }> {
    return dbCheckAlias(alias)
  }

  return {
    activeInfo,
    list,
    loading,
    onboardingOpen,
    fetchActiveInfo,
    fetchList,
    switchActive,
    createBusiness,
    repairPath,
    rebuildMissing,
    removeRegistry,
    updateMeta,
    setMaxActive,
    checkAlias,
  }
})
