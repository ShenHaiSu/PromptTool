/**
 * Rust Command invoke 封装 — 对应 Python repository.py
 * 注意：Tauri v2 的 #[tauri::command] 默认将参数名转为 camelCase，
 * 因此 invoke 键名须与 Rust 形参的 camelCase 形式一致（ir_json → irJson），
 * 而非直接使用 snake_case 形参名；DTO 字段为 camelCase（serde rename_all）。
 * 踩坑记录见 docs/pitfalls/01-invoke-arg-case.md
 */
import { invoke } from '@tauri-apps/api/core'
import type {
  AssemblyConfig,
  Dimension,
  Module,
  Assembly,
  AssemblyItemRow,
  SelectedItem,
  Template,
} from '@/engine/models'

// ------------------------------------------------------------------
// DTO types (camelCase from Rust serde rename_all)
// ------------------------------------------------------------------

type DimensionDto = {
  id: string
  key: string
  nameCn: string
  nameEn: string | null
  sortOrder: number
  isMultiSelect: boolean
  isEnabled: boolean
  icon: string | null
  createdAt: number | null
  updatedAt: number | null
}

type ModuleDto = {
  id: string
  dimensionId: string
  contentEn: string
  displayName: string
  weight: number
  isEnabled: boolean
  isNsfw: boolean
  usageCount: number
  exampleImage: string | null
  notes: string | null
  dimensionKey: string | null
}

type AssemblyDto = {
  id: string
  title: string | null
  promptIrJson: string
  finalPrompt: string
  modelProfile: string
  createdAt: number
  isFavorite: boolean
}

type TemplateDto = {
  id: string
  name: string
  description: string | null
  configJson: string | null
  coverPrompt: string | null
  createdAt: number
}

function toDimension(d: DimensionDto): Dimension {
  return {
    id: d.id,
    key: d.key,
    nameCn: d.nameCn,
    nameEn: d.nameEn ?? '',
    sortOrder: d.sortOrder,
    isMultiSelect: d.isMultiSelect,
    isEnabled: d.isEnabled,
    icon: d.icon,
    createdAt: d.createdAt ?? undefined,
    updatedAt: d.updatedAt ?? undefined,
  }
}

function toModule(m: ModuleDto): Module {
  return {
    id: m.id,
    dimensionId: m.dimensionId,
    contentEn: m.contentEn,
    displayName: m.displayName,
    weight: m.weight,
    isEnabled: m.isEnabled,
    isNsfw: m.isNsfw,
    usageCount: m.usageCount,
    exampleImage: m.exampleImage,
    notes: m.notes,
    dimensionKey: m.dimensionKey,
  }
}

function toAssembly(a: AssemblyDto): Assembly {
  return {
    id: a.id,
    title: a.title,
    promptIrJson: a.promptIrJson,
    finalPrompt: a.finalPrompt,
    modelProfile: a.modelProfile,
    createdAt: a.createdAt,
    isFavorite: a.isFavorite,
  }
}

function toTemplate(t: TemplateDto): Template {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    configJson: t.configJson ?? '',
    coverPrompt: t.coverPrompt,
    createdAt: t.createdAt,
  }
}

function toConfigDto(c: AssemblyConfig) {
  return {
    separator: c.separator,
    useWeightBrackets: c.useWeightBrackets,
    modelProfile: c.modelProfile,
    sortBy: c.sortBy,
  }
}

function toModuleDto(m: Module) {
  return {
    id: m.id,
    dimensionId: m.dimensionId,
    contentEn: m.contentEn,
    displayName: m.displayName,
    weight: m.weight,
    isEnabled: m.isEnabled,
    isNsfw: m.isNsfw,
    usageCount: m.usageCount,
    exampleImage: m.exampleImage ?? null,
    notes: m.notes ?? null,
    dimensionKey: m.dimensionKey ?? null,
  }
}

