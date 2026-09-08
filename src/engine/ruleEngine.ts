/**
 * need02 规则引擎 v2（04 唯一口径）
 * 数据驱动求值 + 自动修复，纯函数：禁 invoke、禁 localStorage。
 * 求值不删段、不排序，只产 findings；删段由调用方经 fix 显式应用（决策 K4）。
 */
import type { Finding, FindingFix, IRSegment } from './models'
import type { EngineRule, EvaluateInput } from './ruleTypes'

/** R01 拆二后的转正种子（04 §6）：与新装库种子数据同语义，无后端时单测仍过 */
export const LEGACY_DEFAULT_RULES: EngineRule[] = [
  {
    id: 'rule_01a', name: '套装互斥·上装', type: 'mutex',
    sourceDimensionId: 'dim_05', sourceModuleId: null,
    targetDimensionId: 'dim_03', targetModuleId: null,
    message: '已选全身套装，上装将自动忽略',
    isEnabled: true,
    sourceDimKey: 'outfit', targetDimKey: 'top',
  },
  {
    id: 'rule_01b', name: '套装互斥·下装', type: 'mutex',
    sourceDimensionId: 'dim_05', sourceModuleId: null,
    targetDimensionId: 'dim_04', targetModuleId: null,
    message: '已选全身套装，下装将自动忽略',
    isEnabled: true,
    sourceDimKey: 'outfit', targetDimKey: 'bottom',
  },
  {
    id: 'rule_02', name: '鞋袜与赤脚互斥', type: 'mutex',
    sourceDimensionId: 'dim_06', sourceModuleId: null,
    targetDimensionId: 'dim_06', targetModuleId: null,
    message: '赤脚与鞋袜不可共存',
    isEnabled: true,
    sourceDimKey: 'shoes', targetDimKey: 'shoes',
    sourceKeyword: 'barefoot',
  },
  {
    id: 'rule_03', name: '室内外背景互斥', type: 'excludes',
    sourceDimensionId: 'dim_10', sourceModuleId: null,
    targetDimensionId: 'dim_10', targetModuleId: null,
    message: '室内背景与户外背景冲突，已保留棚拍',
    isEnabled: true,
    sourceDimKey: 'background', targetDimKey: 'background',
    sourceKeyword: 'studio',
    targetKeywords: ['beach', 'sunset', 'street', 'rooftop'],
  },
]

/**
 * 老库旧 id → 新求值路径（04 §6）：
 * 旧 rule_01（outfit→top 笼统）按 01a/01b 两条分别求值；
 * 旧 rule_02/rule_03 补关键词后走同语义。
 */
export const LEGACY_RULE_ALIAS: Record<string, string[]> = {
  rule_01: ['rule_01a', 'rule_01b'],
  rule_02: ['rule_02'],
  rule_03: ['rule_03'],
}

function lower(s: string): string {
  return s.toLowerCase()
}

/** 派生 dimKey：优先用内存派生字段，否则经 dimIdToKey 映射 */
function resolveDimKeys(rule: EngineRule, dimIdToKey?: Record<string, string>): { sourceDimKey: string | null; targetDimKey: string | null } {
  const sourceDimKey = rule.sourceDimKey
    ?? (rule.sourceDimensionId && dimIdToKey ? (dimIdToKey[rule.sourceDimensionId] ?? null) : null)
  const targetDimKey = rule.targetDimKey
    ?? (rule.targetDimensionId && dimIdToKey ? (dimIdToKey[rule.targetDimensionId] ?? null) : null)
  return { sourceDimKey, targetDimKey }
}

function hitSource(seg: IRSegment, rule: EngineRule, sourceDimKey: string | null): boolean {
  // 2.1 条目级最优先
  if (rule.sourceModuleId) return seg.sourceModuleId === rule.sourceModuleId
  // 2.3 关键词级（转正专用）
  if (rule.sourceKeyword) {
    const inDim = sourceDimKey ? seg.dimensionKey === sourceDimKey : true
    return inDim && lower(seg.text).includes(lower(rule.sourceKeyword))
  }
  // 2.2 维度级
  if (sourceDimKey) return seg.dimensionKey === sourceDimKey
  if (rule.sourceDimensionId) return false // 无映射时不误命中
  return false
}

function hitTarget(seg: IRSegment, rule: EngineRule, targetDimKey: string | null): boolean {
  if (rule.targetModuleId) return seg.sourceModuleId === rule.targetModuleId
  // rule_02 的目标侧：同维度非关键词（“鞋袜非赤脚”）——由调用时 targetKeywords 为空 + 同维 + 排除源关键词表达
  if (rule.targetKeywords && rule.targetKeywords.length > 0) {
    const inDim = targetDimKey ? seg.dimensionKey === targetDimKey : true
    return inDim && rule.targetKeywords.some((kw) => lower(seg.text).includes(lower(kw)))
  }
  if (targetDimKey) {
    if (seg.dimensionKey !== targetDimKey) return false
    // 同维 mutex 且源为关键词时，目标侧排除源关键词自身（R02：barefoot 源 vs 非 barefoot 目标）
    if (rule.sourceKeyword && rule.sourceDimKey && rule.targetDimKey && rule.sourceDimKey === rule.targetDimKey) {
      return !lower(seg.text).includes(lower(rule.sourceKeyword))
    }
    return true
  }
  return false
}

