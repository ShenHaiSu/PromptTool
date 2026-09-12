/** 分段批量入库（pmf-segments），对标 commands/segment.rs。 */
import { getAll, putValue, tx } from './idb'
import { getDb } from './seed'
import {
  byteLen,
  findModuleHitTx,
  normMode,
  normWeight,
  safeTruncate,
  uid,
  type DimRow,
  type ModRow,
} from './db.rows'
import type { SegmentImportItem, SegmentImportPayload, SegmentImportReport } from './db.types'

function emptySegmentReport(): SegmentImportReport {
  return {
    prompts: 0, segmentsTotal: 0, segmentsImported: 0, segmentsSkipped: 0,
    segmentsIgnoredUnassigned: 0, modulesCreated: 0, modulesUpdated: 0,
    modulesSkipped: 0, errors: [], warnings: [],
  }
}

type NormStrategy = 'ignore' | 'to_camera' | 'prompt_new'

function normStrategy(raw: string): NormStrategy {
  const v = raw.trim().toLowerCase()
  if (v === 'ignore' || v === 'to_camera' || v === 'prompt_new') return v
  throw new Error(`未知未分配策略 '${raw}'（可选：ignore / to_camera / prompt_new）`)
}

function validatePayloadShape(payload: SegmentImportPayload): void {
  if (payload.format !== 'pmf-segments') {
    throw new Error(`不支持的格式 '${payload.format}'（应为 pmf-segments）`)
  }
  if (payload.formatVersion !== 1) {
    throw new Error(`不支持的格式版本 ${payload.formatVersion}（当前支持 1）`)
  }
}

export async function dbImportSegments(payload: SegmentImportPayload): Promise<SegmentImportReport> {
  const report = emptySegmentReport()
  const mode = normMode(payload.mode, payload.mode)
  const strategy = normStrategy(payload.unassignedStrategy)
  validatePayloadShape(payload)
  const prompts = payload.prompts ?? []
  report.prompts = prompts.length
  // prompt_new 预检：任一段 unassigned（大小写无关）即整体报错，无写入
  if (strategy === 'prompt_new') {
    const hasUnassigned = prompts.some((p) =>
      (p.segments ?? []).some((seg) => (seg.dimensionKey ?? '').toLowerCase() === 'unassigned'),
    )
    if (hasUnassigned) {
      throw new Error('存在未分配片段（unassigned），请先新建维度或重映射后再导入')
    }
  }
  const db = await getDb()
  await tx(db, ['dimensions', 'modules'], 'readwrite', async (s) => {
    const ds = s['dimensions']!
    const ms = s['modules']!
    const dims = await getAll<DimRow>(ds)
    const liveByLowerKey = new Map<string, DimRow>()
    const byId = new Map<string, DimRow>()
    for (const d of dims) {
      byId.set(d.id, d)
      if (d.isDeleted === 0) liveByLowerKey.set(d.key.toLowerCase(), d)
    }
    const ts = Date.now()
    for (const p of prompts) {
      const segs = p.segments ?? []
      report.segmentsTotal += segs.length
      if (!p.raw?.trim()) {
        report.errors.push(`prompt '${p.id}' raw 为空，已跳过其全部片段`)
        report.segmentsSkipped += segs.length
        continue
      }
      for (const seg of segs) {
        let key = (seg.dimensionKey ?? '').trim()
        if (!key) {
          report.errors.push(`prompt '${p.id}' 存在空 dimensionKey 的片段，已跳过`)
          report.segmentsSkipped += 1
          continue
        }
        if (key.toLowerCase() === 'unassigned') {
          if (strategy === 'ignore') {
            report.segmentsIgnoredUnassigned += 1
            continue
          }
          key = 'camera' // to_camera（prompt_new 已在预检拦截）
        }
        let content = (seg.contentEn ?? '').trim()
        if (!content) {
          report.warnings.push(`prompt '${p.id}' 存在空 contentEn，已跳过`)
          report.segmentsSkipped += 1
          continue
        }
        if (byteLen(content) > 500) {
          report.warnings.push(`prompt '${p.id}' contentEn 超长，已截断至 500`)
          content = safeTruncate(content, 500)
        }
        let dim = liveByLowerKey.get(key.toLowerCase())
        if (!dim && seg.dimensionId) {
          const byRef = byId.get(seg.dimensionId)
          if (byRef && byRef.isDeleted === 0) dim = byRef
        }
        if (!dim) {
          report.errors.push(`维度 '${key}' 不存在（prompt '${p.id}'），已跳过`)
          report.segmentsSkipped += 1
          continue
        }
        const display = seg.displayName?.trim() ? seg.displayName.trim() : safeTruncate(content, 20)
        const w = normWeight(seg.weight, 1.0, report.warnings, '')
        const hit = await findModuleHitTx(ms, dim.id, content)
        if (hit) {
          if (mode === 'skip') {
            report.modulesSkipped += 1
            report.segmentsSkipped += 1
          } else {
            await putValue(ms, {
              ...hit,
              displayName: display,
              weight: w,
              isNsfw: seg.isNsfw != null ? (seg.isNsfw ? 1 : 0) : hit.isNsfw,
              notes: seg.notes ?? hit.notes,
              updatedAt: ts,
            } satisfies ModRow)
            report.modulesUpdated += 1
            report.segmentsImported += 1
          }
          continue
        }
        await putValue(ms, {
          id: uid(), dimensionId: dim.id, contentEn: content, displayName: display,
          weight: w, isEnabled: 1, isNsfw: seg.isNsfw ? 1 : 0, usageCount: 0,
          exampleImage: null, notes: seg.notes ?? null,
          createdAt: ts, updatedAt: ts, isDeleted: 0,
        } satisfies ModRow)
        report.modulesCreated += 1
        report.segmentsImported += 1
      }
    }
  })
  return report
}

export async function dbImportSegmentsText(
  text: string,
  unassignedStrategy: 'ignore' | 'to_camera' | 'prompt_new',
  mode: SegmentImportPayload['mode'],
): Promise<SegmentImportReport> {
  if (!text.trim()) throw new Error('输入为空')
  let v: unknown
  try {
    v = JSON.parse(text) as unknown
  } catch (e) {
    throw new Error(`JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`)
  }
  const obj = v as Record<string, unknown>
  let payload: SegmentImportPayload
  if (Array.isArray(obj['prompts'])) {
    payload = {
      format: String(obj['format'] ?? 'pmf-segments'),
      formatVersion: Number(obj['formatVersion'] ?? 1),
      prompts: obj['prompts'] as SegmentImportPayload['prompts'],
      unassignedStrategy,
      mode,
    }
  } else if (typeof obj['raw'] === 'string' && Array.isArray(obj['segments'])) {
    payload = {
      format: String(obj['format'] ?? 'pmf-segments'),
      formatVersion: Number(obj['formatVersion'] ?? 1),
      prompts: [{ id: 'p01', raw: obj['raw'] as string, segments: obj['segments'] as SegmentImportItem[] }],
      unassignedStrategy,
      mode,
    }
  } else {
    throw new Error('无法识别的 pmf-segments 格式，需包含 prompts 或 raw+segments')
  }
  return dbImportSegments(payload)
}
