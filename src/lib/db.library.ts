/** 词库导出 / 去重导入（pmf-library JSON），对标 db.rs export/import 段。 */
import { getAll, getAllByIndex, getByKey, putValue, tx } from './idb'
import { getDb } from './seed'
import { b, findModuleHitTx, uid, type DimRow, type ModRow, type RuleRow, type TagRow } from './db.rows'
import type { ImportMode, LibraryImportReport } from './db.types'

function emptyLibraryReport(): LibraryImportReport {
  return {
    dimensionsCreated: 0, dimensionsUpdated: 0, dimensionsSkipped: 0,
    modulesCreated: 0, modulesUpdated: 0, modulesSkipped: 0,
    rulesCreated: 0, rulesUpdated: 0, rulesSkipped: 0,
    tagsCreated: 0, tagsSkipped: 0, errors: [],
  }
}

/** 导出词库 JSON 文本（path 非空要求落盘，纯 Web 无 fs 能力 → 抛错由调用方 Blob 降级）。 */
export async function dbExportLibrary(path?: string): Promise<string> {
  if (path) throw new Error('NotSupportedInWeb: dbExportLibrary(path)（纯 Web 单库模式不支持，见 docs/webFullStack/06）')
  const db = await getDb()
  const [dims, mods, rules, tags] = await Promise.all([
    tx(db, 'dimensions', 'readonly', (s) => getAll<DimRow>(s['dimensions']!)),
    tx(db, 'modules', 'readonly', (s) => getAll<ModRow>(s['modules']!)),
    tx(db, 'rules', 'readonly', (s) => getAll<RuleRow>(s['rules']!)),
    tx(db, 'tags', 'readonly', (s) => getAll<TagRow>(s['tags']!)),
  ])
  const liveDims = dims.filter((d) => d.isDeleted === 0).sort((a, b) => a.sortOrder - b.sortOrder)
  const keyByDimId = new Map(liveDims.map((d) => [d.id, d.key]))
  const orderByDimId = new Map(liveDims.map((d) => [d.id, d.sortOrder]))
  const liveMods = mods
    .filter((m) => m.isDeleted === 0)
    .sort(
      (a, b) =>
        (orderByDimId.get(a.dimensionId) ?? 0) - (orderByDimId.get(b.dimensionId) ?? 0) ||
        a.createdAt - b.createdAt,
    )
  const liveRules = rules.filter((r) => r.isDeleted === 0).sort((a, b) => a.createdAt - b.createdAt)
  const liveTags = tags.filter((t) => t.isDeleted === 0).sort((a, b) => a.name.localeCompare(b.name))
  const doc = {
    format: 'pmf-library',
    formatVersion: 1,
    exportedAt: Date.now(),
    appVersion: 'web-pure',
    schemaVersion: 1,
    counts: {
      dimensions: liveDims.length,
      modules: liveMods.length,
      rules: liveRules.length,
      tags: liveTags.length,
    },
    dimensions: liveDims.map((d) => ({
      id: d.id, key: d.key, nameCn: d.nameCn, nameEn: d.nameEn, sortOrder: d.sortOrder,
      isMultiSelect: d.isMultiSelect !== 0, isEnabled: d.isEnabled !== 0, icon: d.icon,
      createdAt: d.createdAt, updatedAt: d.updatedAt,
    })),
    modules: liveMods.map((m) => ({
      id: m.id, dimensionId: m.dimensionId, contentEn: m.contentEn, displayName: m.displayName,
      weight: m.weight, isEnabled: m.isEnabled !== 0, isNsfw: m.isNsfw !== 0,
      usageCount: m.usageCount, exampleImage: m.exampleImage, notes: m.notes,
      dimensionKey: keyByDimId.get(m.dimensionId) ?? null,
    })),
    rules: liveRules.map((r) => ({
      id: r.id, name: r.name, type: r.type,
      sourceDimensionId: r.sourceDimensionId, sourceModuleId: r.sourceModuleId,
      targetDimensionId: r.targetDimensionId, targetModuleId: r.targetModuleId,
      message: r.message, isEnabled: r.isEnabled !== 0,
    })),
    tags: liveTags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
  }
  return JSON.stringify(doc)
}