function renderMessage(template: string, source: string, target: string): string {
  return template.split('{source}').join(source).split('{target}').join(target)
}

function displayNameOf(rule: EngineRule, side: 'source' | 'target', maps: { dimKeyToName?: Record<string, string>; moduleIdToName?: Record<string, string> }, dimKey: string | null): string {
  const moduleId = side === 'source' ? rule.sourceModuleId : rule.targetModuleId
  if (moduleId && maps.moduleIdToName?.[moduleId]) return maps.moduleIdToName[moduleId]!
  const kw = side === 'source' ? rule.sourceKeyword : rule.targetKeywords?.[0]
  if (!dimKey && kw) return kw
  if (dimKey && maps.dimKeyToName?.[dimKey]) return maps.dimKeyToName[dimKey]!
  return dimKey ?? kw ?? (side === 'source' ? '源' : '目标')
}

/** 自动修复：默认保留源侧、移除目标侧未锁定项；两侧全锁 → null（04 §3-§4） */
function buildMutexFix(
  sIdx: number[],
  tIdx: number[],
  locked: Set<number>,
  keepSourceLabel: string,
  removeTargetLabel: string,
  keepTargetLabel: string,
  removeSourceLabel: string,
): { fix: FindingFix | null; messageSuffix: string } {
  const tRemovable = tIdx.filter((i) => !locked.has(i))
  const sRemovable = sIdx.filter((i) => !locked.has(i))
  if (tRemovable.length > 0) {
    return {
      fix: {
        removeIndexes: [...tRemovable].sort((a, b) => b - a),
        keepIndexes: [...sIdx].sort((a, b) => a - b),
        reason: `将移除${removeTargetLabel}，保留${keepSourceLabel}`,
      },
      messageSuffix: '',
    }
  }
  if (sRemovable.length > 0) {
    return {
      fix: {
        removeIndexes: [...sRemovable].sort((a, b) => b - a),
        keepIndexes: [...tIdx].sort((a, b) => a - b),
        reason: `目标侧已锁定，将移除${removeSourceLabel}，保留${keepTargetLabel}`,
      },
      messageSuffix: '（目标侧已锁定，将反向处理）',
    }
  }
  return { fix: null, messageSuffix: '（双方均已锁定，请先解锁）' }
}

function involvedModuleIds(segments: IRSegment[], indexes: number[]): string[] {
  const ids: string[] = []
  for (const i of indexes) {
    const id = segments[i]?.sourceModuleId
    if (id) ids.push(id)
  }
  return [...new Set(ids)]
}

export function evaluateRules(input: EvaluateInput): Finding[] {
  const { segments, rules } = input
  const locked = input.lockedIndexes ?? new Set<number>()
  const out: Finding[] = []
  if (segments.length === 0) return out

  for (const rule of rules) {
    if (!rule.isEnabled) continue
    // 旧 id 兼容：rule_01 按 01a/01b 分别求值（调用方传入旧行时展开）
    const expanded = LEGACY_RULE_ALIAS[rule.id]?.map((nid) => LEGACY_DEFAULT_RULES.find((r) => r.id === nid)).filter((r): r is EngineRule => !!r)
    const variants = rule.id === 'rule_01' && expanded && expanded.length > 0 ? expanded : [rule]
    for (const v of variants) {
      const f = evaluateOne(segments, v, locked, input)
      if (f) out.push(f)
    }
  }
  return out
}

