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

export type { RegistryRow, ActiveInfo }

export const useDbRegistryStore = defineStore('dbRegistry', () => {
  const activeInfo = ref<ActiveInfo | null>(null)
  const list = ref<RegistryRow[]>([])
  const loading = ref(false)
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
      } catch {
        // ignore
      }
    }
    await dbSwitchActive(path)
    try { emit(LIBRARY_CHANGED, { source: 'dbRegistry', op: 'switchActive', path }) } catch { /* ignore */ }
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
      } catch {}
    }
    await dbCreateBusiness(args)
    try { emit(LIBRARY_CHANGED, { source: 'dbRegistry', op: 'createBusiness', path: args.path }) } catch { /* ignore */ }
    window.location.reload()
  }

  async function repairPath(oldPath: string, newPath: string): Promise<void> {
    await dbRepairPath(oldPath, newPath)
    await fetchList()
    await fetchActiveInfo()
    try { emit(LIBRARY_CHANGED, { source: 'dbRegistry', op: 'repairPath' }) } catch { /* ignore */ }
  }

  async function rebuildMissing(path: string, withSeed: boolean): Promise<void> {
    await dbRebuildMissing(path, withSeed)
    await fetchList()
    await fetchActiveInfo()
    try { emit(LIBRARY_CHANGED, { source: 'dbRegistry', op: 'rebuildMissing', path }) } catch { /* ignore */ }
  }

  async function removeRegistry(path: string): Promise<{ wasForeground: boolean; nextForeground: string | null }> {
    const res = await dbRemoveRegistry(path)
    if (res.wasForeground) {
      try { emit(LIBRARY_CHANGED, { source: 'dbRegistry', op: 'removeRegistry', path }) } catch { /* ignore */ }
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
