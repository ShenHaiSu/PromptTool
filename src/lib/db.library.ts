/** 词库导出 / 去重导入（pmf-library JSON），对标 db.rs export/import 段。 */
import { clearStore, delByKey, getAll, getAllByIndex, getByKey, putValue, tx } from './idb'
import { getDb } from './seed'
import { b, findModuleHitTx, uid, type AsmItemRow, type AsmRow, type DimRow, type ModRow, type RuleRow, type TagRow, type TplItemRow, type TplRow } from './db.rows'
import type { ImportMode, LibraryImportReport } from './db.types'
import { emit as emitEvent, LIBRARY_CHANGED } from './libraryEvents'

function emitLibraryChanged(): void {
  emitEvent(LIBRARY_CHANGED)
}

export const LIBRARY_FORMAT = 'pmf-library'
export const LIBRARY_VERSION = 1
/** 大文件提示阈值：导出 JSON 超过 50MB 先提示（08§2）。 */
export const LIBRARY_LARGE_EXPORT_BYTES = 50 * 1024 * 1024

export type LibraryExportOptions = {
  /** 完整备份（含历史拼装快照/模板）。默认 false：历史/模板不随词库导出，避免臃肿（08§1）。 */
  includeHistory?: boolean
}

function emptyLibraryReport(): LibraryImportReport {
  return {
    dimensionsCreated: 0, dimensionsUpdated: 0, dimensionsSkipped: 0,
    modulesCreated: 0, modulesUpdated: 0, modulesSkipped: 0,
    rulesCreated: 0, rulesUpdated: 0, rulesSkipped: 0,
    tagsCreated: 0, tagsSkipped: 0, errors: [],
    templatesCreated: 0, templatesUpdated: 0, templatesSkipped: 0,
    assembliesCreated: 0, assembliesSkipped: 0,
    moduleTagsCreated: 0, moduleTagsSkipped: 0,
  }
}

/**
 * 导出词库 JSON 文本。
 * - 顶层同时写 snake_case 主键（`version`/`exported_at`/`module_tags`/`templates`）与
 *   旧版兼容 camelCase 别名（`formatVersion`/`exportedAt`/`appVersion`/`schemaVersion`/`counts`），
 *   新旧格式双向可读。
 * - 默认不含历史/拼装快照与模板内容（`templates: []`、`assemblies: []`），
 *   `includeHistory: true` 时作为“完整备份（含历史/模板）”一并导出。
 * - path 非空要求落盘，纯 Web 无 fs 能力 → 抛错由调用方 Blob 降级。
 */
