import { invoke } from '@tauri-apps/api/core'
import type { Module } from '@/engine/models'
import type { ImportMode } from './segments'

export type ModuleDto = {
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

export function toModule(m: ModuleDto): Module {
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

export function toModuleDto(m: Module) {
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
  const m = await invoke<ModuleDto>('db_create_module', { dimId, contentEn, displayName, weight })
  return toModule(m)
}

export async function dbUpdateModule(m: Module): Promise<void> {
  await invoke('db_update_module', { m: toModuleDto(m) })
}

export async function dbSoftDeleteModule(id: string): Promise<void> {
  await invoke('db_soft_delete_module', { id })
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

export async function dbBatchCreateModules(payload: BatchCreatePayload): Promise<BatchCreateReport> {
  return invoke<BatchCreateReport>('db_batch_create_modules', {
    dimId: payload.dimId,
    items: payload.items.map((i) => ({
      contentEn: i.contentEn,
      displayName: i.displayName ?? null,
      weight: i.weight ?? null,
      isNsfw: i.isNsfw ?? null,
      notes: i.notes ?? null,
    })),
    mode: payload.mode,
    weight: payload.weight ?? null,
    isNsfw: payload.isNsfw ?? null,
  })
}

export async function dbBatchCreateModulesText(
  dimId: string,
  text: string,
  mode: ImportMode,
  weight?: number | null,
  isNsfw?: boolean,
): Promise<BatchCreateReport> {
  return invoke<BatchCreateReport>('db_batch_create_modules_text', {
    dimId,
    text,
    mode,
    weight: weight ?? null,
    isNsfw: isNsfw ?? null,
  })
}