function evaluateOne(segments: IRSegment[], rule: EngineRule, locked: Set<number>, input: EvaluateInput): Finding | null {
  const { sourceDimKey, targetDimKey } = resolveDimKeys(rule, input.dimIdToKey)
  switch (rule.type) {
    case 'mutex':
    case 'excludes': {
      const sIdx: number[] = []
      const tIdx: number[] = []
      segments.forEach((seg, i) => {
        if (hitSource(seg, rule, sourceDimKey)) sIdx.push(i)
        else if (hitTarget(seg, rule, targetDimKey)) tIdx.push(i)
      })
      // 同维关键词规则（R02）：源关键词段不应同时计入目标侧——hitTarget 已排除，此处防重叠
      if (sIdx.length === 0 || tIdx.length === 0) return null
      const sourceLabel = displayNameOf(rule, 'source', input, sourceDimKey)
      const targetLabel = displayNameOf(rule, 'target', input, targetDimKey)
      const { fix, messageSuffix } = buildMutexFix(sIdx, tIdx, locked, sourceLabel, targetLabel, targetLabel, sourceLabel)
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        type: rule.type,
        severity: 'warning',
        message: renderMessage(rule.message, sourceLabel, targetLabel) + messageSuffix,
        involvedIndexes: [...sIdx, ...tIdx].sort((a, b) => a - b),
        involvedModuleIds: involvedModuleIds(segments, [...sIdx, ...tIdx]),
        fix,
      }
    }
    case 'requires': {
      const sIdx: number[] = []
      let hasTarget = false
      segments.forEach((seg, i) => {
        if (hitSource(seg, rule, sourceDimKey)) sIdx.push(i)
        if (hitTarget(seg, rule, targetDimKey)) hasTarget = true
      })
      if (sIdx.length === 0 || hasTarget) return null
      const sourceLabel = displayNameOf(rule, 'source', input, sourceDimKey)
      const targetLabel = displayNameOf(rule, 'target', input, targetDimKey)
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        type: rule.type,
        severity: 'warning',
        message: renderMessage(rule.message || '已选{source}，建议补选{target}', sourceLabel, targetLabel),
        involvedIndexes: [...sIdx].sort((a, b) => a - b),
        involvedModuleIds: involvedModuleIds(segments, sIdx),
        fix: null,
      }
    }
    case 'limit': {
      // limit 作用于目标维度（或源维度，未配目标时）：计数该维度段数
      const dimKey = targetDimKey ?? sourceDimKey
      if (!dimKey) return null
      const idx: number[] = []
      segments.forEach((seg, i) => { if (seg.dimensionKey === dimKey) idx.push(i) })
      const limit = rule.limitCount ?? 1
      if (idx.length <= limit) return null
      const label = displayNameOf(rule, 'target', input, dimKey)
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        type: rule.type,
        severity: 'warning',
        message: renderMessage(rule.message || '{target}最多选 {n} 项，当前 {m} 项，请删减', label, String(limit))
          .split('{n}').join(String(limit)).split('{m}').join(String(idx.length)),
        involvedIndexes: [...idx].sort((a, b) => a - b),
        involvedModuleIds: involvedModuleIds(segments, idx),
        fix: null,
      }
    }
    case 'isolated': {
      const sIdx: number[] = []
      segments.forEach((seg, i) => { if (hitSource(seg, rule, sourceDimKey)) sIdx.push(i) })
      if (sIdx.length === 0) return null
      const sSet = new Set(sIdx)
      let otherIdx: number[] = []
      segments.forEach((_seg, i) => { if (!sSet.has(i)) otherIdx.push(i) })
      if (rule.isolatedTargets && rule.isolatedTargets.length > 0) {
        const targets = new Set(rule.isolatedTargets)
        otherIdx = otherIdx.filter((i) => targets.has(segments[i]!.dimensionKey))
      }
      if (otherIdx.length === 0) return null
      const removable = otherIdx.filter((i) => !locked.has(i))
      const sourceLabel = displayNameOf(rule, 'source', input, sourceDimKey)
      if (removable.length === 0) {
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          type: rule.type,
          severity: 'error',
          message: `${rule.message}（外部段已锁定，请先解锁）`,
          involvedIndexes: [...sIdx, ...otherIdx].sort((a, b) => a - b),
          involvedModuleIds: involvedModuleIds(segments, [...sIdx, ...otherIdx]),
          fix: null,
        }
      }
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        type: rule.type,
        severity: 'error',
        message: rule.message.includes('{source}') ? renderMessage(rule.message, sourceLabel, '') : rule.message,
        involvedIndexes: [...sIdx, ...otherIdx].sort((a, b) => a - b),
        involvedModuleIds: involvedModuleIds(segments, [...sIdx, ...otherIdx]),
        fix: {
          removeIndexes: [...removable].sort((a, b) => b - a),
          keepIndexes: [...sIdx].sort((a, b) => a - b),
          reason: `将清空除${sourceLabel}外的 ${removable.length} 段`,
        },
      }
    }
  }
}

/** 修复预览：返回应用 fix 后的段表（不改输入） */
export function buildAutoFixPreview(segments: IRSegment[], finding: Finding): IRSegment[] {
  if (!finding.fix) return [...segments]
  const remove = new Set(finding.fix.removeIndexes)
  return segments.filter((_, i) => !remove.has(i))
}

export function summarizeFindings(findings: Finding[]): { errors: number; warnings: number; fixable: number } {
  let errors = 0
  let warnings = 0
  let fixable = 0
  for (const f of findings) {
    if (f.ignored) continue
    if (f.severity === 'error') errors++
    else warnings++
    if (f.fix) fixable++
  }
  return { errors, warnings, fixable }
}
