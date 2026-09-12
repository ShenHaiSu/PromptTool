/**
 * 纯 Web 入口（web-pure 阶段一）：转调 IndexedDB 空壳适配层。
 * Tauri 实现保留在 `db.tauri.ts.bak`（历史对照，阶段六前不删除）。
 * 阶段二将 `db.idb.ts` 替换为真正的 IndexedDB 实现，本文件保持不动。
 */
export * from './db.idb'
