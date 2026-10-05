import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useAssemblyStore } from '@/stores/assembly'
import { useHistoryStore } from '@/stores/history'
import { useLibraryStore } from '@/stores/library'
import { useDbRegistryStore } from '@/stores/dbRegistry'
import { dbGetTempCarry } from '@/lib/db'
import { on as onEvent, off as offEvent, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import { logger } from '@/lib/logger'

/**
 * need03 S4: App 启动编排抽离（原 App.vue onMounted 逻辑原样搬运）。
 * switchCenterTab 脏守卫语义不变。
 *
 * 解耦设计：跨域依赖经构造注入（调用方在 App.vue 组装），本模块不再动态 import
 * 任何 store / composable，避免 "dynamic import will not move module into another chunk"。
 */
export interface AppBootstrapDeps {
  /** 窗口几何持久化（默认见 App.vue 传入 persistGeometry）。 */
  persistGeometry?: () => void
  /** 生图连接模型加载（默认见 App.vue 传入 connectionProfile store 的 loadModel）。 */
  loadConnectionModel?: () => Promise<void>
}

export function useAppBootstrap(deps: AppBootstrapDeps = {}) {
  const assembly = useAssemblyStore()
  const historyStore = useHistoryStore()
  const dbRegistry = useDbRegistryStore()
  const library = useLibraryStore()

  const dimCount = ref(0)
  const moduleCount = ref(0)

  function syncCountsFromLibrary(): void {
    if (library.dimensions.length) dimCount.value = library.dimensions.length
    if (library.total) moduleCount.value = library.total
  }

  function handleLibraryChanged(): void {
    library.scheduleFetch()
  }

  async function bootstrap(): Promise<void> {
    try {
      deps.persistGeometry?.()
    } catch (err) {
      logger.warn('AppBootstrap', 'persistGeometry', err)
    }

    onEvent(LIBRARY_CHANGED, handleLibraryChanged)

    try {
      await deps.loadConnectionModel?.()
    } catch (err) {
      logger.warn('AppBootstrap', 'loadModel降级', err)
    }

    try {
      await dbRegistry.fetchActiveInfo()
      await dbRegistry.fetchList()
      if (!dbRegistry.activeInfo?.foreground) {
        dbRegistry.onboardingOpen = true
        return
      }
    } catch (err) {
      logger.warn('AppBootstrap', 'dbRegistry', err)
      dbRegistry.onboardingOpen = true
      return
    }

    try {
      await library.fetchAll()
      syncCountsFromLibrary()
      try {
        const carry = await dbGetTempCarry()
        if (carry && carry.selectedItemIds?.length) {
          const grouped = library.modulesByDim as Record<string, { id: string; dimensionId?: string }[]>
          const idToModule = new Map<string, { id: string; dimensionId?: string }>()
          for (const arr of Object.values(grouped)) for (const m of arr) idToModule.set(m.id, m)
          const items = carry.selectedItemIds.map((id) => {
            const mod = idToModule.get(id)
            if (!mod) return null
            const w = carry.weightDraft?.[id] ?? null
            return { module: mod, locked: false, weightOverride: w }
          }).filter(Boolean) as typeof assembly.selectedItems
          if (items.length) assembly.setSelected(items)
        }
      } catch (err) {
        logger.warn('AppBootstrap', 'carry', err)
      }
    } catch (err) {
      logger.warn('AppBootstrap', 'library', err)
    }
    try { await historyStore.fetchAll() } catch (err) { logger.warn('AppBootstrap', 'history', err) }
  }

  function dispose(): void {
    offEvent(LIBRARY_CHANGED, handleLibraryChanged)
    library.dispose()
  }

  onMounted(() => {
    void bootstrap()
  })
  onBeforeUnmount(() => {
    dispose()
  })

  return { dimCount, moduleCount, syncCountsFromLibrary, handleLibraryChanged, bootstrap, dispose }
}
