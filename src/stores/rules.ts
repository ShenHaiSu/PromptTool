/**
 * need02 规则状态（05 §4.4 唯一口径）
 * 规则唯一的内存真源；组件不直调 invoke 改规则，必须经 store（乐观更新 + 回滚 + 事件统一）。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { dbListRules, dbCreateRule, dbUpdateRule, dbDeleteRule, dbToggleRule } from '@/lib/db'
import type { RuleDto, RuleUpsertPayload } from '@/lib/db'
import type { Rule, EngineRule } from '@/engine/ruleTypes'
import { LEGACY_DEFAULT_RULES } from '@/engine/ruleEngine'
import { emit, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import { useLibraryStore } from './library'

function toRule(dto: RuleDto): Rule {
  return {
    id: dto.id,
    name: dto.name,
    type: dto.type,
    sourceDimensionId: dto.sourceDimensionId,
    sourceModuleId: dto.sourceModuleId,
    sourceDimensionKey: null,
    targetDimensionId: dto.targetDimensionId,
    targetModuleId: dto.targetModuleId,
    targetDimensionKey: null,
    message: dto.message,
    isEnabled: dto.isEnabled,
  }
}

export const useRulesStore = defineStore('rules', () => {
  const rules = ref<Rule[]>([])
  const loaded = ref(false)
  const loadError = ref<string | null>(null)

  const enabledRules = computed(() => rules.value.filter((r) => r.isEnabled))

  /** 维度 id → key（快照段只有 dimensionKey，维度级规则命中靠此映射） */
  const dimIdToKey = computed(() => {
    const map: Record<string, string> = {}
    try {
      const library = useLibraryStore()
      for (const d of library.dimensions) map[d.id] = d.key
    } catch { /* pinia 外单测降级 */ }
    return map
  })

  const dimKeyToName = computed(() => {
    const map: Record<string, string> = {}
    try {
      const library = useLibraryStore()
      for (const d of library.dimensions) map[d.key] = d.nameCn || d.key
    } catch { /* ignore */ }
    return map
  })

  async function fetchAll(includeDisabled = true): Promise<void> {
    loadError.value = null
    try {
      const dtos = await dbListRules(includeDisabled)
      rules.value = dtos.map(toRule)
      loaded.value = true
    } catch (e) {
      loadError.value = String(e)
      // 后端未就绪回退：内存 LEGACY 规则保证编辑器可用（07 §5 回退策略）
      if (!loaded.value) {
        rules.value = LEGACY_DEFAULT_RULES.map((r) => ({ ...r }))
        loaded.value = true
      }
      throw e
    }
  }

  /** 补 sourceDimKey/targetDimKey + 三条种子关键词内存补齐（03 §2 / 04 §6） */
  function toEngineRules(): EngineRule[] {
    const idToKey = dimIdToKey.value
    return rules.value.map((r) => {
      const base: EngineRule = {
        ...r,
        sourceDimKey: r.sourceDimensionKey ?? (r.sourceDimensionId ? (idToKey[r.sourceDimensionId] ?? null) : null),
        targetDimKey: r.targetDimensionKey ?? (r.targetDimensionId ? (idToKey[r.targetDimensionId] ?? null) : null),
      }
      const legacy = LEGACY_DEFAULT_RULES.find((l) => l.id === r.id)
      if (legacy) {
        if (legacy.sourceKeyword) base.sourceKeyword = legacy.sourceKeyword
        if (legacy.targetKeywords) base.targetKeywords = [...legacy.targetKeywords]
        if (!base.sourceDimKey && legacy.sourceDimKey) base.sourceDimKey = legacy.sourceDimKey
        if (!base.targetDimKey && legacy.targetDimKey) base.targetDimKey = legacy.targetDimKey
      }
      return base
    })
  }

  async function saveRule(payload: RuleUpsertPayload, id?: string): Promise<Rule> {
    const snapshot = [...rules.value]
    // 乐观：先写内存（新建用临时 id，成功后替换）
    const tempId = id ?? `temp_${Date.now()}`
    const optimistic: Rule = {
      id: tempId, name: payload.name, type: payload.type,
      sourceDimensionId: payload.sourceDimensionId, sourceModuleId: payload.sourceModuleId,
      sourceDimensionKey: null,
      targetDimensionId: payload.targetDimensionId, targetModuleId: payload.targetModuleId,
      targetDimensionKey: null,
      message: payload.message, isEnabled: payload.isEnabled,
    }
    if (id) {
      rules.value = rules.value.map((r) => (r.id === id ? optimistic : r))
    } else {
      rules.value = [...rules.value, optimistic]
    }
    try {
      const dto = id ? await dbUpdateRule(id, payload) : await dbCreateRule(payload)
      const saved = toRule(dto)
      rules.value = rules.value.map((r) => (r.id === tempId ? saved : r))
      emit(LIBRARY_CHANGED, { source: 'rules', op: 'rule-changed' })
      return saved
    } catch (e) {
      rules.value = snapshot
      throw e
    }
  }

  async function toggleRule(id: string, v: boolean): Promise<void> {
    const snapshot = [...rules.value]
    rules.value = rules.value.map((r) => (r.id === id ? { ...r, isEnabled: v } : r))
    try {
      const dto = await dbToggleRule(id, v)
      rules.value = rules.value.map((r) => (r.id === id ? toRule(dto) : r))
      emit(LIBRARY_CHANGED, { source: 'rules', op: 'rule-changed' })
    } catch (e) {
      rules.value = snapshot
      throw e
    }
  }

  async function deleteRule(id: string): Promise<void> {
    const snapshot = [...rules.value]
    rules.value = rules.value.filter((r) => r.id !== id)
    try {
      await dbDeleteRule(id)
      emit(LIBRARY_CHANGED, { source: 'rules', op: 'rule-changed' })
    } catch (e) {
      rules.value = snapshot
      throw e
    }
  }

  return {
    rules, loaded, loadError, enabledRules,
    dimIdToKey, dimKeyToName,
    fetchAll, saveRule, toggleRule, deleteRule, toEngineRules,
  }
})
