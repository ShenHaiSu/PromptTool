/** 拼装快照 CRUD + 回填，对标 commands/db.rs Assemblies 段（含 Need04 快照占位）。 */
import type { Assembly, AssemblyConfig, AssemblyItemRow, SelectedItem } from '@/engine/models'
import { getAll, getAllByIndex, getByKey, putValue, tx } from './idb'
import { getDb } from './seed'
import {
  b,
  parseIrJson,
  resolveModuleWithFallback,
  rowToAssembly,
  safeTruncate,
  shortTitleFromPrompt,
  uid,
  type AsmItemRow,
  type AsmRow,
  type DimRow,
  type ModRow,
} from './db.rows'

export async function dbSaveAssembly(
  title: string | null,
  irJson: string,
  finalPrompt: string,
  config: AssemblyConfig,
  items: SelectedItem[],
  isFavorite = false,
): Promise<string> {
  for (const it of items) {
    if (!it.module.dimensionKey?.trim()) {
      throw new Error(`assembly item 缺少 dimensionKey: moduleId=${it.module.id}`)
    }
  }
  const db = await getDb()
  const aid = uid()
  const ts = Date.now()
  const ttl = title?.trim() ? title : shortTitleFromPrompt(finalPrompt, ts)
  await tx(db, ['assemblies', 'assembly_items'], 'readwrite', (s) => {
    const jobs: Promise<unknown>[] = [
      putValue(s['assemblies']!, {
        id: aid, title: ttl, promptIr: irJson, finalPrompt,
        modelProfile: config.modelProfile, createdAt: ts,
        isFavorite: b(isFavorite), isDeleted: 0,
      } satisfies AsmRow),
    ]
    items.forEach((it, idx) => {
      jobs.push(
        putValue(s['assembly_items']!, {
          id: uid(), assemblyId: aid, moduleId: it.module.id, sortOrder: idx,
          weightOverride: it.weightOverride ?? null, isLocked: b(it.locked),
          dimensionKey: it.module.dimensionKey ?? '',
        } satisfies AsmItemRow),
      )
    })
    return Promise.all(jobs).then(() => undefined)
  })
  return aid
}

export async function dbSaveAssemblyFromIr(
  irJson: string,
  finalPrompt: string,
  config: AssemblyConfig,
  isFavorite = false,
): Promise<string> {
  const segs = parseIrJson(irJson)
  for (const seg of segs) {
    if (!seg.dimensionKey.trim()) throw new Error(`segment 缺少 dimensionKey: text=${seg.text}`)
    if (!seg.sourceModuleId.trim()) throw new Error(`segment 缺少 sourceModuleId: text=${seg.text}`)
  }
  const db = await getDb()
  const aid = uid()
  const ts = Date.now()
  await tx(db, ['assemblies', 'assembly_items'], 'readwrite', (s) => {
    const jobs: Promise<unknown>[] = [
      putValue(s['assemblies']!, {
        id: aid, title: shortTitleFromPrompt(finalPrompt, ts), promptIr: irJson, finalPrompt,
        modelProfile: config.modelProfile, createdAt: ts,
        isFavorite: b(isFavorite), isDeleted: 0,
      } satisfies AsmRow),
    ]
    segs.forEach((seg, idx) => {
      const wOv = Math.abs(seg.weight - 1.0) < 1e-9 ? null : seg.weight
      jobs.push(
        putValue(s['assembly_items']!, {
          id: uid(), assemblyId: aid, moduleId: seg.sourceModuleId, sortOrder: idx,
          weightOverride: wOv, isLocked: 0, dimensionKey: seg.dimensionKey,
        } satisfies AsmItemRow),
      )
    })
    return Promise.all(jobs).then(() => undefined)
  })
  return aid
}

