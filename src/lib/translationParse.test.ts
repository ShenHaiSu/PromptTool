import { describe, it, expect } from 'vitest'
import {
  extractTranslationJsonBlocks,
  parseTranslationBlock,
  parseTranslationText,
  validateTranslationBatch,
} from './translationParse'
import type { Dimension, Module } from '@/engine/models'

function dim(): Dimension {
  return { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 1, isMultiSelect: false, isEnabled: true }
}
function mod(id: string, contentEn = `content ${id}`): Module {
  return { id, dimensionId: 'd_top', contentEn, displayName: contentEn.slice(0, 20), weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, notes: null, dimensionKey: 'top' }
}

const jsonOne = JSON.stringify({
  format: 'pmf-translation',
  formatVersion: 1,
  dimensionKey: 'top',
  chunkId: 'c01',
  totalChunks: 1,
  items: [{ id: 'm1', zh: '中文一' }, { id: 'm2', zh: '中文二' }],
})

describe('translationParse', () => {
  it('单片解析', () => {
    const r = parseTranslationText(jsonOne)
    expect(r.stats.uniqueIds).toBe(2)
    expect(r.pendingMap.get('m1')?.zh).toBe('中文一')
  })

  it('多片拼接', () => {
    const j2 = JSON.stringify({ format: 'pmf-translation', formatVersion: 1, dimensionKey: 'top', chunkId: 'c02', items: [{ id: 'm3', zh: '中文三' }] })
    const text = `${jsonOne}\n\n${j2}`
    const r = parseTranslationText(text)
    expect(r.stats.blocks).toBe(2)
    expect(r.stats.uniqueIds).toBe(3)
  })

  it('含 fence', () => {
    const fenced = '以下是翻译：\n```json\n' + jsonOne + '\n```\n请查收'
    const r = parseTranslationText(fenced)
    expect(r.stats.uniqueIds).toBe(2)
  })

  it('含解释文本围着 JSON', () => {
    const text = `解释：\n${jsonOne}\n结束`
    const r = parseTranslationText(text)
    expect(r.stats.uniqueIds).toBe(2)
  })

  it('重复 id 后者覆盖', () => {
    const j1 = JSON.stringify({ format: 'pmf-translation', formatVersion: 1, chunkId: 'c01', items: [{ id: 'm1', zh: '旧' }] })
    const j2 = JSON.stringify({ format: 'pmf-translation', formatVersion: 1, chunkId: 'c02', items: [{ id: 'm1', zh: '新' }] })
    const r = parseTranslationText(`${j1}\n${j2}`)
    expect(r.pendingMap.get('m1')?.zh).toBe('新')
    expect(r.stats.duplicateIds).toBe(1)
    expect(r.warnings.join('')).toContain('重复')
  })

  it('扁平 map 兼容', () => {
    const flat = JSON.stringify({ format: 'pmf-translation', formatVersion: 1, chunkId: 'c01', items: { m1: '中文一', m2: '中文二' } })
    const r = parseTranslationText(flat)
    expect(r.stats.uniqueIds).toBe(2)
    expect(r.pendingMap.get('m2')?.zh).toBe('中文二')
  })

  it('空 zh 丢弃', () => {
    const j = JSON.stringify({ format: 'pmf-translation', formatVersion: 1, chunkId: 'c01', items: [{ id: 'm1', zh: '   ' }, { id: 'm2', zh: '有效' }] })
    const r = parseTranslationText(j)
    expect(r.stats.uniqueIds).toBe(1)
    expect(r.pendingMap.has('m1')).toBe(false)
  })

  it('非本维度 id 校验为 unknown', () => {
    const r = parseTranslationText(jsonOne)
    const validated = validateTranslationBatch(r, { dimension: dim(), modules: [mod('m1')] })
    expect(validated.stats.unknown).toBe(1)
    expect(validated.rows.find((x) => x.id === 'm2')?.status).toBe('unknownId')
    expect(validated.rows.find((x) => x.id === 'm2')?.selected).toBe(false)
  })

  it('超长截断', () => {
    const longZh = '中'.repeat(600)
    const j = JSON.stringify({ format: 'pmf-translation', formatVersion: 1, chunkId: 'c01', items: [{ id: 'm1', zh: longZh }] })
    const b = parseTranslationBlock(j)
    expect(b.warnings.join('')).toContain('截断')
    expect(b.items[0]!.zh.length).toBe(500)
  })

  it('extractTranslationJsonBlocks 多块提取', () => {
    const j2 = JSON.stringify({ format: 'pmf-translation', formatVersion: 1, chunkId: 'c02', items: [{ id: 'm3', zh: '三' }] })
    const blocks = extractTranslationJsonBlocks(`${jsonOne}\n---\n${j2}`)
    expect(blocks.length).toBe(2)
  })

  it('validate 排序按白名单原序', () => {
    const j = JSON.stringify({ format: 'pmf-translation', formatVersion: 1, chunkId: 'c01', items: [{ id: 'm2', zh: '二' }, { id: 'm1', zh: '一' }] })
    const r = parseTranslationText(j)
    const validated = validateTranslationBatch(r, { dimension: dim(), modules: [mod('m1'), mod('m2')] })
    expect(validated.rows[0]!.id).toBe('m1')
    expect(validated.rows[1]!.id).toBe('m2')
  })

  it('无 format 但含 items 兼容解析', () => {
    const j = JSON.stringify({ items: [{ id: 'm1', zh: '中文' }] })
    const b = parseTranslationBlock(j)
    expect(b.kind).toBe('json')
    expect(b.items.length).toBe(1)
  })
})