// ------------------------------------------------------------------
// Dimensions / Modules
// ------------------------------------------------------------------
export async function dbGetDimensions(): Promise<Dimension[]> {
  const rows = await invoke<DimensionDto[]>('db_get_dimensions')
  return rows.map(toDimension)
}

export async function dbGetModulesByDimension(dimId: string): Promise<Module[]> {
  const rows = await invoke<ModuleDto[]>('db_get_modules_by_dimension', { dimId })
  return rows.map(toModule)
}

export async function dbGetAllModulesGrouped(): Promise<Record<string, Module[]>> {
  const map = await invoke<Record<string, ModuleDto[]>>('db_get_all_modules_grouped')
  const out: Record<string, Module[]> = {}
  for (const [k, v] of Object.entries(map)) out[k] = v.map(toModule)
  return out
}

export async function dbSearchModules(keyword: string): Promise<Module[]> {
  const rows = await invoke<ModuleDto[]>('db_search_modules', { keyword })
  return rows.map(toModule)
}

export async function dbCreateModule(
  dimId: string,
  contentEn: string,
  displayName: string,
  weight = 1.0,
): Promise<Module> {
  const m = await invoke<ModuleDto>('db_create_module', {
    dimId,
    contentEn,
    displayName,
    weight,
  })
  return toModule(m)
}

export async function dbUpdateModule(m: Module): Promise<void> {
  await invoke('db_update_module', { m: toModuleDto(m) })
}

export async function dbSoftDeleteModule(id: string): Promise<void> {
  await invoke('db_soft_delete_module', { id })
}

// ------------------------------------------------------------------
// Dimension CRUD (Need02 §02)
// ------------------------------------------------------------------
export async function dbCreateDimension(
  key: string,
  nameCn: string,
  nameEn?: string,
  sortOrder?: number,
  isMultiSelect?: boolean,
): Promise<Dimension> {
  const d = await invoke<DimensionDto>('db_create_dimension', {
    key,
    nameCn,
    nameEn: nameEn ?? null,
    sortOrder: sortOrder ?? 0,
    isMultiSelect: isMultiSelect ?? false,
  })
  return toDimension(d)
}

export async function dbUpdateDimension(d: Dimension): Promise<void> {
  await invoke('db_update_dimension', {
    d: {
      id: d.id,
      key: d.key,
      nameCn: d.nameCn,
      nameEn: d.nameEn || null,
      sortOrder: d.sortOrder,
      isMultiSelect: d.isMultiSelect,
      isEnabled: d.isEnabled,
      icon: d.icon ?? null,
      createdAt: d.createdAt ?? null,
      updatedAt: d.updatedAt ?? null,
    },
  })
}

export async function dbSoftDeleteDimension(id: string): Promise<void> {
  await invoke('db_soft_delete_dimension', { id })
}

// ------------------------------------------------------------------
// Assemblies
// ------------------------------------------------------------------
export async function dbSaveAssembly(
  title: string | null,
  irJson: string,
  finalPrompt: string,
  config: AssemblyConfig,
  items: SelectedItem[],
  isFavorite = false,
): Promise<string> {
  return invoke<string>('db_save_assembly', {
    title,
    irJson,
    finalPrompt,
    config: toConfigDto(config),
    items: items.map((it) => ({
      module: toModuleDto(it.module),
      weightOverride: it.weightOverride ?? null,
      locked: it.locked,
    })),
    isFavorite,
  })
}

export async function dbSaveAssemblyFromIr(
  irJson: string,
  finalPrompt: string,
  config: AssemblyConfig,
  isFavorite = false,
): Promise<string> {
  return invoke<string>('db_save_assembly_from_ir', {
    irJson,
    finalPrompt,
    config: toConfigDto(config),
    isFavorite,
  })
}

export async function dbListRecent(limit = 20, offset = 0): Promise<Assembly[]> {
  const rows = await invoke<AssemblyDto[]>('db_list_recent', { limit, offset })
  return rows.map(toAssembly)
}

export async function dbListFavorites(limit = 100): Promise<Assembly[]> {
  const rows = await invoke<AssemblyDto[]>('db_list_favorites', { limit })
  return rows.map(toAssembly)
}