export async function dbListRecent(limit = 20, offset = 0): Promise<Assembly[]> {
  const db = await getDb()
  const rows = await tx(db, 'assemblies', 'readonly', (s) => getAll<AsmRow>(s['assemblies']!))
  return rows
    .filter((a) => a.isDeleted === 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(offset, offset + limit)
    .map(rowToAssembly)
}

export async function dbListFavorites(limit = 100): Promise<Assembly[]> {
  const db = await getDb()
  const rows = await tx(db, 'assemblies', 'readonly', (s) => getAll<AsmRow>(s['assemblies']!))
  return rows
    .filter((a) => a.isDeleted === 0 && a.isFavorite !== 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(rowToAssembly)
}

export async function dbSearchAssemblies(keyword: string): Promise<Assembly[]> {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return []
  const db = await getDb()
  const rows = await tx(db, 'assemblies', 'readonly', (s) => getAll<AsmRow>(s['assemblies']!))
  return rows
    .filter(
      (a) =>
        a.isDeleted === 0 &&
        ((a.title ?? '').toLowerCase().includes(kw) ||
          a.finalPrompt.toLowerCase().includes(kw) ||
          a.promptIr.toLowerCase().includes(kw)),
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
    .map(rowToAssembly)
}

export async function dbGetAssemblyItems(assemblyId: string): Promise<AssemblyItemRow[]> {
  const db = await getDb()
  const rows = await tx(db, 'assembly_items', 'readonly', (s) =>
    getAllByIndex<AsmItemRow>(s['assembly_items']!, 'assemblyId', assemblyId),
  )
  return rows
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => ({
      id: r.id, assemblyId: r.assemblyId, moduleId: r.moduleId, sortOrder: r.sortOrder,
      weightOverride: r.weightOverride, isLocked: r.isLocked !== 0,
    }))
}

export async function dbLoadSelectedItems(assemblyId: string): Promise<SelectedItem[]> {
  const db = await getDb()
  const [asm, itemRows, modRows, dims] = await Promise.all([
    tx(db, 'assemblies', 'readonly', (s) => getByKey<AsmRow>(s['assemblies']!, assemblyId)),
    tx(db, 'assembly_items', 'readonly', (s) =>
      getAllByIndex<AsmItemRow>(s['assembly_items']!, 'assemblyId', assemblyId),
    ),
    tx(db, 'modules', 'readonly', (s) => getAll<ModRow>(s['modules']!)),
    tx(db, 'dimensions', 'readonly', (s) => getAll<DimRow>(s['dimensions']!)),
  ])
  const promptIr = asm && asm.isDeleted === 0 ? asm.promptIr : null
  const snapshot = new Map<string, { text: string; dk: string; weight: number }>()
  if (promptIr?.trim()) {
    for (const seg of parseIrJson(promptIr)) {
      if (!seg.dimensionKey.trim() || !seg.sourceModuleId.trim()) {
        throw new Error(`prompt_ir 含空 dimensionKey/sourceModuleId: text=${seg.text}`)
      }
      snapshot.set(seg.sourceModuleId, { text: seg.text, dk: seg.dimensionKey, weight: seg.weight })
    }
  }
  const modById = new Map(modRows.map((m) => [m.id, m]))
  const keyByDimId = new Map(dims.map((d) => [d.id, d.key]))
  const result: SelectedItem[] = []
  for (const ai of itemRows.sort((a, b) => a.sortOrder - b.sortOrder)) {
    const m = modById.get(ai.moduleId)
    const snap = snapshot.get(ai.moduleId) ?? null
    const effectiveDk = ai.dimensionKey?.trim()
      ? ai.dimensionKey
      : snap
        ? snap.dk
        : (m ? keyByDimId.get(m.dimensionId) ?? null : null)
    const module = resolveModuleWithFallback({
      mid: ai.moduleId,
      contentEn: m?.contentEn ?? null,
      displayName: m?.displayName ?? null,
      modWeight: m?.weight ?? null,
      dimensionId: m?.dimensionId ?? null,
      dimKey: m ? keyByDimId.get(m.dimensionId) ?? null : null,
      isDeleted: m ? m.isDeleted !== 0 : false,
      snapshot: snap,
      fallbackDk: effectiveDk,
    })
    if (!module.dimensionKey?.trim()) throw new Error(`assembly_items 缺少 dimensionKey: moduleId=${ai.moduleId}`)
    result.push({ module, weightOverride: ai.weightOverride, locked: ai.isLocked !== 0 })
  }
  if (result.length === 0 && promptIr?.trim()) {
    for (const seg of parseIrJson(promptIr)) {
      if (!seg.dimensionKey.trim() || !seg.sourceModuleId.trim()) {
        throw new Error(`prompt_ir 含空 dimensionKey/sourceModuleId: text=${seg.text}`)
      }
      const wOv = Math.abs(seg.weight - 1.0) < 1e-9 ? null : seg.weight
      result.push({
        module: {
          id: seg.sourceModuleId, dimensionId: '', contentEn: seg.text,
          displayName: seg.text === '' ? '[快照]' : safeTruncate(seg.text, 20),
          weight: seg.weight, isEnabled: false, isNsfw: false, usageCount: 0,
          exampleImage: null, notes: '[快照还原]', dimensionKey: seg.dimensionKey,
        },
        weightOverride: wOv,
        locked: false,
      })
    }
  }
  for (const it of result) {
    if (!it.module.dimensionKey?.trim()) throw new Error(`回填结果缺少 dimensionKey: moduleId=${it.module.id}`)
  }
  return result
}

export async function dbToggleFavorite(id: string): Promise<boolean> {
  const db = await getDb()
  return tx(db, 'assemblies', 'readwrite', async (s) => {
    const cur = await getByKey<AsmRow>(s['assemblies']!, id)
    if (!cur) throw new Error(`assembly not found: ${id}`)
    const next = cur.isFavorite !== 0 ? 0 : 1
    await putValue(s['assemblies']!, { ...cur, isFavorite: next } satisfies AsmRow)
    return next !== 0
  })
}

export async function dbRenameAssembly(id: string, title: string): Promise<void> {
  const db = await getDb()
  await tx(db, 'assemblies', 'readwrite', async (s) => {
    const cur = await getByKey<AsmRow>(s['assemblies']!, id)
    if (!cur) return
    await putValue(s['assemblies']!, { ...cur, title } satisfies AsmRow)
  })
}

export async function dbSoftDeleteAssembly(id: string): Promise<void> {
  const db = await getDb()
  await tx(db, 'assemblies', 'readwrite', async (s) => {
    const cur = await getByKey<AsmRow>(s['assemblies']!, id)
    if (!cur) return
    await putValue(s['assemblies']!, { ...cur, isDeleted: 1 } satisfies AsmRow)
  })
}