type LibDim = {
  id?: string; key?: string; nameCn?: string; nameEn?: string | null; sortOrder?: number
  isMultiSelect?: boolean; isEnabled?: boolean; icon?: string | null
}
type LibMod = {
  id?: string; dimensionId?: string; contentEn?: string; displayName?: string; weight?: number
  isEnabled?: boolean; isNsfw?: boolean; usageCount?: number
  exampleImage?: string | null; notes?: string | null; dimensionKey?: string | null
}
type LibRule = {
  id?: string; name?: string; type?: string
  sourceDimensionId?: string | null; sourceModuleId?: string | null
  targetDimensionId?: string | null; targetModuleId?: string | null
  message?: string | null; isEnabled?: boolean
}
type LibTag = { id?: string; name?: string; color?: string | null }

/** 从 JSON 文本去重导入词库（前端 input[file] 读取内容后调用）。 */
export async function dbImportLibraryText(
  text: string,
  mode: ImportMode,
): Promise<LibraryImportReport> {
  const report = emptyLibraryReport()
  if (mode !== 'skip' && mode !== 'overwrite') throw new Error(`未知导入模式 '${mode}'（可选：skip / overwrite）`)
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(text) as Record<string, unknown>
  } catch (e) {
    throw new Error(`JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (doc['format'] !== 'pmf-library') throw new Error(`不支持的库文件格式 '${String(doc['format'])}'（应为 pmf-library）`)
  if (doc['formatVersion'] !== 1) throw new Error(`不支持的格式版本 ${String(doc['formatVersion'])}（当前支持 1）`)
  const fDims = (Array.isArray(doc['dimensions']) ? doc['dimensions'] : []) as LibDim[]
  const fMods = (Array.isArray(doc['modules']) ? doc['modules'] : []) as LibMod[]
  const fRules = (Array.isArray(doc['rules']) ? doc['rules'] : []) as LibRule[]
  const fTags = (Array.isArray(doc['tags']) ? doc['tags'] : []) as LibTag[]
  const db = await getDb()
  const ts = Date.now()
  const dimIdMap = new Map<string, string>()
  await tx(db, ['dimensions', 'modules', 'rules', 'tags'], 'readwrite', async (s) => {
    const ds = s['dimensions']!
    const ms = s['modules']!
    const rs = s['rules']!
    const gs = s['tags']!
    const byId = new Map((await getAll<DimRow>(ds)).map((d) => [d.id, d]))
    const liveByKey = new Map<string, DimRow>()
    const keyById = new Map<string, string>()
    for (const d of byId.values()) {
      keyById.set(d.id, d.key)
      if (d.isDeleted === 0) liveByKey.set(d.key, d)
    }
    // ---- 维度（去重键 key） ----
    for (const f of fDims) {
      const fkey = f.key ?? ''
      const fid = f.id ?? ''
      if (!fkey) {
        report.errors.push('存在缺少 key 的维度，已跳过')
        continue
      }
      const hit = liveByKey.get(fkey)
      if (hit) {
        if (fid) dimIdMap.set(fid, hit.id)
        if (mode === 'skip') {
          report.dimensionsSkipped += 1
        } else {
          await putValue(ds, {
            ...hit,
            nameCn: f.nameCn ?? hit.nameCn,
            nameEn: f.nameEn ?? hit.nameEn,
            sortOrder: f.sortOrder ?? hit.sortOrder,
            isMultiSelect: f.isMultiSelect != null ? b(f.isMultiSelect) : hit.isMultiSelect,
            isEnabled: f.isEnabled != null ? b(f.isEnabled) : hit.isEnabled,
            icon: f.icon ?? hit.icon,
            updatedAt: ts,
          } satisfies DimRow)
          report.dimensionsUpdated += 1
        }
        continue
      }
      const idOwner = fid ? byId.get(fid) : undefined
      if (idOwner && idOwner.key !== fkey) {
        const nid = uid()
        const row: DimRow = {
          id: nid, key: fkey, nameCn: f.nameCn ?? fkey, nameEn: f.nameEn ?? null,
          sortOrder: f.sortOrder ?? 0, isMultiSelect: b(!!f.isMultiSelect),
          isEnabled: b(f.isEnabled !== false), icon: f.icon ?? null,
          createdAt: ts, updatedAt: ts, isDeleted: 0,
        }
        await putValue(ds, row)
        if (fid) dimIdMap.set(fid, nid)
        byId.set(nid, row)
        liveByKey.set(fkey, row)
        keyById.set(nid, fkey)
        report.dimensionsCreated += 1
        report.errors.push(`维度 id '${fid}' 与库内 '${idOwner.key}'（key=${idOwner.key}）冲突，已作为新维度插入`)
        continue
      }
      const finalId = fid && !byId.has(fid) ? fid : uid()
      const row: DimRow = {
        id: finalId, key: fkey, nameCn: f.nameCn ?? fkey, nameEn: f.nameEn ?? null,
        sortOrder: f.sortOrder ?? 0, isMultiSelect: b(!!f.isMultiSelect),
        isEnabled: b(f.isEnabled !== false), icon: f.icon ?? null,
        createdAt: ts, updatedAt: ts, isDeleted: 0,
      }
      await putValue(ds, row)
      if (fid) dimIdMap.set(fid, finalId)
      byId.set(finalId, row)
      liveByKey.set(fkey, row)
      keyById.set(finalId, fkey)
      report.dimensionsCreated += 1
    }
    // ---- 词条（去重：文件 id 命中未删行，或解析后维度 + contentEn 精确） ----
    const dimIdByKey = new Map<string, string>()
    for (const [id, key] of keyById) {
      if (liveByKey.get(key)?.id === id) dimIdByKey.set(key, id)
    }
    const resolveModDim = (f: LibMod): string | null => {
      if (f.dimensionKey && dimIdByKey.has(f.dimensionKey)) return dimIdByKey.get(f.dimensionKey)!
      if (f.dimensionId && dimIdMap.has(f.dimensionId)) return dimIdMap.get(f.dimensionId)!
      if (f.dimensionId && liveByKey.has(byId.get(f.dimensionId)?.key ?? '')) {
        const owner = byId.get(f.dimensionId)!
        if (owner.isDeleted === 0) return owner.id
      }
      return null
    }
    for (const f of fMods) {
      const content = (f.contentEn ?? '').trim()
      if (!content) {
        report.modulesSkipped += 1
        continue
      }
      const dimId = resolveModDim(f)
      if (!dimId) {
        report.errors.push(`词条 '${f.displayName ?? content}' 的维度无法解析，已跳过`)
        report.modulesSkipped += 1
        continue
      }
      let hit: ModRow | null = null
      if (f.id) {
        const byFileId = await getByKey<ModRow>(ms, f.id)
        if (byFileId && byFileId.isDeleted === 0) hit = byFileId
      }
      hit ??= await findModuleHitTx(ms, dimId, content)
      if (hit) {
        if (mode === 'skip') {
          report.modulesSkipped += 1
        } else {
          await putValue(ms, {
            ...hit,
            contentEn: content,
            displayName: f.displayName ?? hit.displayName,
            weight: f.weight ?? hit.weight,
            isEnabled: f.isEnabled != null ? b(f.isEnabled) : hit.isEnabled,
            isNsfw: f.isNsfw != null ? b(f.isNsfw) : hit.isNsfw,
            notes: f.notes ?? hit.notes,
            updatedAt: ts,
          } satisfies ModRow)
          report.modulesUpdated += 1
        }
        continue
      }
      const nid = f.id && !(await getByKey<ModRow>(ms, f.id)) ? f.id : uid()
      await putValue(ms, {
        id: nid, dimensionId: dimId, contentEn: content,
        displayName: f.displayName ?? content, weight: f.weight ?? 1.0,
        isEnabled: b(f.isEnabled !== false), isNsfw: b(!!f.isNsfw),
        usageCount: f.usageCount ?? 0, exampleImage: f.exampleImage ?? null, notes: f.notes ?? null,
        createdAt: ts, updatedAt: ts, isDeleted: 0,
      } satisfies ModRow)
      report.modulesCreated += 1
    }
    // ---- 规则（去重：文件 id，或 name+type+四引用全等；引用经 dimIdMap 重映射） ----
    const allRules = await getAll<RuleRow>(rs)
    const remapDim = (ref: string | null | undefined): string | null => {
      if (!ref) return null
      if (dimIdMap.has(ref)) return dimIdMap.get(ref)!
      if (keyById.has(ref)) return ref
      return null
    }
    for (const f of fRules) {
      const name = f.name ?? ''
      const type = f.type ?? ''
      if (!name) {
        report.errors.push('存在缺少名称的规则，已跳过')
        report.rulesSkipped += 1
        continue
      }
      const srcD = remapDim(f.sourceDimensionId)
      const tgtD = remapDim(f.targetDimensionId)
      if ((f.sourceDimensionId && !srcD) || (f.targetDimensionId && !tgtD)) {
        report.errors.push(`规则 '${name}' 引用的维度/词条在当前库中不存在，已跳过`)
        report.rulesSkipped += 1
        continue
      }
      if (f.sourceModuleId && !(await getByKey<ModRow>(ms, f.sourceModuleId))) {
        report.errors.push(`规则 '${name}' 引用的维度/词条在当前库中不存在，已跳过`)
        report.rulesSkipped += 1
        continue
      }
      if (f.targetModuleId && !(await getByKey<ModRow>(ms, f.targetModuleId))) {
        report.errors.push(`规则 '${name}' 引用的维度/词条在当前库中不存在，已跳过`)
        report.rulesSkipped += 1
        continue
      }
      let hit: RuleRow | null = null
      if (f.id) {
        const byFileId = await getByKey<RuleRow>(rs, f.id)
        if (byFileId && byFileId.isDeleted === 0) hit = byFileId
      }
      hit ??= allRules.find(
        (r) =>
          r.isDeleted === 0 && r.name === name && r.type === type &&
          (r.sourceDimensionId ?? null) === srcD &&
          (r.sourceModuleId ?? null) === (f.sourceModuleId ?? null) &&
          (r.targetDimensionId ?? null) === tgtD &&
          (r.targetModuleId ?? null) === (f.targetModuleId ?? null),
      ) ?? null
      if (hit) {
        if (mode === 'skip') {
          report.rulesSkipped += 1
        } else {
          const next: RuleRow = {
            ...hit,
            sourceDimensionId: srcD,
            sourceModuleId: f.sourceModuleId ?? null,
            targetDimensionId: tgtD,
            targetModuleId: f.targetModuleId ?? null,
            message: f.message ?? hit.message,
          }
          await putValue(rs, next)
          allRules.splice(allRules.indexOf(hit), 1, next)
          report.rulesUpdated += 1
        }
        continue
      }
      const nid = f.id && !(await getByKey<RuleRow>(rs, f.id)) ? f.id : uid()
      const row: RuleRow = {
        id: nid, name, type, sourceDimensionId: srcD, sourceModuleId: f.sourceModuleId ?? null,
        targetDimensionId: tgtD, targetModuleId: f.targetModuleId ?? null,
        message: f.message ?? '', isEnabled: b(f.isEnabled !== false), createdAt: ts, isDeleted: 0,
      }
      await putValue(rs, row)
      allRules.push(row)
      report.rulesCreated += 1
    }
    // ---- 标签（去重键 name；无字段可更新，命中即 skipped） ----
    for (const f of fTags) {
      const tname = (f.name ?? '').trim()
      if (!tname) {
        report.tagsSkipped += 1
        continue
      }
      const existing = await getAllByIndex<TagRow>(gs, 'name', tname)
      if (existing.some((t) => t.isDeleted === 0)) {
        report.tagsSkipped += 1
        continue
      }
      const nid = f.id && !(await getByKey<TagRow>(gs, f.id)) ? f.id : uid()
      await putValue(gs, { id: nid, name: tname, color: f.color ?? null, createdAt: ts, isDeleted: 0 } satisfies TagRow)
      report.tagsCreated += 1
    }
  })
  return report
}
