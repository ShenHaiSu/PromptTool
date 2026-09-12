/**
 * 阶段一纯 Web 空壳适配层（web-pure）。
 * 与 `db.tauri.ts.bak` 同名导出，stores/components 无需改 import 即可在浏览器跑通三栏空壳。
 * 数据为空属正常；阶段二（docs/webFullStack/05）将本文件替换为 IndexedDB 实现 + seed。
 */
import type {
  Assembly,
  AssemblyConfig,
  AssemblyItemRow,
  Dimension,
  Module,
  SelectedItem,
  Template,
} from '@/engine/models'
import type { RuleType } from '@/engine/models'

// ------------------------------------------------------------------
// 报告 / 载荷类型（与 db.tauri.ts.bak 一致，原样保留）
// ------------------------------------------------------------------

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

// ------------------------------------------------------------------
// 内存空壳（刷新即清空；阶段二改 IndexedDB 持久化）
// ------------------------------------------------------------------

const dimensions = new Map<string, Dimension>()
const modules = new Map<string, Module>()
const assemblies = new Map<string, Assembly>()
const assemblySelected = new Map<string, SelectedItem[]>()
const templates = new Map<string, { row: Template; config: AssemblyConfig; enabledKeys: string[]; items: SelectedItem[] }>()
const rules = new Map<string, RuleDto>()

const TEMP_CARRY_KEY = 'pmf:temp_carry'

function notSupported(fn: string): Error {
  return new Error(`NotSupportedInWeb: ${fn}（纯 Web 阶段一未实现，见 docs/webFullStack/06）`)
}

function uid(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  }
}

