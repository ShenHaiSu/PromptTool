import { invoke } from '@tauri-apps/api/core'
import type {
  Assembly,
  AssemblyConfig,
  AssemblyItemRow,
  SelectedItem,
  Template,
} from '@/engine/models'
import type { RuleType } from '@/engine/models'
import { toModule, toModuleDto, type ModuleDto } from './modules'

export type AssemblyDto = {
  id: string
  title: string | null
  promptIrJson: string
  finalPrompt: string
  modelProfile: string
  createdAt: number
  isFavorite: boolean
}

export type TemplateDto = {
  id: string
  name: string
  description: string | null
  configJson: string | null
  coverPrompt: string | null
  createdAt: number
}

export function toAssembly(a: AssemblyDto): Assembly {
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

export function toTemplate(t: TemplateDto): Template {
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

export async function dbSaveTemplate(
  name: string,
  desc: string | null,
  config: AssemblyConfig,
  enabledKeys: string[],
  cover: string | null,
  selectedItems: SelectedItem[],
): Promise<string> {
  if (selectedItems.length === 0) throw new Error('模板内容为空，请先配置画布')
  for (const it of selectedItems) {
    if (!it.module.dimensionKey?.trim()) throw new Error(`模板项缺少 dimensionKey: moduleId=${it.module.id}`)
  }
  return invoke<string>('db_save_template', {
    name,
    desc,
    config: toConfigDto(config),
    enabledKeys,
    cover,
    selectedItems: selectedItems.map((it) => ({
      module: toModuleDto(it.module),
      weightOverride: it.weightOverride ?? null,
      locked: it.locked,
    })),
  })
}

export async function dbListTemplates(): Promise<Template[]> {
  const rows = await invoke<TemplateDto[]>('db_list_templates')
  return rows.map(toTemplate)
}

type AssemblyConfigDtoRaw = {
  separator: string
  useWeightBrackets: boolean
  modelProfile: string
  sortBy: string
}

export async function dbApplyTemplate(
  id: string,
): Promise<[AssemblyConfig, string[], SelectedItem[]]> {
  const [cfg, keys, items] = await invoke<[AssemblyConfigDtoRaw, string[], { module: ModuleDto; weightOverride: number | null; locked: boolean }[]]>('db_apply_template', { id })
  if (items.some((r) => !r.module.dimensionKey?.trim())) throw new Error('模板回填 dimensionKey 为空')
  return [
    {
      separator: cfg.separator,
      useWeightBrackets: cfg.useWeightBrackets,
      modelProfile: cfg.modelProfile as AssemblyConfig['modelProfile'],
      sortBy: cfg.sortBy as AssemblyConfig['sortBy'],
    },
    keys,
    items.map((r) => ({ module: toModule(r.module), weightOverride: r.weightOverride, locked: r.locked })),
  ]
}

export async function dbSoftDeleteTemplate(id: string): Promise<void> {
  await invoke('db_soft_delete_template', { id })
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

export async function dbListRules(includeDisabled = true): Promise<RuleDto[]> {
  return invoke<RuleDto[]>('db_list_rules', { includeDisabled })
}

export async function dbCreateRule(payload: RuleUpsertPayload): Promise<RuleDto> {
  return invoke<RuleDto>('db_create_rule', { payload })
}

export async function dbUpdateRule(id: string, payload: RuleUpsertPayload): Promise<RuleDto> {
  return invoke<RuleDto>('db_update_rule', { id, payload })
}

export async function dbDeleteRule(id: string): Promise<void> {
  await invoke('db_delete_rule', { id })
}

export async function dbToggleRule(id: string, isEnabled: boolean): Promise<RuleDto> {
  return invoke<RuleDto>('db_toggle_rule', { id, isEnabled })
}
