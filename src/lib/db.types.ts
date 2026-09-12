/** db 适配层共享报告 / 载荷类型（与 db.tauri.ts.bak 一致，原样保留）。 */
import type { RuleType } from '@/engine/models'

export type ImportReport = {
  dimensions: number
  modules: number
  assemblies: number
  templates: number
  skipped: number
}

export type ExportToDirResult = {
  path: string
  json: string
  filename: string
}

export type ImportMode = 'skip' | 'overwrite'

export type LibraryImportReport = {
  dimensionsCreated: number
  dimensionsUpdated: number
  dimensionsSkipped: number
  modulesCreated: number
  modulesUpdated: number
  modulesSkipped: number
  rulesCreated: number
  rulesUpdated: number
  rulesSkipped: number
  tagsCreated: number
  tagsSkipped: number
  errors: string[]
  /** 阶段五新增：模板 / 历史快照 / 词条-标签关联计数（生产者恒返回全量）。 */
  templatesCreated: number
  templatesUpdated: number
  templatesSkipped: number
  assembliesCreated: number
  assembliesSkipped: number
  moduleTagsCreated: number
  moduleTagsSkipped: number
}

export type SegmentImportItem = {
  dimensionKey: string
  dimensionId?: string | null
  contentEn: string
  displayName?: string | null
  weight?: number | null
  isNsfw?: boolean
  notes?: string | null
}

export type SegmentImportPayload = {
  format: string
  formatVersion: number
  prompts: { id: string; raw: string; segments: SegmentImportItem[] }[]
  unassignedStrategy: 'ignore' | 'to_camera' | 'prompt_new'
  mode: ImportMode
}

export type SegmentImportReport = {
  prompts: number
  segmentsTotal: number
  segmentsImported: number
  segmentsSkipped: number
  segmentsIgnoredUnassigned: number
  modulesCreated: number
  modulesUpdated: number
  modulesSkipped: number
  errors: string[]
  warnings: string[]
}

export type BatchCreateItem = {
  contentEn: string
  displayName?: string | null
  weight?: number | null
  isNsfw?: boolean
  notes?: string | null
}

export type BatchCreatePayload = {
  dimId: string
  items: BatchCreateItem[]
  mode: ImportMode
  weight?: number | null
  isNsfw?: boolean
}

export type BatchCreateReport = {
  totalRequested: number
  valid: number
  modulesCreated: number
  modulesUpdated: number
  modulesSkipped: number
  emptyIgnored: number
  duplicateInBatch: number
  truncated: number
  errors: string[]
  warnings: string[]
}

export type RegistryRow = {
  id: string
  path: string
  alias: string
  remark: string | null
  status: 'available' | 'missing'
  createdAt: number
  lastOpenedAt: number | null
  dimCount: number
  moduleCount: number
  favoriteCount: number
}

export type ActiveInfo = {
  foreground: RegistryRow | null
  resident: RegistryRow[]
  maxActive: number
}

export type ValidateResult = { exists: boolean; valid: boolean; message: string; normalizedPath: string }

export type TranslationUpdateItem = {
  id: string
  displayName: string
}
export type TranslationUpdatePayload = {
  dimensionId: string
  items: TranslationUpdateItem[]
}
export type TranslationUpdateReport = {
  totalRequested: number
  updated: number
  skipped: number
  warnings: string[]
  errors: string[]
}

export type RuleDto = {
  id: string
  name: string
  type: RuleType
  sourceDimensionId: string | null
  sourceModuleId: string | null
  targetDimensionId: string | null
  targetModuleId: string | null
  message: string
  isEnabled: boolean
}

export type RuleUpsertPayload = Omit<RuleDto, 'id'>
