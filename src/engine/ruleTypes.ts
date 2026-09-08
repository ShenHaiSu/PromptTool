/**
 * need02 规则类型底座（03 §2 / 04 §1 唯一口径）
 * 纯类型 + 常量，无 IO，可被 engine / stores / components 共同引用。
 */
import type { Finding, IRSegment, RuleType } from './models'

export const RULE_TYPES: RuleType[] = ['mutex', 'requires', 'excludes', 'limit', 'isolated']

/** 前后端同构的规则行（03 §2） */
export interface Rule {
  id: string
  name: string
  type: RuleType
  /** 维度级：维度 id（Dimension.id，如 dim_05），为空表示不限 */
  sourceDimensionId: string | null
  /** 条目级：模块 id（Module.id），为空表示该维度全部 */
  sourceModuleId: string | null
  sourceDimensionKey?: string | null
  targetDimensionId: string | null
  targetModuleId: string | null
  targetDimensionKey?: string | null
  /** 人话模板，支持 {source} {target} 占位 */
  message: string
  isEnabled: boolean
}

/** 引擎求值用的扩展规则：内存派生字段（04 §1） */
export interface EngineRule extends Rule {
  /** 关键词模式（仅转正种子规则有值，见 ruleEngine.LEGACY_DEFAULT_RULES） */
  sourceKeyword?: string | null
  targetKeywords?: string[]
  /** limit 专属：同维度段数上限 */
  limitCount?: number
  /** isolated 专属：命中源时需清空的目标维度键列表（空即全部非源段） */
  isolatedTargets?: string[]
  /** 派生：sourceDimensionId → dimensionKey（求值前补齐） */
  sourceDimKey?: string | null
  /** 派生：targetDimensionId → dimensionKey */
  targetDimKey?: string | null
}

export interface EvaluateInput {
  segments: IRSegment[]
  rules: EngineRule[]
  /** 锁定下标集合：自动修复永不移除（04 §4） */
  lockedIndexes?: Set<number>
  /** 维度排序映射（DB sort_order 优先，缺省走 legacy DIM_ORDER） */
  dimOrderMap?: Record<string, number>
  /** 维度 id → key 映射（维度级规则命中用；快照段只有 dimensionKey） */
  dimIdToKey?: Record<string, string>
  /** 维度 key → 中文名（message 模板 {source}/{target} 渲染用） */
  dimKeyToName?: Record<string, string>
  /** 模块 id → 显示名（message 模板渲染用） */
  moduleIdToName?: Record<string, string>
}

export type { Finding, IRSegment, RuleType }
