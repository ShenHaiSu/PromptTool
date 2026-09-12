/** 同维度批量建条目，对标 commands/batch.rs（含去重/mode/截断/report 口径）。 */
import { getByKey, putValue, tx } from './idb'
import { getDb } from './seed'
import { findModuleHitTx, normMode, normWeight, safeTruncate, uid, type DimRow, type ModRow } from './db.rows'
import type { BatchCreateItem, BatchCreatePayload, BatchCreateReport } from './db.types'

const BATCH_LIMIT = 500
const CONTENT_MAX_CHARS = 500

export async function dbBatchCreateModules(payload: BatchCreatePayload): Promise<BatchCreateReport> {
  const report: BatchCreateReport = {
    totalRequested: payload.items.length, valid: 0,
    modulesCreated: 0, modulesUpdated: 0, modulesSkipped: 0,
    emptyIgnored: 0, duplicateInBatch: 0, truncated: 0, errors: [], warnings: [],
  }
  const mode = normMode(payload.mode, payload.mode)
  const dimId = payload.dimId.trim()
  if (!dimId) throw new Error('维度 id 不能为空')
  const db = await getDb()
  const dim = await tx(db, 'dimensions', 'readonly', (s) => getByKey<DimRow>(s['dimensions']!, dimId))
  if (!dim || dim.isDeleted !== 0) throw new Error('维度不存在或已删除')
  let rows = payload.items
  if (rows.length > BATCH_LIMIT) {
    const over = rows.length - BATCH_LIMIT
    report.warnings.push(`已截断至 ${BATCH_LIMIT} 行，剩余请分批`)
    report.truncated += over
    rows = rows.slice(0, BATCH_LIMIT)
  }
  if (rows.length === 0) throw new Error('无有效内容')
  const payloadWeight = normWeight(payload.weight, 1.0, report.warnings, '')
  await tx(db, 'modules', 'readwrite', async (s) => {
    const store = s['modules']!
    const seen = new Set<string>()
    const ts = Date.now()
    for (let i = 0; i < rows.length; i++) {
      const item: BatchCreateItem = rows[i]!
      const content = item.contentEn.trim()
      if (!content) {
        report.emptyIgnored += 1
        continue
      }
      let finalContent = content
      if ([...content].length > CONTENT_MAX_CHARS) {
        report.warnings.push(`第 ${i + 1} 行超长已截断至 ${CONTENT_MAX_CHARS}`)
        report.truncated += 1
        finalContent = safeTruncate(content, CONTENT_MAX_CHARS)
      }
      if (seen.has(finalContent)) report.duplicateInBatch += 1
      seen.add(finalContent)
      const display = item.displayName?.trim() ? item.displayName.trim() : safeTruncate(finalContent, 20)
      const w = normWeight(item.weight ?? payloadWeight, payloadWeight, report.warnings, `第 ${i + 1} 行`)
      const hit = await findModuleHitTx(store, dimId, finalContent)
      if (hit) {
        if (mode === 'skip') {
          report.modulesSkipped += 1
          continue
        }
        try {
          await putValue(store, {
            ...hit,
            displayName: display,
            weight: w,
            isNsfw: item.isNsfw != null ? (item.isNsfw ? 1 : 0) : hit.isNsfw,
            notes: item.notes ?? hit.notes,
            updatedAt: ts,
          } satisfies ModRow)
          report.modulesUpdated += 1
          report.valid += 1
        } catch (e) {
          report.errors.push(`第 ${i + 1} 行更新失败: ${e instanceof Error ? e.message : String(e)}`)
        }
        continue
      }
      try {
        await putValue(store, {
          id: uid(), dimensionId: dimId, contentEn: finalContent, displayName: display,
          weight: w, isEnabled: 1, isNsfw: item.isNsfw ? 1 : 0, usageCount: 0,
          exampleImage: null, notes: item.notes ?? null,
          createdAt: ts, updatedAt: ts, isDeleted: 0,
        } satisfies ModRow)
        report.modulesCreated += 1
        report.valid += 1
      } catch (e) {
        report.errors.push(`第 ${i + 1} 行写入失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  })
  return report
}

export async function dbBatchCreateModulesText(
  dimId: string,
  text: string,
  mode: BatchCreatePayload['mode'],
  weight?: number | null,
  isNsfw?: boolean,
): Promise<BatchCreateReport> {
  const items: BatchCreateItem[] = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => ({ contentEn: line }))
  return dbBatchCreateModules({ dimId, items, mode, weight, isNsfw })
}