export async function dbExportLibrary(path?: string, opts?: LibraryExportOptions): Promise<string> {
  if (path) throw new Error('NotSupportedInWeb: dbExportLibrary(path)（纯 Web 单库模式不支持，见 docs/webFullStack/06）')
  const includeHistory = opts?.includeHistory === true
  const db = await getDb()
  const [dims, mods, rules, tags, moduleTags, tpls, tplItems, asms, asmItems] = await Promise.all([
    tx(db, 'dimensions', 'readonly', (s) => getAll<DimRow>(s['dimensions']!)),
    tx(db, 'modules', 'readonly', (s) => getAll<ModRow>(s['modules']!)),
    tx(db, 'rules', 'readonly', (s) => getAll<RuleRow>(s['rules']!)),
    tx(db, 'tags', 'readonly', (s) => getAll<TagRow>(s['tags']!)),
    tx(db, 'module_tags', 'readonly', (s) => getAll<Record<string, unknown>>(s['module_tags']!)).catch(() => [] as Record<string, unknown>[]),
    tx(db, 'templates', 'readonly', (s) => getAll<TplRow>(s['templates']!)),
    tx(db, 'template_items', 'readonly', (s) => getAll<TplItemRow>(s['template_items']!)),
    includeHistory
      ? tx(db, 'assemblies', 'readonly', (s) => getAll<AsmRow>(s['assemblies']!))
      : Promise.resolve([] as AsmRow[]),
    includeHistory
      ? tx(db, 'assembly_items', 'readonly', (s) => getAll<AsmItemRow>(s['assembly_items']!))
      : Promise.resolve([] as AsmItemRow[]),
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
  const liveTpls = tpls.filter((t) => t.isDeleted === 0).sort((a, b) => b.createdAt - a.createdAt)
  const itemsByTpl = new Map<string, TplItemRow[]>()
  for (const ti of tplItems) {
    const arr = itemsByTpl.get(ti.templateId) ?? []
    arr.push(ti)
    itemsByTpl.set(ti.templateId, arr)
  }
  for (const arr of itemsByTpl.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder)
  const liveAsms = asms.filter((a) => a.isDeleted === 0).sort((a, b) => b.createdAt - a.createdAt)
  const itemsByAsm = new Map<string, AsmItemRow[]>()
  for (const ai of asmItems) {
    const arr = itemsByAsm.get(ai.assemblyId) ?? []
    arr.push(ai)
    itemsByAsm.set(ai.assemblyId, arr)
  }
  for (const arr of itemsByAsm.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder)
  const now = Date.now()
  const doc = {
    format: LIBRARY_FORMAT,
    // 08§1 snake_case 主键 + 旧版 camelCase 兼容别名
    version: LIBRARY_VERSION,
    formatVersion: LIBRARY_VERSION,
    exported_at: now,
    exportedAt: now,
    appVersion: 'web-pure',
    schemaVersion: 1,
    counts: {
      dimensions: liveDims.length,
      modules: liveMods.length,
      rules: liveRules.length,
      tags: liveTags.length,
      moduleTags: moduleTags.length,
      templates: includeHistory ? liveTpls.length : 0,
      assemblies: includeHistory ? liveAsms.length : 0,
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
    module_tags: moduleTags,
    moduleTags,
    templates: includeHistory
      ? liveTpls.map((t) => ({
        id: t.id, name: t.name, description: t.description, configJson: t.configJson,
        coverPrompt: t.coverPrompt, createdAt: t.createdAt,
        items: (itemsByTpl.get(t.id) ?? []).map((ti) => ({
          id: ti.id, moduleId: ti.moduleId, dimensionKey: ti.dimensionKey,
          sortOrder: ti.sortOrder, weightOverride: ti.weightOverride, isLocked: ti.isLocked !== 0,
        })),
      }))
      : [],
    template_items: includeHistory ? tplItems : [],
    assemblies: includeHistory
      ? liveAsms.map((a) => ({
        id: a.id, title: a.title, promptIr: a.promptIr, finalPrompt: a.finalPrompt,
        modelProfile: a.modelProfile, createdAt: a.createdAt, isFavorite: a.isFavorite !== 0,
        items: (itemsByAsm.get(a.id) ?? []).map((ai) => ({
          id: ai.id, moduleId: ai.moduleId, sortOrder: ai.sortOrder,
          weightOverride: ai.weightOverride, isLocked: ai.isLocked !== 0, dimensionKey: ai.dimensionKey,
        })),
      }))
      : [],
    assembly_items: includeHistory ? asmItems : [],
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
type LibModuleTag = { key?: string; moduleId?: string; tagId?: string; [k: string]: unknown }
type LibTemplateItem = {
  id?: string; moduleId?: string; dimensionKey?: string; sortOrder?: number
  weightOverride?: number | null; isLocked?: boolean
}
type LibTemplate = {
  id?: string; name?: string; description?: string | null; configJson?: string
  coverPrompt?: string | null; createdAt?: number; items?: LibTemplateItem[]
}
type LibAssemblyItem = {
  id?: string; moduleId?: string; sortOrder?: number
  weightOverride?: number | null; isLocked?: boolean; dimensionKey?: string
}
type LibAssembly = {
  id?: string; title?: string | null; promptIr?: string; finalPrompt?: string
  modelProfile?: string; createdAt?: number; isFavorite?: boolean; items?: LibAssemblyItem[]
}

type ParsedLibraryDoc = {
  dims: LibDim[]
  mods: LibMod[]
  rules: LibRule[]
  tags: LibTag[]
  moduleTags: LibModuleTag[]
  templates: LibTemplate[]
  templateItemsFlat: LibTemplateItem[] & { templateId?: string }[]
  assemblies: LibAssembly[]
}

function parseLibraryDoc(text: string): ParsedLibraryDoc {
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(text) as Record<string, unknown>
  } catch (e) {
    throw new Error(`JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (doc['format'] !== LIBRARY_FORMAT) throw new Error(`不支持的库文件格式 '${String(doc['format'])}'（应为 pmf-library）`)
  const ver = doc['version'] ?? doc['formatVersion']
  if (ver !== 1) throw new Error(`不支持的格式版本 ${String(ver)}（当前支持 1）`)
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
  return {
    dims: arr(doc['dimensions']) as unknown as LibDim[],
    mods: arr(doc['modules']) as unknown as LibMod[],
    rules: arr(doc['rules']) as unknown as LibRule[],
    tags: arr(doc['tags']) as unknown as LibTag[],
    moduleTags: (arr(doc['module_tags']).length ? arr(doc['module_tags']) : arr(doc['moduleTags'])) as unknown as LibModuleTag[],
    templates: arr(doc['templates']) as unknown as LibTemplate[],
    templateItemsFlat: arr(doc['template_items']) as unknown as LibTemplateItem[] & { templateId?: string }[],
    assemblies: arr(doc['assemblies']) as unknown as LibAssembly[],
  }
}

function checkMode(mode: ImportMode): void {
  if (mode !== 'skip' && mode !== 'overwrite') throw new Error(`未知导入模式 '${mode}'（可选：skip / overwrite）`)
}

/**
 * 导入预览：只读解析文件并按去重规则估算新增/覆盖/跳过计数，不写 IDB（08§2 二次确认用）。
 * 口径与 dbImportLibraryText 的命中规则一致；错误行宽容跳过并汇总。
 */
export async function dbPreviewLibraryText(
  text: string,
  mode: ImportMode,
): Promise<LibraryImportReport> {
  checkMode(mode)
  const report = emptyLibraryReport()
  const { dims: fDims, mods: fMods, rules: fRules, tags: fTags, moduleTags: fMt, templates: fTpls, assemblies: fAsms } = parseLibraryDoc(text)
  const db = await getDb()
  const [allDims, allMods, allRules, allTags, allMt] = await Promise.all([
    tx(db, 'dimensions', 'readonly', (s) => getAll<DimRow>(s['dimensions']!)),
    tx(db, 'modules', 'readonly', (s) => getAll<ModRow>(s['modules']!)),
    tx(db, 'rules', 'readonly', (s) => getAll<RuleRow>(s['rules']!)),
    tx(db, 'tags', 'readonly', (s) => getAll<TagRow>(s['tags']!)),
    tx(db, 'module_tags', 'readonly', (s) => getAll<Record<string, unknown>>(s['module_tags']!)).catch(() => [] as Record<string, unknown>[]),
  ])
  const liveByKey = new Map(allDims.filter((d) => d.isDeleted === 0).map((d) => [d.key, d]))
  const keyById = new Map(allDims.map((d) => [d.id, d.key]))
  const modById = new Map(allMods.map((m) => [m.id, m]))
  const modKeys = new Set(allMods.filter((m) => m.isDeleted === 0).map((m) => `${m.dimensionId}|${m.contentEn}`))
  // 维度预览（文件内 key 去重：同一 key 重复出现时第二份起按命中口径计入跳过/覆盖）
  const seenDimKeys = new Set<string>()
  for (const f of fDims) {
    const fkey = f.key ?? ''
    if (!fkey) { report.errors.push('存在缺少 key 的维度，已跳过'); continue }
    if (seenDimKeys.has(fkey)) {
      if (mode === 'skip') report.dimensionsSkipped += 1
      else report.dimensionsUpdated += 1
      continue
    }
    seenDimKeys.add(fkey)
    if (liveByKey.has(fkey)) {
      if (mode === 'skip') report.dimensionsSkipped += 1
      else report.dimensionsUpdated += 1
    } else {
      report.dimensionsCreated += 1
    }
  }
  // 维度映射（含文件内新增维度）：key → 最终 dimensionId
  const dimIdByKey = new Map<string, string>()
  for (const [key, row] of liveByKey) dimIdByKey.set(key, row.id)
  for (const f of fDims) {
    const fkey = f.key ?? ''
    if (!fkey || dimIdByKey.has(fkey)) continue
    dimIdByKey.set(fkey, f.id && !keyById.has(f.id) ? f.id : `preview:${fkey}`)
  }
  const resolveModDimPreview = (f: LibMod): string | null => {
    if (f.dimensionKey && dimIdByKey.has(f.dimensionKey)) return dimIdByKey.get(f.dimensionKey)!
    if (f.dimensionId && dimIdByKey.has(keyById.get(f.dimensionId) ?? '')) return dimIdByKey.get(keyById.get(f.dimensionId)!)!
    if (f.dimensionId && liveByKey.has(keyById.get(f.dimensionId) ?? '')) return f.dimensionId
    return null
  }
  const seenModSigs = new Set<string>()
  for (const f of fMods) {
    const content = (f.contentEn ?? '').trim()
    if (!content) { report.modulesSkipped += 1; continue }
    const dimId = resolveModDimPreview(f)
    if (!dimId) { report.errors.push(`词条 '${f.displayName ?? content}' 的维度无法解析，已跳过`); report.modulesSkipped += 1; continue }
    const sig = `${dimId}|${content}`
    let hit = false
    if (f.id) {
      const byFileId = modById.get(f.id)
      if (byFileId && byFileId.isDeleted === 0) hit = true
    }
    hit ||= modKeys.has(sig) || seenModSigs.has(sig)
    seenModSigs.add(sig)
    if (hit) {
      if (mode === 'skip') report.modulesSkipped += 1
      else report.modulesUpdated += 1
    } else {
      report.modulesCreated += 1
      modKeys.add(sig)
    }
  }
  const ruleSig = (r: RuleRow): string =>
    [r.name, r.type, r.sourceDimensionId ?? '', r.sourceModuleId ?? '', r.targetDimensionId ?? '', r.targetModuleId ?? ''].join('|')
  const liveRuleIds = new Set(allRules.filter((r) => r.isDeleted === 0).map((r) => r.id))
  const liveRuleSigs = new Set(allRules.filter((r) => r.isDeleted === 0).map(ruleSig))
  const seenRuleSigs = new Set<string>()
  for (const f of fRules) {
    const name = f.name ?? ''
    if (!name) { report.errors.push('存在缺少名称的规则，已跳过'); report.rulesSkipped += 1; continue }
    const sig = [name, f.type ?? '', f.sourceDimensionId ?? '', f.sourceModuleId ?? '', f.targetDimensionId ?? '', f.targetModuleId ?? ''].join('|')
    let hit = (f.id && liveRuleIds.has(f.id)) || liveRuleSigs.has(sig) || seenRuleSigs.has(sig)
    hit ||= false
    seenRuleSigs.add(sig)
    if (hit) {
      if (mode === 'skip') report.rulesSkipped += 1
      else report.rulesUpdated += 1
    } else {
      report.rulesCreated += 1
      if (f.id) liveRuleIds.add(f.id)
      liveRuleSigs.add(sig)
    }
  }
  const liveTagNames = new Set(allTags.filter((t) => t.isDeleted === 0).map((t) => t.name))
  for (const f of fTags) {
    const tname = (f.name ?? '').trim()
    if (!tname || liveTagNames.has(tname)) { report.tagsSkipped += 1; continue }
    liveTagNames.add(tname)
    report.tagsCreated += 1
  }
  const mtKeys = new Set(allMt.map((r) => String(r['key'] ?? `${String(r['moduleId'] ?? '')}:${String(r['tagId'] ?? '')}`)))
  for (const f of fMt) {
    const k = String(f.key ?? `${f.moduleId ?? ''}:${f.tagId ?? ''}`)
    if (!f.moduleId || !f.tagId || mtKeys.has(k)) { report.moduleTagsSkipped += 1; continue }
    mtKeys.add(k)
    report.moduleTagsCreated += 1
  }
  const tplIds = new Set<string>()
  const tplCount = await tx(db, 'templates', 'readonly', (s) => getAll<TplRow>(s['templates']!))
    .then((rows) => new Set(rows.filter((t) => t.isDeleted === 0).map((t) => t.id)))
    .catch(() => new Set<string>())
  for (const f of fTpls) {
    if (!f.id || !f.name) { report.templatesSkipped += 1; continue }
    if (tplIds.has(f.id)) {
      if (mode === 'skip') report.templatesSkipped += 1
      else report.templatesUpdated += 1
      continue
    }
    tplIds.add(f.id)
    if (tplCount.has(f.id)) {
      if (mode === 'skip') report.templatesSkipped += 1
      else report.templatesUpdated += 1
    } else {
      report.templatesCreated += 1
    }
  }
  const asmIds = await tx(db, 'assemblies', 'readonly', (s) => getAll<AsmRow>(s['assemblies']!))
    .then((rows) => new Set(rows.filter((a) => a.isDeleted === 0).map((a) => a.id)))
    .catch(() => new Set<string>())
  for (const f of fAsms) {
    if (!f.id) { report.assembliesSkipped += 1; continue }
    if (asmIds.has(f.id)) report.assembliesSkipped += 1
    else { asmIds.add(f.id); report.assembliesCreated += 1 }
  }
  return report
}

/** 从 JSON 文本去重导入词库（前端 input[file] 读取内容后调用）。 */
export async function dbImportLibraryText(
  text: string,
  mode: ImportMode,
): Promise<LibraryImportReport> {
  checkMode(mode)
  const report = emptyLibraryReport()
  const { dims: fDims, mods: fMods, rules: fRules, tags: fTags, moduleTags: fMt, templates: fTpls, templateItemsFlat, assemblies: fAsms } = parseLibraryDoc(text)
  const db = await getDb()
  const ts = Date.now()
  const dimIdMap = new Map<string, string>()
  await tx(db, ['dimensions', 'modules', 'rules', 'tags', 'module_tags', 'templates', 'template_items', 'assemblies', 'assembly_items'], 'readwrite', async (s) => {
    const ds = s['dimensions']!
    const ms = s['modules']!
    const rs = s['rules']!
    const gs = s['tags']!
    const mts = s['module_tags']!
    const tps = s['templates']!
    const tis = s['template_items']!
    const as = s['assemblies']!
    const ais = s['assembly_items']!
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
    // ---- 词条-标签关联（module_tags；悬空引用宽容跳过并汇总） ----
    for (const f of fMt) {
      const moduleId = f.moduleId ?? null
      const tagId = f.tagId ?? null
      const key = String(f.key ?? `${moduleId ?? ''}:${tagId ?? ''}`)
      if (!moduleId || !tagId) {
        report.errors.push('存在缺少 moduleId/tagId 的标签关联，已跳过')
        report.moduleTagsSkipped += 1
        continue
      }
      const dup = await getByKey<Record<string, unknown>>(mts, key)
      if (dup) {
        report.moduleTagsSkipped += 1
        continue
      }
      const [m, g] = await Promise.all([
        getByKey<ModRow>(ms, moduleId),
        getByKey<TagRow>(gs, tagId),
      ])
      if (!m || m.isDeleted !== 0 || !g || g.isDeleted !== 0) {
        report.errors.push('标签关联引用的词条/标签在当前库中不存在，已跳过')
        report.moduleTagsSkipped += 1
        continue
      }
      await putValue(mts, { key, moduleId, tagId })
      report.moduleTagsCreated += 1
    }
    // ---- 模板（完整备份；去重键 id；skip 命中即跳过，overwrite 更新字段并重建明细） ----
    const putTemplateItems = async (templateId: string, items: LibTemplateItem[]): Promise<void> => {
      const olds = await getAllByIndex<TplItemRow>(tis, 'templateId', templateId)
      for (const o of olds) {
        // overwrite 重建明细：先删旧明细再插入，保证幂等
        await delByKey(tis, o.id)
      }
      const sorted = [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      for (let i = 0; i < sorted.length; i++) {
        const it = sorted[i]!
        if (!it.moduleId || !it.dimensionKey) {
          report.errors.push('模板明细缺少 moduleId/dimensionKey，已跳过该明细')
          continue
        }
        await putValue(tis, {
          id: it.id ?? uid(), templateId, moduleId: it.moduleId,
          dimensionKey: it.dimensionKey, sortOrder: it.sortOrder ?? i,
          weightOverride: it.weightOverride ?? null, isLocked: b(!!it.isLocked),
        } satisfies TplItemRow)
      }
    }
    const flatByTpl = new Map<string, LibTemplateItem[]>()
    for (const fi of templateItemsFlat) {
      const tid = String((fi as { templateId?: string }).templateId ?? '')
      if (!tid) continue
      const arr = flatByTpl.get(tid) ?? []
      arr.push(fi)
      flatByTpl.set(tid, arr)
    }
    for (const f of fTpls) {
      if (!f.id || !f.name) {
        report.errors.push('存在缺少 id/名称的模板，已跳过')
        report.templatesSkipped += 1
        continue
      }
      const items = [...(f.items ?? []), ...(flatByTpl.get(f.id) ?? [])]
      const cur = await getByKey<TplRow>(tps, f.id)
      if (cur && cur.isDeleted === 0) {
        if (mode === 'skip') {
          report.templatesSkipped += 1
        } else {
          await putValue(tps, {
            ...cur, name: f.name, description: f.description ?? cur.description,
            configJson: f.configJson ?? cur.configJson, coverPrompt: f.coverPrompt ?? cur.coverPrompt,
          } satisfies TplRow)
          await putTemplateItems(f.id, items)
          report.templatesUpdated += 1
        }
        continue
      }
      await putValue(tps, {
        id: f.id, name: f.name, description: f.description ?? null,
        configJson: f.configJson ?? '', coverPrompt: f.coverPrompt ?? null,
        createdAt: f.createdAt ?? ts, isDeleted: 0,
      } satisfies TplRow)
      await putTemplateItems(f.id, items)
      report.templatesCreated += 1
    }
    // ---- 拼装快照（完整备份；去重键 id；历史只增不改，命中即跳过） ----
    for (const f of fAsms) {
      if (!f.id) {
        report.errors.push('存在缺少 id 的历史快照，已跳过')
        report.assembliesSkipped += 1
        continue
      }
      const cur = await getByKey<AsmRow>(as, f.id)
      if (cur && cur.isDeleted === 0) {
        report.assembliesSkipped += 1
        continue
      }
      await putValue(as, {
        id: f.id, title: f.title ?? null, promptIr: f.promptIr ?? '{"segments":[]}',
        finalPrompt: f.finalPrompt ?? '', modelProfile: f.modelProfile ?? 'sd',
        createdAt: f.createdAt ?? ts, isFavorite: b(!!f.isFavorite), isDeleted: 0,
      } satisfies AsmRow)
      const sorted = [...(f.items ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      for (let i = 0; i < sorted.length; i++) {
        const it = sorted[i]!
        if (!it.moduleId) {
          report.errors.push('历史快照明细缺少 moduleId，已跳过该明细')
          continue
        }
        await putValue(ais, {
          id: it.id ?? uid(), assemblyId: f.id, moduleId: it.moduleId,
          sortOrder: it.sortOrder ?? i, weightOverride: it.weightOverride ?? null,
          isLocked: b(!!it.isLocked), dimensionKey: it.dimensionKey ?? '',
        } satisfies AsmItemRow)
      }
      report.assembliesCreated += 1
    }
  })
  return report
}

/**
 * 清空本地数据（08§2 设置区“清空本地数据”；二次确认由调用方 UI 承担）。
 * 清空全部业务 store（含 kv 种子标记）；调用方清空后建议 reload，空库会自动重建种子。
 */
export async function dbClearLocalData(): Promise<void> {
  const db = await getDb()
  await tx(
    db,
    ['dimensions', 'modules', 'rules', 'tags', 'module_tags', 'assemblies', 'assembly_items', 'templates', 'template_items', 'kv'],
    'readwrite',
    async (s) => {
      await Promise.all(Object.values(s).map((store) => clearStore(store)))
    },
  )
  try {
    emitLibraryChanged()
  } catch {
    /* ignore */
  }
}
