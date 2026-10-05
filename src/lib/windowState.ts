/**
 * 窗口状态 Tauri 适配器：唯一职责是把窗口几何同步给 Rust 侧（best effort）。
 * - 对 `@tauri-apps/api/core` 使用静态引用——该模块本就被 db/imageQueueApi 等静态
 *   引入同属主包，静态对静态不再触发 dynamic-import 分包警告。
 * - 由 App.vue 在启动组装时注入给 usePersist，composable 自身不再依赖 Tauri。
 */
import { invoke } from '@tauri-apps/api/core'

/** 可选 Rust Command：失败由调用方按 best effort 处理（仅留痕）。 */
export function saveWindowState(width: number, height: number): Promise<unknown> {
  return invoke('save_window_state', { width, height })
}
