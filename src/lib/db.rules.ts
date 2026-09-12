/** 规则 CRUD，对标 commands/rules.rs（含全部校验口径）。 */
import type { RuleType } from '@/engine/models'
import { getAll, getByKey, putValue, tx } from './idb'
import { getDb } from './seed'
import { b, uid, type DimRow, type ModRow, type RuleRow } from './db.rows'
import type { RuleDto, RuleUpsertPayload } from './db.types'

const RULE_TYPES: RuleType[] = ['mutex', 'requires', 'excludes', 'limit', 'isolated']

function rowToRule(r: RuleRow): RuleDto {
  return {
    id: r.id, name: r.name, type: r.type as RuleType,
    sourceDimensionId: r.sourceDimensionId, sourceModuleId: r.sourceModuleId,
    targetDimensionId: r.targetDimensionId, targetModuleId: r.targetModuleId,
    message: r.message, isEnabled: r.isEnabled !== 0,
  }
}

function normRef(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return t ? t : null
}

async function validateRulePayload(p: RuleUpsertPayload): Promise<{
  sourceDimensionId: string | null
  sourceModuleId: string | null
  targetDimensionId: string | null
  targetModuleId: string | null
}> {
  const name = p.name.trim()
  if (!name) throw new Error('规则名称不能为空')
  if ([...name].length > 50) throw new Error('规则名称不能超过 50 字')
  if (!RULE_TYPES.includes(p.type)) throw new Error('规则类型非法')
  if (!p.message.trim()) throw new Error('规则消息不能为空')
  const srcD = normRef(p.sourceDimensionId)
  const srcM = normRef(p.sourceModuleId)
  const tgtD = normRef(p.targetDimensionId)
  const tgtM = normRef(p.targetModuleId)
  if ((p.type === 'mutex' || p.type === 'requires' || p.type === 'excludes') && !srcD && !srcM && !tgtD && !tgtM) {
    throw new Error('mutex/requires/excludes 需至少一侧定位')
  }
  const db = await getDb()
  const [dims, mods] = await Promise.all([
    tx(db, 'dimensions', 'readonly', (s) => getAll<DimRow>(s['dimensions']!)),
    tx(db, 'modules', 'readonly', (s) => getAll<ModRow>(s['modules']!)),
  ])
  const dimById = new Map(dims.map((d) => [d.id, d]))
  const modById = new Map(mods.map((m) => [m.id, m]))
  const dimOf = (id: string | null, label: string): void => {
    if (!id) return
    const d = dimById.get(id)
    if (!d || d.isDeleted !== 0) throw new Error(`${label}维度不存在或已删除`)
  }
  dimOf(srcD, '源')
  dimOf(tgtD, '目标')
  const modOf = (mid: string | null, did: string | null, label: string): void => {
    if (!mid) return
    const m = modById.get(mid)
    if (!m || m.isDeleted !== 0) throw new Error(`${label}条目不存在或已删除`)
    if (did && m.dimensionId !== did) throw new Error(`${label}条目不属于${label}维度`)
  }
  modOf(srcM, srcD, '源')
  modOf(tgtM, tgtD, '目标')
  return { sourceDimensionId: srcD, sourceModuleId: srcM, targetDimensionId: tgtD, targetModuleId: tgtM }
}

export async function dbListRules(includeDisabled = true): Promise<RuleDto[]> {
  const db = await getDb()
  const rows = await tx(db, 'rules', 'readonly', (s) => getAll<RuleRow>(s['rules']!))
  return rows
    .filter((r) => r.isDeleted === 0 && (includeDisabled || r.isEnabled !== 0))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(rowToRule)
}

export async function dbCreateRule(payload: RuleUpsertPayload): Promise<RuleDto> {
  const refs = await validateRulePayload(payload)
  const db = await getDb()
  const ts = Date.now()
  const id = `rule_${uid().replace(/-/g, '').slice(0, 12)}`
  const row: RuleRow = {
    id, name: payload.name.trim(), type: payload.type,
    ...refs,
    message: payload.message, isEnabled: b(payload.isEnabled), createdAt: ts, isDeleted: 0,
  }
  await tx(db, 'rules', 'readwrite', (s) => putValue(s['rules']!, row))
  return rowToRule(row)
}

export async function dbUpdateRule(id: string, payload: RuleUpsertPayload): Promise<RuleDto> {
  const refs = await validateRulePayload(payload)
  const db = await getDb()
  return tx(db, 'rules', 'readwrite', async (s) => {
    const cur = await getByKey<RuleRow>(s['rules']!, id)
    if (!cur || cur.isDeleted !== 0) throw new Error('规则不存在或已删除')
    const next: RuleRow = {
      ...cur,
      name: payload.name.trim(), type: payload.type,
      ...refs,
      message: payload.message, isEnabled: b(payload.isEnabled),
    }
    await putValue(s['rules']!, next)
    return rowToRule(next)
  })
}

export async function dbDeleteRule(id: string): Promise<void> {
  const db = await getDb()
  await tx(db, 'rules', 'readwrite', async (s) => {
    const cur = await getByKey<RuleRow>(s['rules']!, id)
    if (!cur || cur.isDeleted !== 0) throw new Error('规则不存在或已删除')
    await putValue(s['rules']!, { ...cur, isDeleted: 1 } satisfies RuleRow)
  })
}

export async function dbToggleRule(id: string, isEnabled: boolean): Promise<RuleDto> {
  const db = await getDb()
  return tx(db, 'rules', 'readwrite', async (s) => {
    const cur = await getByKey<RuleRow>(s['rules']!, id)
    if (!cur || cur.isDeleted !== 0) throw new Error('规则不存在或已删除')
    const next: RuleRow = { ...cur, isEnabled: b(isEnabled) }
    await putValue(s['rules']!, next)
    return rowToRule(next)
  })
}
