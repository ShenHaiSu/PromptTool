/** 批量翻译回填 displayName，对标 commands/translation.rs；解析复用 translationParse。 */
import { getByKey, putValue, tx } from './idb'
import { getDb } from './seed'
import { safeTruncate, type DimRow, type ModRow } from './db.rows'
import { parseTranslationText } from './translationParse'
import type { TranslationUpdatePayload, TranslationUpdateReport } from './db.types'

const MAX_ITEMS = 1000
const MAX_ZH_LEN = 500

export async function dbBatchUpdateDisplayNames(
  payload: TranslationUpdatePayload,
): Promise<TranslationUpdateReport> {
  const report: TranslationUpdateReport = {
    totalRequested: payload.items.length, updated: 0, skipped: 0, warnings: [], errors: [],
  }
  if (payload.items.length > MAX_ITEMS) throw new Error('单次更新不超过 1000 条，请分批')
  const dimensionId = payload.dimensionId.trim()
  if (!dimensionId) throw new Error('维度 id 不能为空')
  if (payload.items.length === 0) throw new Error('无有效更新')
  const db = await getDb()
  await tx(db, ['dimensions', 'modules'], 'readwrite', async (s) => {
    const dim = await getByKey<DimRow>(s['dimensions']!, dimensionId)
    if (!dim || dim.isDeleted !== 0) throw new Error('维度不存在或已删除')
    const ms = s['modules']!
    const ts = Date.now()
    for (const item of payload.items) {
      if (!item.id?.trim()) {
        report.skipped += 1
        report.errors.push('id 为空，已跳过')
        continue
      }
      let zh = (item.displayName ?? '').trim()
      if (!zh) {
        report.skipped += 1
        report.errors.push(`id ${item.id} 的 displayName 为空，已跳过`)
        continue
      }
      if ([...zh].length > MAX_ZH_LEN) {
        report.warnings.push(`id ${item.id} 的 displayName 超长，已截断至 ${MAX_ZH_LEN}`)
        zh = safeTruncate(zh, MAX_ZH_LEN)
      }
      const m = await getByKey<ModRow>(ms, item.id)
      if (!m) {
        report.skipped += 1
        report.errors.push(`id ${item.id} 不存在，已跳过`)
        continue
      }
      if (m.isDeleted !== 0) {
        report.skipped += 1
        report.errors.push(`id ${item.id} 已删除，已跳过`)
        continue
      }
      if (m.dimensionId !== dimensionId) {
        report.skipped += 1
        report.errors.push(`id ${item.id} 不属于维度 ${dim.key}，已跳过`)
        continue
      }
      await putValue(ms, { ...m, displayName: zh, updatedAt: ts } satisfies ModRow)
      report.updated += 1
    }
  })
  return report
}

export async function dbBatchUpdateDisplayNamesText(
  text: string,
  dimensionId: string,
): Promise<TranslationUpdateReport> {
  if (!text.trim()) throw new Error('输入为空')
  const merged = parseTranslationText(text)
  if (merged.pendingMap.size === 0) throw new Error('无法识别的 pmf-translation 格式')
  const items = [...merged.pendingMap.entries()].map(([id, v]) => ({ id, displayName: v.zh }))
  const report = await dbBatchUpdateDisplayNames({ dimensionId, items })
  return { ...report, warnings: [...merged.warnings, ...report.warnings], errors: [...merged.errors, ...report.errors] }
}
