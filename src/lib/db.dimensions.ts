/** 维度 / 词条 CRUD，对标 commands/db.rs 维度词条段。 */
import type { Dimension, Module } from '@/engine/models'
import { getAll, getAllByIndex, getByKey, putValue, tx } from './idb'
import { getDb } from './seed'
import { b, dimKeyMap, rowToDimension, rowToModule, uid, type DimRow, type ModRow } from './db.rows'

export async function dbGetDimensions(): Promise<Dimension[]> {
  const db = await getDb()
  const rows = await tx(db, 'dimensions', 'readonly', (s) => getAll<DimRow>(s['dimensions']!))
  return rows
    .filter((d) => d.isDeleted === 0)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(rowToDimension)
}

export async function dbGetModulesByDimension(dimId: string): Promise<Module[]> {
  const db = await getDb()
  const keys = await dimKeyMap()
  const rows = await tx(db, 'modules', 'readonly', (s) =>
    getAllByIndex<ModRow>(s['modules']!, 'dimensionId', dimId),
  )
  return rows
    .filter((m) => m.isDeleted === 0)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((m) => rowToModule(m, keys.get(m.dimensionId)?.key ?? null))
}

export async function dbGetAllModulesGrouped(): Promise<Record<string, Module[]>> {
  const db = await getDb()
  const [dims, mods] = await Promise.all([
    tx(db, 'dimensions', 'readonly', (s) => getAll<DimRow>(s['dimensions']!)),
    tx(db, 'modules', 'readonly', (s) => getAll<ModRow>(s['modules']!)),
  ])
  const info = new Map(dims.map((d) => [d.id, { key: d.key, sortOrder: d.sortOrder }]))
  const live = mods.filter((m) => m.isDeleted === 0)
  live.sort(
    (a, b) =>
      (info.get(a.dimensionId)?.sortOrder ?? 0) - (info.get(b.dimensionId)?.sortOrder ?? 0) ||
      a.createdAt - b.createdAt,
  )
  const out: Record<string, Module[]> = {}
  for (const m of live) {
    const key = info.get(m.dimensionId)?.key ?? ''
    ;(out[key] ??= []).push(rowToModule(m, info.get(m.dimensionId)?.key ?? null))
  }
  return out
}

export async function dbSearchModules(keyword: string): Promise<Module[]> {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return []
  const db = await getDb()
  const keys = await dimKeyMap()
  const rows = await tx(db, 'modules', 'readonly', (s) => getAll<ModRow>(s['modules']!))
  return rows
    .filter(
      (m) =>
        m.isDeleted === 0 &&
        (m.contentEn.toLowerCase().includes(kw) ||
          m.displayName.toLowerCase().includes(kw) ||
          (m.notes ?? '').toLowerCase().includes(kw)),
    )
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((m) => rowToModule(m, keys.get(m.dimensionId)?.key ?? null))
}

export async function dbCreateModule(
  dimId: string,
  contentEn: string,
  displayName: string,
  weight = 1.0,
): Promise<Module> {
  const db = await getDb()
  const id = uid()
  const ts = Date.now()
  const row: ModRow = {
    id, dimensionId: dimId, contentEn, displayName, weight,
    isEnabled: 1, isNsfw: 0, usageCount: 0, exampleImage: null, notes: null,
    createdAt: ts, updatedAt: ts, isDeleted: 0,
  }
  const dimKey = await tx(db, ['modules', 'dimensions'], 'readwrite', async (s) => {
    await putValue(s['modules']!, row)
    const d = await getByKey<DimRow>(s['dimensions']!, dimId)
    return d?.key ?? null
  })
  return rowToModule(row, dimKey)
}

export async function dbUpdateModule(m: Module): Promise<void> {
  const db = await getDb()
  const ts = Date.now()
  await tx(db, 'modules', 'readwrite', async (s) => {
    const cur = await getByKey<ModRow>(s['modules']!, m.id)
    if (!cur) return
    await putValue(s['modules']!, {
      ...cur,
      contentEn: m.contentEn,
      displayName: m.displayName,
      weight: m.weight,
      isEnabled: b(m.isEnabled),
      isNsfw: b(m.isNsfw),
      notes: m.notes ?? null,
      updatedAt: ts,
    } satisfies ModRow)
  })
}

export async function dbSoftDeleteModule(id: string): Promise<void> {
  const db = await getDb()
  await tx(db, 'modules', 'readwrite', async (s) => {
    const cur = await getByKey<ModRow>(s['modules']!, id)
    if (!cur) return
    await putValue(s['modules']!, { ...cur, isDeleted: 1, updatedAt: Date.now() } satisfies ModRow)
  })
}

export async function dbCreateDimension(
  key: string,
  nameCn: string,
  nameEn?: string,
  sortOrder?: number,
  isMultiSelect?: boolean,
): Promise<Dimension> {
  const k = key.trim()
  const ncn = nameCn.trim()
  if (!k) throw new Error('分类键名不能为空')
  if (!ncn) throw new Error('中文名称不能为空')
  const db = await getDb()
  const dup = await tx(db, 'dimensions', 'readonly', (s) =>
    getAllByIndex<DimRow>(s['dimensions']!, 'key', k),
  )
  if (dup.some((d) => d.isDeleted === 0)) throw new Error(`分类键名 '${k}' 已存在，请使用其他键名`)
  const ts = Date.now()
  const row: DimRow = {
    id: uid(), key: k, nameCn: ncn, nameEn: nameEn?.trim() ? nameEn.trim() : null,
    sortOrder: sortOrder ?? 0, isMultiSelect: b(!!isMultiSelect), isEnabled: 1, icon: null,
    createdAt: ts, updatedAt: ts, isDeleted: 0,
  }
  await tx(db, 'dimensions', 'readwrite', (s) => putValue(s['dimensions']!, row))
  return rowToDimension(row)
}

export async function dbUpdateDimension(d: Dimension): Promise<void> {
  const ncn = d.nameCn.trim()
  if (!ncn) throw new Error('中文名称不能为空')
  const db = await getDb()
  await tx(db, 'dimensions', 'readwrite', async (s) => {
    const cur = await getByKey<DimRow>(s['dimensions']!, d.id)
    if (!cur || cur.isDeleted !== 0) throw new Error(`维度 '${d.id}' 不存在或已删除`)
    await putValue(s['dimensions']!, {
      ...cur,
      nameCn: ncn,
      nameEn: d.nameEn || null,
      sortOrder: d.sortOrder,
      isMultiSelect: b(d.isMultiSelect),
      isEnabled: b(d.isEnabled),
      updatedAt: Date.now(),
    } satisfies DimRow)
  })
}

export async function dbSoftDeleteDimension(id: string): Promise<void> {
  const db = await getDb()
  await tx(db, ['dimensions', 'modules'], 'readwrite', async (s) => {
    const mods = await getAllByIndex<ModRow>(s['modules']!, 'dimensionId', id)
    const live = mods.filter((m) => m.isDeleted === 0).length
    if (live > 0) throw new Error(`该维度下仍有 ${live} 个词条，请先删除所有词条后再删除维度`)
    const cur = await getByKey<DimRow>(s['dimensions']!, id)
    if (!cur || cur.isDeleted !== 0) throw new Error(`维度 '${id}' 不存在或已删除`)
    await putValue(s['dimensions']!, { ...cur, isDeleted: 1, updatedAt: Date.now() } satisfies DimRow)
  })
}
