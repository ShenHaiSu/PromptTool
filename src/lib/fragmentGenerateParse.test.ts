import { describe, it, expect } from 'vitest'
import {
  countDetectedContentEn,
  detectFragmentFormat,
  normalizeFragmentKey,
  parseFragmentText,
  toBatchCreatePayload,
  validateFragmentBatch,
} from '@/lib/fragmentGenerateParse'
import { GENERATE_MAX_ITEMS } from '@/lib/fragmentGeneratePrompt'
import type { Dimension, Module } from '@/engine/models'

function dim(): Dimension {
  return { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 1, isMultiSelect: false, isEnabled: true }
}

function mod(en: string, zh = ''): Module {
  return {
    id: `m_${en}`, dimensionId: 'd_top', contentEn: en, displayName: zh,
    weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top',
  }
}

const CTX = () => ({ dimension: dim(), modules: [] as Module[] })

describe('fragmentGenerateParse — detectFragmentFormat', () => {
  it('含 fence 的 JSON 探测为 json', () => {
    const t = '```json\n{"format":"pmf-fragments","items":[{"contentEn":"a"}]}\n```'
    expect(detectFragmentFormat(t)).toBe('json')
  })
  it('纯行文本探测为 lines', () => {
    expect(detectFragmentFormat('white shirt\nblue jeans\n')).toBe('lines')
  })
  it('空输入为 unknown', () => {
    expect(detectFragmentFormat('   ')).toBe('unknown')
  })
  it('含大括号但无 contentEn 为 unknown', () => {
    expect(detectFragmentFormat('{ not json at all')).toBe('unknown')
  })
})

describe('fragmentGenerateParse — JSON 解析', () => {
  it('含 fence + 前后解释的 JSON 可提取', () => {
    const body = JSON.stringify({
      format: 'pmf-fragments', formatVersion: 1, dimensionKey: 'top', count: 2,
      items: [
        { contentEn: 'slub cotton henley, sand', displayName: '砂色亨利衫' },
        { contentEn: 'mohair cardigan, lilac', displayName: '' },
      ],
    })
    const text = `Here is the result:\n\`\`\`json\n${body}\n\`\`\`\nDone.`
    const batch = parseFragmentText(text, CTX())
    expect(batch.errors.length).toBe(0)
    expect(batch.stats.valid).toBe(2)
    expect(batch.rows[0]!.contentEn).toBe('slub cotton henley, sand')
    expect(batch.rows[0]!.selected).toBe(true)
  })
  it('顶层扁平数组可提取', () => {
    const text = JSON.stringify([{ contentEn: 'white shirt', displayName: '白衬衫' }])
    const batch = parseFragmentText(text, CTX())
    expect(batch.stats.valid).toBe(1)
  })
  it('别名字段可归一', () => {
    const text = JSON.stringify({
      items: [{ content_en: 'white shirt', zh: '白衬衫' }, { en: 'blue jeans', nameCn: '蓝牛仔裤' }],
    })
    const batch = parseFragmentText(text, CTX())
    expect(batch.stats.valid).toBe(2)
    expect(batch.rows[0]!.contentEn).toBe('white shirt')
    expect(batch.rows[1]!.displayName).toBe('蓝牛仔裤')
    expect(batch.warnings.join('')).toContain('缺失 format')
  })
  it('count 不一致只警告不拒绝', () => {
    const text = JSON.stringify({ format: 'pmf-fragments', count: 5, items: [{ contentEn: 'a' }] })
    const batch = parseFragmentText(text, CTX())
    expect(batch.stats.valid).toBe(1)
    expect(batch.warnings.join('')).toContain('count')
  })
})

describe('fragmentGenerateParse — 纯行 fallback', () => {
  it('一行一条英文可提取', () => {
    const batch = parseFragmentText('white shirt\nblue jeans\n', CTX())
    expect(batch.kind).toBe('lines')
    expect(batch.stats.valid).toBe(2)
  })
  it('| 中文后缀可拆分', () => {
    const batch = parseFragmentText('slub cotton henley, sand | 砂色亨利衫\n', CTX())
    expect(batch.rows[0]!.contentEn).toBe('slub cotton henley, sand')
    expect(batch.rows[0]!.displayName).toBe('砂色亨利衫')
  })
})

describe('fragmentGenerateParse — 校验', () => {
  it('批内大小写重复判 duplicate_in_batch', () => {
    const batch = parseFragmentText('White Shirt\nwhite  shirt\n', CTX())
    expect(batch.stats.dupBatch).toBe(1)
    expect(batch.rows[1]!.status).toBe('duplicate_in_batch')
    expect(batch.rows[1]!.selected).toBe(false)
  })
  it('库内归一重复判 duplicate_in_db', () => {
    const ctx = { dimension: dim(), modules: [mod('White Shirt', '白衬衫')] }
    const batch = parseFragmentText('white shirt\nnew item\n', ctx)
    expect(batch.stats.dupDb).toBe(1)
    expect(batch.rows[0]!.status).toBe('duplicate_in_db')
    expect(batch.rows[0]!.warnings.join('')).toContain('归一')
  })
  it('超 500 截断且 too_long', () => {
    const long = `x${'y'.repeat(600)}`
    const batch = parseFragmentText(JSON.stringify({ items: [{ contentEn: long }] }), CTX())
    expect(batch.stats.tooLong).toBe(1)
    expect([...batch.rows[0]!.contentEn].length).toBe(500)
    expect(batch.rows[0]!.status).toBe('ok')
  })
  it('超 50 条截断 50 + warnings', () => {
    const items = Array.from({ length: GENERATE_MAX_ITEMS + 10 }, (_, i) => ({ contentEn: `item ${i}` }))
    const batch = parseFragmentText(JSON.stringify({ items }), CTX())
    expect(batch.rows.length).toBe(GENERATE_MAX_ITEMS)
    expect(batch.warnings.join('')).toContain(`${GENERATE_MAX_ITEMS}`)
  })
  it('validateFragmentBatch 空行判 empty', () => {
    const batch = validateFragmentBatch(
      [{ contentEn: '  ', displayName: '', warnings: [] }],
      CTX(),
    )
    expect(batch.stats.empty).toBe(1)
  })
  it('normalizeFragmentKey 归一', () => {
    expect(normalizeFragmentKey('  White   Shirt ')).toBe('white shirt')
  })
  it('countDetectedContentEn 计数', () => {
    expect(countDetectedContentEn('{"contentEn":"a","contentEn":"b"}')).toBe(2)
  })
})

describe('fragmentGenerateParse — toBatchCreatePayload', () => {
  it('空中文传 null、notes 打标、mode/weight/isNsfw 透传', () => {
    const batch = parseFragmentText(
      JSON.stringify({ items: [{ contentEn: 'white shirt', displayName: '' }] }),
      CTX(),
    )
    const payload = toBatchCreatePayload(batch.rows, dim(), { mode: 'skip', weight: 1.5, isNsfw: true })
    expect(payload.dimId).toBe('d_top')
    expect(payload.mode).toBe('skip')
    expect(payload.weight).toBe(1.5)
    expect(payload.isNsfw).toBe(true)
    expect(payload.items[0]!.displayName).toBeNull()
    expect(payload.items[0]!.notes).toMatch(/^pmf-generate /)
  })
  it('只收录 selected 且 ok 的行', () => {
    const batch = parseFragmentText('White Shirt\nwhite shirt\n', CTX())
    batch.rows[0]!.selected = false
    const payload = toBatchCreatePayload(batch.rows, dim(), { mode: 'overwrite', weight: 1, isNsfw: false })
    expect(payload.items.length).toBe(0)
  })
})
