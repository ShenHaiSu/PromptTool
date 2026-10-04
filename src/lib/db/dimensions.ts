import { invoke } from '@tauri-apps/api/core'
import type { Dimension } from '@/engine/models'

export type DimensionDto = {
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

export function toDimension(d: DimensionDto): Dimension {
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

export async function dbGetDimensions(): Promise<Dimension[]> {
  const rows = await invoke<DimensionDto[]>('db_get_dimensions')
  return rows.map(toDimension)
}

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
    sortOrder: sortOrder ?? null,
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

export type MigrateDimensionReport = {
  archive: Dimension
  fresh: Dimension
  moved: number
}

export async function dbMigrateDimension(args: { dimensionId: string }): Promise<MigrateDimensionReport> {
  const r = await invoke<{ archive: DimensionDto; fresh: DimensionDto; moved: number }>('db_migrate_dimension', {
    dimensionId: args.dimensionId,
  })
  return { archive: toDimension(r.archive), fresh: toDimension(r.fresh), moved: r.moved }
}

export type ClearDimensionReport = {
  cleared: number
}

export async function dbClearDimension(args: { dimensionId: string }): Promise<ClearDimensionReport> {
  const r = await invoke<{ cleared: number }>('db_clear_dimension', {
    dimensionId: args.dimensionId,
  })
  return { cleared: r.cleared }
}
