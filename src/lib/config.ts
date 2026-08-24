export const APP_CONFIG = {
  window: { width: 1600, height: 1080, minWidth: 1280, minHeight: 720 },
  topbar: { collapsed: 88, expanded: 168 },
  layout: { left: 30, center: 38, right: 32 },
  sidebar: { min: 260, default: 320, max: 420 },
  weights: { min: 0.5, max: 2.0, default: 1.0, step: 0.1 },
  batch: { defaultCount: 5, maxCount: 500, pageSize: 50 },
  separators: [', ', ' BREAK ', '\n'] as const,
  modelProfiles: ['sd', 'mj', 'flux'] as const,
  sortModes: ['dimensionOrder', 'customDragOrder'] as const,
} as const

export const DEFAULT_ASSEMBLY_CONFIG = {
  separator: ', ' as string,
  useWeightBrackets: true,
  modelProfile: 'sd' as const,
  sortBy: 'dimensionOrder' as const,
}
