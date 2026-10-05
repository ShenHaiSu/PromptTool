/**
 * usePersist — 主题 / 窗口几何持久化（need04：sash 持久化已收敛到 useSash，死代码 persistSash 已清理）
 * localStorage 双写兼容 pmf:theme/pmf-theme
 * 几何通过可选 Rust Command save_window_state / window 事件最佳尽力持久化
 */
import { watch, type Ref } from 'vue'

import { logger } from '@/lib/logger'

const THEME_KEY = 'pmf:theme'
const THEME_LEGACY = 'pmf-theme'
const GEOMETRY_KEY = 'pmf:geometry'
const GEOMETRY_LEGACY = 'pmf-geometry'

export type ThemeMode = 'light' | 'dark'

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch (e) {
    logger.warn('usePersist', `读取 ${key} 失败：`, e)
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch (e) {
    // quota / disabled
    logger.warn('usePersist', `写入 ${key} 失败（quota/disabled）：`, e)
  }
}

// ------------------------------------------------------------------
// theme
// ------------------------------------------------------------------

export function persistTheme(mode: Ref<ThemeMode>): void {
  watch(
    mode,
    (v) => {
      safeSet(THEME_KEY, v)
      safeSet(THEME_LEGACY, v)
    },
    { flush: 'sync' },
  )
}

export function loadPersistedTheme(): ThemeMode | null {
  const primary = safeGet(THEME_KEY) as ThemeMode | null
  if (primary === 'light' || primary === 'dark') return primary
  const legacy = safeGet(THEME_LEGACY) as ThemeMode | null
  if (legacy === 'light' || legacy === 'dark') return legacy
  return null
}

// ------------------------------------------------------------------
// geometry — 768p 溢出保护 + beforeunload 持久化
// ------------------------------------------------------------------

export type Geometry = { width: number; height: number; x?: number; y?: number }

const MIN_GEOMETRY: Geometry = { width: 1280, height: 720 }

export function loadGeometry(): Geometry | null {
  const raw = safeGet(GEOMETRY_KEY) ?? safeGet(GEOMETRY_LEGACY)
  if (!raw) return null
  try {
    const g = JSON.parse(raw) as Geometry
    if (typeof g.width === 'number' && typeof g.height === 'number') {
      // 溢出保护：低于 768p 视为无效，回退最小值
      if (g.width < MIN_GEOMETRY.width || g.height < MIN_GEOMETRY.height) return null
      return g
    }
  } catch (e) {
    logger.warn('usePersist', '解析持久化窗口几何失败：', e)
  }
  return null
}

 export interface PersistGeometryOpts {
   /** Rust 侧窗口状态同步（best effort，见 src/lib/windowState.ts；未注入则只写 localStorage）。 */
   saveWindowState?: (width: number, height: number) => Promise<unknown>
 }

 export function persistGeometry(opts: PersistGeometryOpts = {}): void {
   // 仅在 Tauri 环境可用时通过 Rust 侧保存；前端仅 localStorage 兜底
   function save(): void {
     try {
       const g: Geometry = { width: window.innerWidth, height: window.innerHeight }
       if (g.width < MIN_GEOMETRY.width || g.height < MIN_GEOMETRY.height) return
       const payload = JSON.stringify(g)
       safeSet(GEOMETRY_KEY, payload)
       safeSet(GEOMETRY_LEGACY, payload)
       // Rust 侧同步经端口注入（composable 自身不依赖 Tauri，避免动态导入分包警告）；失败仅留痕
       const saver = opts.saveWindowState
       if (saver) {
         try {
           void saver(g.width, g.height).catch((e: unknown) => {
             logger.warn('usePersist', 'save_window_state 调用失败（best effort）：', e)
           })
         } catch (e) {
           logger.warn('usePersist', 'save_window_state 调用失败（best effort）：', e)
         }
       }
     } catch (e) {
       logger.warn('usePersist', '持久化窗口几何失败：', e)
     }
   }
   window.addEventListener('beforeunload', save)
   // 暴露 save 以便组件 unmount 时亦可调用
   ;(persistGeometry as unknown as { _save: typeof save })._save = save
 }

export function getPersistedGeometrySave(): (() => void) | undefined {
  return (persistGeometry as unknown as { _save?: () => void })._save
}
