/**
 * need03 S5: localStorage key 收敛 — 全仓统一出口。
 * 旧双写兼容逻辑（usePersist）原样保留，只收 key 常量。
 */
export const STORAGE_KEYS = {
  THEME: 'pmf:theme',
  SASH: 'pmf:sash',
  STORAGE_MODE: 'pmf:storage-mode',
  GENERATE_TENDENCY: 'pmf:generate:tendency',
  GENERATE_COUNT: 'pmf:generate:count',
  GENERATE_EXAMPLE_COUNT: 'pmf:generate:exampleCount',
  GENERATE_EXCLUDE: 'pmf:generate:excludeExisting',
  GENERATE_STEP: 'pmf:generate:step',
  SINGLE_SHOT_DRAFT: 'singleShotDraft',
  SINGLE_SHOT_VSPLIT: 'pmf:single-shot-vsplit',
  DIM_PANEL_MODE: 'pmf:dimPanelMode',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]
