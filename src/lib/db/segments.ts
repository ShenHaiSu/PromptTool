import { invoke } from '@tauri-apps/api/core'

export type ImportMode = 'skip' | 'overwrite'

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

export async function dbImportSegments(payload: SegmentImportPayload): Promise<SegmentImportReport> {
  return invoke<SegmentImportReport>('db_import_segments', { payload })
}

export async function dbImportSegmentsText(
  text: string,
  unassignedStrategy: 'ignore' | 'to_camera' | 'prompt_new',
  mode: ImportMode,
): Promise<SegmentImportReport> {
  return invoke<SegmentImportReport>('db_import_segments_text', { text, unassignedStrategy, mode })
}

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

export async function dbBatchUpdateDisplayNames(
  payload: TranslationUpdatePayload,
): Promise<TranslationUpdateReport> {
  return invoke<TranslationUpdateReport>('db_batch_update_display_names', {
    payload: {
      dimensionId: payload.dimensionId,
      items: payload.items.map((i) => ({ id: i.id, displayName: i.displayName })),
    },
  })
}

export async function dbBatchUpdateDisplayNamesText(
  text: string,
  dimensionId: string,
): Promise<TranslationUpdateReport> {
  return invoke<TranslationUpdateReport>('db_batch_update_display_names_text', { text, dimensionId })
}

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
}

export async function dbExportLibrary(path?: string): Promise<string> {
  return invoke<string>('db_export_library', { path: path ?? null })
}

export async function dbImportLibrary(path: string, mode: ImportMode): Promise<LibraryImportReport> {
  return invoke<LibraryImportReport>('db_import_library', { path, mode })
}

export async function dbImportLibraryText(text: string, mode: ImportMode): Promise<LibraryImportReport> {
  return invoke<LibraryImportReport>('db_import_library_text', { text, mode })
}

export type ImportReport = {
  dimensions: number
  modules: number
  assemblies: number
  templates: number
  skipped: number
}

export async function dbImportLegacyDb(legacyPath: string): Promise<ImportReport> {
  return invoke<ImportReport>('db_import_legacy_db', { legacyPath })
}

export async function dbGetDefaultExportDir(): Promise<string> {
  return invoke<string>('db_get_default_export_dir')
}

export type ExportToDirResult = {
  path: string
  json: string
  filename: string
}

export async function dbExportLibraryToDir(dir: string): Promise<ExportToDirResult> {
  return invoke<ExportToDirResult>('db_export_library_to_dir', { dir })
}

export async function dbRevealInExplorer(path: string): Promise<void> {
  await invoke('db_reveal_in_explorer', { path })
}
