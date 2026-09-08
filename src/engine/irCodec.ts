/**
 * need02 IR 快照编解码（03 §7 唯一口径）
 * parsePromptIr：容错解析落盘快照（assemblies.prompt_ir），老快照（无 findings/version）前向兼容。
 */
import { IR_SNAPSHOT_VERSION, PromptIR } from '@/engine/models'
import type { Finding, IRSegment } from '@/engine/models'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function toSegment(raw: unknown): IRSegment | null {
  if (!isRecord(raw)) return null
  const dimensionKey = typeof raw.dimensionKey === 'string' ? raw.dimensionKey : ''
  const text = typeof raw.text === 'string' ? raw.text : null
  const weight = typeof raw.weight === 'number' && Number.isFinite(raw.weight) ? raw.weight : null
  const sourceModuleId = typeof raw.sourceModuleId === 'string' ? raw.sourceModuleId : ''
  if (text == null || weight == null) return null
  return { dimensionKey, text, weight, sourceModuleId }
}

function toFinding(raw: unknown): Finding | null {
  if (!isRecord(raw)) return null
  if (typeof raw.ruleId !== 'string' || typeof raw.ruleName !== 'string') return null
  if (typeof raw.message !== 'string') return null
  const type = raw.type
  if (type !== 'mutex' && type !== 'requires' && type !== 'excludes' && type !== 'limit' && type !== 'isolated') return null
  const severity = raw.severity === 'error' ? 'error' : 'warning'
  const involvedIndexes = Array.isArray(raw.involvedIndexes)
    ? raw.involvedIndexes.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0)
    : []
  const involvedModuleIds = Array.isArray(raw.involvedModuleIds)
    ? raw.involvedModuleIds.filter((s): s is string => typeof s === 'string')
    : []
  let fix: Finding['fix'] = null
  if (isRecord(raw.fix)) {
    const removeIndexes = Array.isArray(raw.fix.removeIndexes)
      ? raw.fix.removeIndexes.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0)
      : []
    const keepIndexes = Array.isArray(raw.fix.keepIndexes)
      ? raw.fix.keepIndexes.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0)
      : []
    const reason = typeof raw.fix.reason === 'string' ? raw.fix.reason : ''
    fix = { removeIndexes, keepIndexes, reason }
  }
  // ignored 不落盘：解析时恒置 false，由编辑器内存管理
  return {
    ruleId: raw.ruleId,
    ruleName: raw.ruleName,
    type,
    severity,
    message: raw.message,
    involvedIndexes,
    involvedModuleIds,
    fix,
    ignored: false,
  }
}

/**
 * 容错解析 IR 快照 JSON。
 * - JSON.parse 失败 → 返回空 IR（segments=[]，warnings=['快照解析失败，已置空']）
 * - 缺 findings/version → 补 [] / 1（前向兼容老快照）
 * - segments 项缺字段 → 丢弃该项并计 warnings（不抛错）
 */
export function parsePromptIr(json: string): PromptIR {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return new PromptIR([], ['快照解析失败，已置空'], [], IR_SNAPSHOT_VERSION)
  }
  if (!isRecord(raw)) {
    return new PromptIR([], ['快照解析失败，已置空'], [], IR_SNAPSHOT_VERSION)
  }
  const warnings: string[] = Array.isArray(raw.warnings)
    ? raw.warnings.filter((s): s is string => typeof s === 'string')
    : []
  const segments: IRSegment[] = []
  if (Array.isArray(raw.segments)) {
    for (const item of raw.segments) {
      const seg = toSegment(item)
      if (seg) segments.push(seg)
      else warnings.push('快照中有一段缺失字段，已跳过')
    }
  }
  const findings: Finding[] = Array.isArray(raw.findings)
    ? raw.findings.map(toFinding).filter((f): f is Finding => f != null)
    : []
  const version = raw.version === IR_SNAPSHOT_VERSION ? IR_SNAPSHOT_VERSION : 1
  return new PromptIR(segments, warnings, findings, version)
}

/** 老快照（无 findings）可直接读：补 [] / 1 后仍可求值（调用方重算 findings 即可） */
export function isLegacySnapshot(json: string): boolean {
  try {
    const raw: unknown = JSON.parse(json)
    if (!isRecord(raw)) return true
    return !Array.isArray(raw.findings) || raw.version !== IR_SNAPSHOT_VERSION
  } catch {
    return true
  }
}