export async function dbSearchAssemblies(keyword: string): Promise<Assembly[]> {
  const rows = await invoke<AssemblyDto[]>('db_search_assemblies', { keyword })
  return rows.map(toAssembly)
}

export async function dbGetAssemblyItems(assemblyId: string): Promise<AssemblyItemRow[]> {
  return invoke<AssemblyItemRow[]>('db_get_assembly_items', { assemblyId })
}

export async function dbLoadSelectedItems(assemblyId: string): Promise<SelectedItem[]> {
  const rows = await invoke<
    { module: ModuleDto; weightOverride: number | null; locked: boolean }[]
  >('db_load_selected_items', { assemblyId })
  return rows.map((r) => ({
    module: toModule(r.module),
    weightOverride: r.weightOverride,
    locked: r.locked,
  }))
}

export async function dbToggleFavorite(id: string): Promise<boolean> {
  return invoke<boolean>('db_toggle_favorite', { id })
}

export async function dbRenameAssembly(id: string, title: string): Promise<void> {
  await invoke('db_rename_assembly', { id, title })
}

export async function dbSoftDeleteAssembly(id: string): Promise<void> {
  await invoke('db_soft_delete_assembly', { id })
}

// ------------------------------------------------------------------
// Templates
// ------------------------------------------------------------------
export async function dbSaveTemplate(
  name: string,
  desc: string | null,
  config: AssemblyConfig,
  enabledKeys: string[],
  cover: string | null,
): Promise<string> {
  return invoke<string>('db_save_template', {
    name,
    desc,
    config: toConfigDto(config),
    enabledKeys,
    cover,
  })
}

export async function dbListTemplates(): Promise<Template[]> {
  const rows = await invoke<TemplateDto[]>('db_list_templates')
  return rows.map(toTemplate)
}

export async function dbApplyTemplate(
  id: string,
): Promise<[AssemblyConfig, string[]]> {
  const [cfg, keys] = await invoke<[AssemblyConfigDtoRaw, string[]]>('db_apply_template', { id })
  return [
    {
      separator: cfg.separator,
      useWeightBrackets: cfg.useWeightBrackets,
      modelProfile: cfg.modelProfile as AssemblyConfig['modelProfile'],
      sortBy: cfg.sortBy as AssemblyConfig['sortBy'],
    },
    keys,
  ]
}

type AssemblyConfigDtoRaw = {
  separator: string
  useWeightBrackets: boolean
  modelProfile: string
  sortBy: string
}

export async function dbSoftDeleteTemplate(id: string): Promise<void> {
  await invoke('db_soft_delete_template', { id })
}

// ------------------------------------------------------------------
// Utils
// ------------------------------------------------------------------
export async function dbExportCsv(path: string, resultsJson: string): Promise<void> {
  await invoke('db_export_csv', { path, resultsJson })
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

// ------------------------------------------------------------------
// 词库导出 / 去重导入（pmf-library JSON）
// ------------------------------------------------------------------
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
}

/**
 * 导出词库。
 * - path 为空 → 返回 JSON 文本（前端可 Blob 下载）
 * - path 非空 → Rust 原子写盘后同样返回 JSON 文本
 */
export async function dbExportLibrary(path?: string): Promise<string> {
  return invoke<string>('db_export_library', { path: path ?? null })
}

/** 从磁盘文件去重导入词库（path 方式，供文件对话框/脚本使用） */
export async function dbImportLibrary(
  path: string,
  mode: ImportMode,
): Promise<LibraryImportReport> {
  return invoke<LibraryImportReport>('db_import_library', { path, mode })
}

/** 从 JSON 文本去重导入词库（前端 `<input type=file>` 读取内容后调用） */
export async function dbImportLibraryText(
  text: string,
  mode: ImportMode,
): Promise<LibraryImportReport> {
  return invoke<LibraryImportReport>('db_import_library_text', { text, mode })
}