function liveDimensions(): Dimension[] {
  return [...dimensions.values()]
    .filter((d) => !d.isDeleted && d.isEnabled !== undefined)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

function liveModulesOf(dimId: string): Module[] {
  return [...modules.values()].filter((m) => m.dimensionId === dimId)
}

// ------------------------------------------------------------------
// Dimensions / Modules
// ------------------------------------------------------------------
export async function dbGetDimensions(): Promise<Dimension[]> {
  return liveDimensions()
}

export async function dbGetModulesByDimension(dimId: string): Promise<Module[]> {
  return liveModulesOf(dimId)
}

export async function dbGetAllModulesGrouped(): Promise<Record<string, Module[]>> {
  const out: Record<string, Module[]> = {}
  for (const d of liveDimensions()) out[d.id] = liveModulesOf(d.id)
  return out
}

export async function dbSearchModules(keyword: string): Promise<Module[]> {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return []
  return [...modules.values()].filter(
    (m) => m.contentEn.toLowerCase().includes(kw) || m.displayName.toLowerCase().includes(kw),
  )
}

export async function dbCreateModule(
  dimId: string,
  contentEn: string,
  displayName: string,
  weight = 1.0,
): Promise<Module> {
  const dim = dimensions.get(dimId)
  const m: Module = {
    id: uid(),
    dimensionId: dimId,
    contentEn,
    displayName,
    weight,
    isEnabled: true,
    isNsfw: false,
    usageCount: 0,
    exampleImage: null,
    notes: null,
    dimensionKey: dim?.key ?? null,
  }
  modules.set(m.id, m)
  return m
}

export async function dbUpdateModule(m: Module): Promise<void> {
  if (modules.has(m.id)) modules.set(m.id, { ...m })
}

export async function dbSoftDeleteModule(id: string): Promise<void> {
  modules.delete(id)
}

export async function dbCreateDimension(
  key: string,
  nameCn: string,
  nameEn?: string,
  sortOrder?: number,
  isMultiSelect?: boolean,
): Promise<Dimension> {
  const d: Dimension = {
    id: uid(),
    key,
    nameCn,
    nameEn: nameEn ?? '',
    sortOrder: sortOrder ?? 0,
    isMultiSelect: isMultiSelect ?? false,
    isEnabled: true,
    icon: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  dimensions.set(d.id, d)
  return d
}

export async function dbUpdateDimension(d: Dimension): Promise<void> {
  if (dimensions.has(d.id)) dimensions.set(d.id, { ...d, updatedAt: Date.now() })
}

export async function dbSoftDeleteDimension(id: string): Promise<void> {
  const d = dimensions.get(id)
  if (d) dimensions.set(id, { ...d, isDeleted: true })
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
  const id = uid()
  assemblies.set(id, {
    id,
    title,
    promptIrJson: irJson,
    finalPrompt,
    modelProfile: config.modelProfile,
    createdAt: Date.now(),
    isFavorite,
  })
  assemblySelected.set(id, items.map((it) => ({ ...it, module: { ...it.module } })))
  return id
}

export async function dbSaveAssemblyFromIr(
  irJson: string,
  finalPrompt: string,
  config: AssemblyConfig,
  isFavorite = false,
): Promise<string> {
  return dbSaveAssembly(null, irJson, finalPrompt, config, [], isFavorite)
}

function sortedAssemblies(): Assembly[] {
  return [...assemblies.values()]
    .filter((a) => !a.isDeleted)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function dbListRecent(limit = 20, offset = 0): Promise<Assembly[]> {
  return sortedAssemblies().slice(offset, offset + limit)
}

export async function dbListFavorites(limit = 100): Promise<Assembly[]> {
  return sortedAssemblies().filter((a) => a.isFavorite).slice(0, limit)
}

export async function dbSearchAssemblies(keyword: string): Promise<Assembly[]> {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return []
  return sortedAssemblies().filter(
    (a) => (a.title ?? '').toLowerCase().includes(kw) || a.finalPrompt.toLowerCase().includes(kw),
  )
}

export async function dbGetAssemblyItems(assemblyId: string): Promise<AssemblyItemRow[]> {
  const items = assemblySelected.get(assemblyId) ?? []
  return items.map((it, i) => ({
    id: `${assemblyId}:${i}`,
    assemblyId,
    moduleId: it.module.id,
    sortOrder: i,
    weightOverride: it.weightOverride ?? null,
    isLocked: it.locked,
  }))
}

export async function dbLoadSelectedItems(assemblyId: string): Promise<SelectedItem[]> {
  const items = assemblySelected.get(assemblyId) ?? []
  return items.map((it) => {
    const live = modules.get(it.module.id)
    return live ? { ...it, module: { ...live } } : { ...it, module: { ...it.module } }
  })
}

export async function dbToggleFavorite(id: string): Promise<boolean> {
  const a = assemblies.get(id)
  if (!a) return false
  const next = !a.isFavorite
  assemblies.set(id, { ...a, isFavorite: next })
  return next
}

export async function dbRenameAssembly(id: string, title: string): Promise<void> {
  const a = assemblies.get(id)
  if (a) assemblies.set(id, { ...a, title })
}

export async function dbSoftDeleteAssembly(id: string): Promise<void> {
  const a = assemblies.get(id)
  if (a) assemblies.set(id, { ...a, isDeleted: true })
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
  selectedItems: SelectedItem[],
): Promise<string> {
  if (selectedItems.length === 0) throw new Error('模板内容为空，请先配置画布')
  const id = uid()
  templates.set(id, {
    row: { id, name, description: desc, configJson: JSON.stringify(config), coverPrompt: cover, createdAt: Date.now() },
    config: { ...config },
    enabledKeys: [...enabledKeys],
    items: selectedItems.map((it) => ({ ...it, module: { ...it.module } })),
  })
  return id
}

export async function dbListTemplates(): Promise<Template[]> {
  return [...templates.values()].map((t) => t.row).filter((t) => !t.isDeleted)
}

export async function dbApplyTemplate(
  id: string,
): Promise<[AssemblyConfig, string[], SelectedItem[]]> {
  const t = templates.get(id)
  if (!t) throw new Error('模板不存在')
  return [t.config, [...t.enabledKeys], t.items.map((it) => ({ ...it, module: { ...it.module } }))]
}

export async function dbSoftDeleteTemplate(id: string): Promise<void> {
  const t = templates.get(id)
  if (t) templates.set(id, { ...t, row: { ...t.row, isDeleted: true } })
}

// ------------------------------------------------------------------
// 文件 / 注册表 / 多库（阶段一不支持，阶段三浏览器化；读侧给安全空值）
// ------------------------------------------------------------------
export async function dbExportCsv(_path: string, _resultsJson: string): Promise<void> {
  throw notSupported('dbExportCsv')
}

export async function dbImportLegacyDb(_legacyPath: string): Promise<ImportReport> {
  throw notSupported('dbImportLegacyDb')
}

export async function dbGetDefaultExportDir(): Promise<string> {
  return ''
}

export async function dbExportLibraryToDir(_dir: string): Promise<ExportToDirResult> {
  throw notSupported('dbExportLibraryToDir')
}

export async function dbRevealInExplorer(_path: string): Promise<void> {
  throw notSupported('dbRevealInExplorer')
}

export async function dbExportLibrary(_path?: string): Promise<string> {
  return JSON.stringify({ format: 'pmf-library/v1', dimensions: [], modules: [], rules: [], tags: [] })
}

export async function dbImportLibrary(
  _path: string,
  _mode: ImportMode,
): Promise<LibraryImportReport> {
  throw notSupported('dbImportLibrary')
}

function emptyLibraryReport(): LibraryImportReport {
  return {
    dimensionsCreated: 0, dimensionsUpdated: 0, dimensionsSkipped: 0,
    modulesCreated: 0, modulesUpdated: 0, modulesSkipped: 0,
    rulesCreated: 0, rulesUpdated: 0, rulesSkipped: 0,
    tagsCreated: 0, tagsSkipped: 0, errors: [],
  }
}

export async function dbImportLibraryText(
  _text: string,
  _mode: ImportMode,
): Promise<LibraryImportReport> {
  return emptyLibraryReport()
}

// ------------------------------------------------------------------
// 片段 / 批量 / 翻译（阶段一内存最小实现）
// ------------------------------------------------------------------
function emptySegmentReport(): SegmentImportReport {
  return {
    prompts: 0, segmentsTotal: 0, segmentsImported: 0, segmentsSkipped: 0,
    segmentsIgnoredUnassigned: 0, modulesCreated: 0, modulesUpdated: 0,
    modulesSkipped: 0, errors: [], warnings: ['阶段一空壳：未实际入库'],
  }
}

export async function dbImportSegments(_payload: SegmentImportPayload): Promise<SegmentImportReport> {
  return emptySegmentReport()
}

export async function dbImportSegmentsText(
  _text: string,
  _unassignedStrategy: 'ignore' | 'to_camera' | 'prompt_new',
  _mode: ImportMode,
): Promise<SegmentImportReport> {
  return emptySegmentReport()
}

export async function dbBatchCreateModules(payload: BatchCreatePayload): Promise<BatchCreateReport> {
  let created = 0
  for (const item of payload.items) {
    const contentEn = item.contentEn.trim()
    if (!contentEn) continue
    await dbCreateModule(payload.dimId, contentEn, item.displayName?.trim() || contentEn, item.weight ?? payload.weight ?? 1.0)
    created += 1
  }
  return {
    totalRequested: payload.items.length, valid: created, modulesCreated: created,
    modulesUpdated: 0, modulesSkipped: payload.items.length - created,
    emptyIgnored: 0, duplicateInBatch: 0, truncated: 0, errors: [], warnings: [],
  }
}

export async function dbBatchCreateModulesText(
  dimId: string,
  text: string,
  mode: ImportMode,
  weight?: number | null,
  isNsfw?: boolean,
): Promise<BatchCreateReport> {
  const items: BatchCreateItem[] = text.split(/\r?\n/).map((line) => ({ contentEn: line.trim() })).filter((i) => i.contentEn)
  return dbBatchCreateModules({ dimId, items, mode, weight, isNsfw })
}

// ------------------------------------------------------------------
// 多库注册表（阶段一下线，读侧空值；写侧抛错）
// ------------------------------------------------------------------
export async function dbValidateBusiness(path: string): Promise<ValidateResult> {
  return { exists: false, valid: false, message: '纯 Web 单库模式', normalizedPath: path }
}

export async function dbCreateBusiness(_args: { path: string; alias: string; remark?: string; withSeed: boolean }): Promise<{ normalizedPath: string; alias: string }> {
  throw notSupported('dbCreateBusiness')
}

export async function dbCheckAlias(alias: string): Promise<{ available: boolean; message: string }> {
  return { available: true, message: alias ? '纯 Web 单库模式' : '别名不能为空' }
}

export async function dbSwitchActive(_path: string): Promise<{ normalizedPath: string }> {
  throw notSupported('dbSwitchActive')
}

export async function dbSetMaxActive(_maxActive: number): Promise<void> {
  throw notSupported('dbSetMaxActive')
}

export async function dbGetActiveInfo(): Promise<ActiveInfo> {
  return { foreground: null, resident: [], maxActive: 1 }
}

export async function dbListRegistry(): Promise<RegistryRow[]> {
  return []
}

export async function dbRepairPath(_oldPath: string, _newPath: string): Promise<void> {
  throw notSupported('dbRepairPath')
}

export async function dbRebuildMissing(_path: string, _withSeed: boolean): Promise<void> {
  throw notSupported('dbRebuildMissing')
}

export async function dbRemoveRegistry(_path: string): Promise<{ wasForeground: boolean; nextForeground: string | null }> {
  throw notSupported('dbRemoveRegistry')
}

export async function dbUpdateRegistryMeta(_path: string, _alias?: string, _remark?: string): Promise<void> {
  throw notSupported('dbUpdateRegistryMeta')
}

export async function dbSetTempCarry(payload: { selectedItemIds: string[]; weightDraft?: Record<string, number> }): Promise<void> {
  try {
    localStorage.setItem(TEMP_CARRY_KEY, JSON.stringify(payload))
  } catch { /* ignore */ }
}

export async function dbGetTempCarry(): Promise<{ selectedItemIds: string[]; weightDraft?: Record<string, number> } | null> {
  try {
    const raw = localStorage.getItem(TEMP_CARRY_KEY)
    return raw ? JSON.parse(raw) as { selectedItemIds: string[]; weightDraft?: Record<string, number> } : null
  } catch {
    return null
  }
}

// ------------------------------------------------------------------
// 翻译回填（阶段一内存实现）
// ------------------------------------------------------------------
export async function dbBatchUpdateDisplayNames(
  payload: TranslationUpdatePayload,
): Promise<TranslationUpdateReport> {
  let updated = 0
  let skipped = 0
  for (const item of payload.items) {
    const m = modules.get(item.id)
    if (!m) { skipped += 1; continue }
    modules.set(item.id, { ...m, displayName: item.displayName })
    updated += 1
  }
  return { totalRequested: payload.items.length, updated, skipped, warnings: [], errors: [] }
}

export async function dbBatchUpdateDisplayNamesText(
  _text: string,
  _dimensionId: string,
): Promise<TranslationUpdateReport> {
  return { totalRequested: 0, updated: 0, skipped: 0, warnings: ['阶段一空壳：未实际回填'], errors: [] }
}

// ------------------------------------------------------------------
// 规则（内存实现）
// ------------------------------------------------------------------
export async function dbListRules(_includeDisabled = true): Promise<RuleDto[]> {
  return [...rules.values()]
}

export async function dbCreateRule(payload: RuleUpsertPayload): Promise<RuleDto> {
  const row: RuleDto = { ...payload, id: uid() }
  rules.set(row.id, row)
  return row
}

export async function dbUpdateRule(id: string, payload: RuleUpsertPayload): Promise<RuleDto> {
  const row: RuleDto = { ...payload, id }
  rules.set(id, row)
  return row
}

export async function dbDeleteRule(id: string): Promise<void> {
  rules.delete(id)
}

export async function dbToggleRule(id: string, isEnabled: boolean): Promise<RuleDto> {
  const row = rules.get(id)
  if (!row) throw new Error('规则不存在')
  const next = { ...row, isEnabled }
  rules.set(id, next)
  return next
}
