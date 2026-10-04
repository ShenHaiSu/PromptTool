import { invoke } from '@tauri-apps/api/core'

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

export async function dbValidateBusiness(path: string): Promise<ValidateResult> {
  return invoke<ValidateResult>('db_validate_business', { path })
}

export async function dbCreateBusiness(args: { path: string; alias: string; remark?: string; withSeed: boolean }): Promise<{ normalizedPath: string; alias: string }> {
  return invoke('db_create_business', { path: args.path, alias: args.alias, remark: args.remark ?? null, withSeed: args.withSeed })
}

export async function dbCheckAlias(alias: string): Promise<{ available: boolean; message: string }> {
  return invoke('db_check_alias', { alias })
}

export async function dbSwitchActive(path: string): Promise<{ normalizedPath: string }> {
  return invoke('db_switch_active', { path })
}

export async function dbSetMaxActive(maxActive: number): Promise<void> {
  return invoke('db_set_max_active', { maxActive })
}

export async function dbGetActiveInfo(): Promise<ActiveInfo> {
  return invoke<ActiveInfo>('db_get_active_info')
}

export async function dbListRegistry(): Promise<RegistryRow[]> {
  return invoke<RegistryRow[]>('db_list_registry')
}

export async function dbRepairPath(oldPath: string, newPath: string): Promise<void> {
  return invoke('db_repair_path', { oldPath, newPath })
}

export async function dbRebuildMissing(path: string, withSeed: boolean): Promise<void> {
  return invoke('db_rebuild_missing', { path, withSeed })
}

export async function dbRemoveRegistry(path: string): Promise<{ wasForeground: boolean; nextForeground: string | null }> {
  return invoke('db_remove_registry', { path })
}

export async function dbUpdateRegistryMeta(path: string, alias?: string, remark?: string): Promise<void> {
  return invoke('db_update_registry_meta', { path, alias: alias ?? null, remark: remark ?? null })
}

export async function dbSetTempCarry(payload: { selectedItemIds: string[]; weightDraft?: Record<string, number> }): Promise<void> {
  return invoke('db_set_temp_carry', { payloadJson: JSON.stringify(payload) })
}

export async function dbGetTempCarry(): Promise<{ selectedItemIds: string[]; weightDraft?: Record<string, number> } | null> {
  const r = await invoke<{ payloadJson: string | null }>('db_get_temp_carry')
  return r.payloadJson ? JSON.parse(r.payloadJson) as { selectedItemIds: string[]; weightDraft?: Record<string, number> } : null
}

export async function dbExportCsv(path: string, resultsJson: string): Promise<void> {
  await invoke('db_export_csv', { path, resultsJson })
}

export type StatsLedgerExportToDirResult = {
  path: string
  filename: string
}

export async function dbExportStatsLedgerToDir(
  csvText: string,
  from: string,
  to: string,
): Promise<StatsLedgerExportToDirResult> {
  return invoke<StatsLedgerExportToDirResult>('db_export_stats_ledger_to_dir', { csvText, from, to })
}
