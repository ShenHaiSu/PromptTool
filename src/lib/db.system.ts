/** 文件落盘 / 多库注册表 / temp_carry。纯 Web 单库模式：写盘与多库抛错，读侧安全空值。 */
import { notSupportedInWeb } from './idb'
import { getByKey, putValue, tx } from './idb'
import { getDb } from './seed'
import type { ActiveInfo, ExportToDirResult, ImportReport, LibraryImportReport, RegistryRow, ValidateResult } from './db.types'

export async function dbExportCsv(_path: string, _resultsJson: string): Promise<void> {
  throw notSupportedInWeb('dbExportCsv')
}

export async function dbImportLegacyDb(_legacyPath: string): Promise<ImportReport> {
  throw notSupportedInWeb('dbImportLegacyDb')
}

export async function dbGetDefaultExportDir(): Promise<string> {
  return ''
}

export async function dbExportLibraryToDir(_dir: string): Promise<ExportToDirResult> {
  throw notSupportedInWeb('dbExportLibraryToDir')
}

export async function dbRevealInExplorer(_path: string): Promise<void> {
  throw notSupportedInWeb('dbRevealInExplorer')
}

export async function dbImportLibrary(
  _path: string,
  _mode: 'skip' | 'overwrite',
): Promise<LibraryImportReport> {
  throw notSupportedInWeb('dbImportLibrary')
}

export async function dbValidateBusiness(path: string): Promise<ValidateResult> {
  return { exists: false, valid: false, message: '纯 Web 单库模式', normalizedPath: path }
}

export async function dbCreateBusiness(_args: { path: string; alias: string; remark?: string; withSeed: boolean }): Promise<{ normalizedPath: string; alias: string }> {
  throw notSupportedInWeb('dbCreateBusiness')
}

export async function dbCheckAlias(alias: string): Promise<{ available: boolean; message: string }> {
  return { available: true, message: alias ? '纯 Web 单库模式' : '别名不能为空' }
}

export async function dbSwitchActive(_path: string): Promise<{ normalizedPath: string }> {
  throw notSupportedInWeb('dbSwitchActive')
}

export async function dbSetMaxActive(_maxActive: number): Promise<void> {
  throw notSupportedInWeb('dbSetMaxActive')
}

export async function dbGetActiveInfo(): Promise<ActiveInfo> {
  return { foreground: null, resident: [], maxActive: 1 }
}

export async function dbListRegistry(): Promise<RegistryRow[]> {
  return []
}

export async function dbRepairPath(_oldPath: string, _newPath: string): Promise<void> {
  throw notSupportedInWeb('dbRepairPath')
}

export async function dbRebuildMissing(_path: string, _withSeed: boolean): Promise<void> {
  throw notSupportedInWeb('dbRebuildMissing')
}

export async function dbRemoveRegistry(_path: string): Promise<{ wasForeground: boolean; nextForeground: string | null }> {
  throw notSupportedInWeb('dbRemoveRegistry')
}

export async function dbUpdateRegistryMeta(_path: string, _alias?: string, _remark?: string): Promise<void> {
  throw notSupportedInWeb('dbUpdateRegistryMeta')
}

// ------------------------------------------------------------------
// temp_carry → kv store（文档 05§2；替代阶段一的 localStorage）
// ------------------------------------------------------------------
const TEMP_CARRY_KEY = 'temp_carry'

export async function dbSetTempCarry(payload: { selectedItemIds: string[]; weightDraft?: Record<string, number> }): Promise<void> {
  const db = await getDb()
  await tx(db, 'kv', 'readwrite', (s) => putValue(s['kv']!, { k: TEMP_CARRY_KEY, v: payload }))
}

export async function dbGetTempCarry(): Promise<{ selectedItemIds: string[]; weightDraft?: Record<string, number> } | null> {
  const db = await getDb()
  const row = await tx(db, 'kv', 'readonly', (s) =>
    getByKey<{ k: string; v: { selectedItemIds: string[]; weightDraft?: Record<string, number> } }>(s['kv']!, TEMP_CARRY_KEY),
  )
  return row?.v ?? null
}
