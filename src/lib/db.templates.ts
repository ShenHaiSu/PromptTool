/** 模板 CRUD + 回填，对标 commands/db.rs Templates 段（template_items 为唯一形态）。 */
import type { AssemblyConfig, SelectedItem, Template } from '@/engine/models'
import { getAll, getAllByIndex, getByKey, putValue, tx } from './idb'
import { getDb } from './seed'
import {
  resolveModuleWithFallback,
  rowToTemplate,
  uid,
  type DimRow,
  type ModRow,
  type TplItemRow,
  type TplRow,
} from './db.rows'

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
  const db = await getDb()
  const tid = uid()
  const ts = Date.now()
  const configJson = JSON.stringify({
    assembly_config: {
      separator: config.separator,
      use_weight_brackets: config.useWeightBrackets,
      model_profile: config.modelProfile,
      sort_by: config.sortBy,
    },
    enabled_dimension_keys: enabledKeys,
    version: 2,
  })
  await tx(db, ['templates', 'template_items'], 'readwrite', (s) => {
    const jobs: Promise<unknown>[] = [
      putValue(s['templates']!, {
        id: tid, name, description: desc, configJson, coverPrompt: cover, createdAt: ts, isDeleted: 0,
      } satisfies TplRow),
    ]
    selectedItems.forEach((it, idx) => {
      jobs.push(
        putValue(s['template_items']!, {
          id: uid(), templateId: tid, moduleId: it.module.id,
          dimensionKey: it.module.dimensionKey ?? '', sortOrder: idx,
          weightOverride: it.weightOverride ?? null, isLocked: it.locked ? 1 : 0,
        } satisfies TplItemRow),
      )
    })
    return Promise.all(jobs).then(() => undefined)
  })
  return tid
}

export async function dbListTemplates(): Promise<Template[]> {
  const db = await getDb()
  const rows = await tx(db, 'templates', 'readonly', (s) => getAll<TplRow>(s['templates']!))
  return rows
    .filter((t) => t.isDeleted === 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(rowToTemplate)
}

export async function dbApplyTemplate(
  id: string,
): Promise<[AssemblyConfig, string[], SelectedItem[]]> {
  const db = await getDb()
  const [tpl, itemRows, modRows, dims] = await Promise.all([
    tx(db, 'templates', 'readonly', (s) => getByKey<TplRow>(s['templates']!, id)),
    tx(db, 'template_items', 'readonly', (s) =>
      getAllByIndex<TplItemRow>(s['template_items']!, 'templateId', id),
    ),
    tx(db, 'modules', 'readonly', (s) => getAll<ModRow>(s['modules']!)),
    tx(db, 'dimensions', 'readonly', (s) => getAll<DimRow>(s['dimensions']!)),
  ])
  if (!tpl || tpl.isDeleted !== 0) throw new Error('模板不存在或已删除')
  if (!tpl.configJson.trim()) throw new Error('模板不含明细，请重建')
  let v: Record<string, unknown>
  try {
    v = JSON.parse(tpl.configJson) as Record<string, unknown>
  } catch (e) {
    throw new Error(`模板配置解析失败: ${e instanceof Error ? e.message : String(e)}`)
  }
  const ac = (v['assembly_config'] ?? {}) as Record<string, unknown>
  const cfg: AssemblyConfig = {
    separator: typeof ac['separator'] === 'string' ? ac['separator'] : ', ',
    useWeightBrackets: typeof ac['use_weight_brackets'] === 'boolean' ? ac['use_weight_brackets'] : true,
    modelProfile: (typeof ac['model_profile'] === 'string' ? ac['model_profile'] : 'sd') as AssemblyConfig['modelProfile'],
    sortBy: (typeof ac['sort_by'] === 'string' ? ac['sort_by'] : 'dimensionOrder') as AssemblyConfig['sortBy'],
  }
  const enabled = Array.isArray(v['enabled_dimension_keys'])
    ? (v['enabled_dimension_keys'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  if (itemRows.length === 0) throw new Error('模板不含明细，请重建')
  const modById = new Map(modRows.map((m) => [m.id, m]))
  const keyByDimId = new Map(dims.map((d) => [d.id, d.key]))
  const items: SelectedItem[] = []
  for (const ti of itemRows.sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!ti.dimensionKey.trim()) throw new Error(`template_items 缺少 dimensionKey: moduleId=${ti.moduleId}`)
    const m = modById.get(ti.moduleId)
    const module = resolveModuleWithFallback({
      mid: ti.moduleId,
      contentEn: m?.contentEn ?? null,
      displayName: m?.displayName ?? null,
      modWeight: m?.weight ?? null,
      dimensionId: m?.dimensionId ?? null,
      dimKey: m ? keyByDimId.get(m.dimensionId) ?? null : null,
      isDeleted: m ? m.isDeleted !== 0 : false,
      snapshot: null,
      fallbackDk: ti.dimensionKey,
    })
    if (!module.dimensionKey?.trim()) throw new Error(`模板回填缺少 dimensionKey: moduleId=${ti.moduleId}`)
    items.push({ module, weightOverride: ti.weightOverride, locked: ti.isLocked !== 0 })
  }
  if (items.some((it) => !it.module.dimensionKey?.trim())) throw new Error('模板回填 dimensionKey 为空')
  return [cfg, enabled, items]
}

export async function dbSoftDeleteTemplate(id: string): Promise<void> {
  const db = await getDb()
  await tx(db, 'templates', 'readwrite', async (s) => {
    const cur = await getByKey<TplRow>(s['templates']!, id)
    if (!cur) return
    await putValue(s['templates']!, { ...cur, isDeleted: 1 } satisfies TplRow)
  })
}
