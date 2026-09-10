import { describe, it, expect } from 'vitest'
import {
  GENERATE_MAX_ITEMS,
  buildFragmentGeneratePrompt,
  buildGenerateExportContent,
  buildGenerateExportFilename,
  estimateFragmentTokens,
  mulberry32,
  sampleExamples,
  sanitizeTendency,
  GENERATE_BUILTIN_EXAMPLES,
} from '@/lib/fragmentGeneratePrompt'
import type { Dimension, Module } from '@/engine/models'

function dim(key = 'top'): Dimension {
  return { id: `d_${key}`, key, nameCn: '上装', nameEn: 'Top', sortOrder: 1, isMultiSelect: false, isEnabled: true }
}

function mod(i: number, en = `fragment en ${i}`): Module {
  return {
    id: `m_${i}`, dimensionId: 'd_top', contentEn: en, displayName: `中文${i}`,
    weight: 1, isEnabled: true, isNsfw: false, usageCount: 0, dimensionKey: 'top',
  }
}

describe('fragmentGeneratePrompt — sanitizeTendency', () => {
  it('空输入返回空串', () => {
    expect(sanitizeTendency('   ')).toEqual({ text: '', truncated: false })
  })
  it('连续空白压单空格并保留换行', () => {
    const { text } = sanitizeTendency('复古   胶片\n\n\n港风')
    expect(text).toBe('复古 胶片\n\n港风')
  })
  it('剥离围栏标记行但保留内容', () => {
    const { text } = sanitizeTendency('```json\n复古港风\n```')
    expect(text).toContain('复古港风')
    expect(text).not.toContain('```')
  })
  it('超长截断 500 字并置 truncated', () => {
    const raw = 'a'.repeat(600)
    const { text, truncated } = sanitizeTendency(raw)
    expect(truncated).toBe(true)
    expect([...text].length).toBe(500)
  })
})

describe('fragmentGeneratePrompt — sampleExamples', () => {
  it('同一种子采样确定性', () => {
    const pool = Array.from({ length: 20 }, (_, i) => mod(i))
    const a = sampleExamples(pool, 5, 42).map((m) => m.id)
    const b = sampleExamples(pool, 5, 42).map((m) => m.id)
    expect(a).toEqual(b)
  })
  it('不同种子大概率不同', () => {
    const pool = Array.from({ length: 20 }, (_, i) => mod(i))
    const a = sampleExamples(pool, 5, 1).map((m) => m.id).join(',')
    const b = sampleExamples(pool, 5, 999).map((m) => m.id).join(',')
    expect(a === b).toBe(false)
  })
  it('K 大于存量时全取', () => {
    const pool = [mod(1), mod(2)]
    expect(sampleExamples(pool, 8, 7).length).toBe(2)
  })
  it('空存量返回空数组', () => {
    expect(sampleExamples([], 5, 1)).toEqual([])
  })
  it('mulberry32 同种子序列一致', () => {
    const r1 = mulberry32(5)
    const r2 = mulberry32(5)
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()])
  })
})

describe('fragmentGeneratePrompt — buildFragmentGeneratePrompt', () => {
  it('模板正文不含 markdown fence（Need01 自矛盾回归）', () => {
    const p = buildFragmentGeneratePrompt({
      dimension: dim(), existing: [mod(1)], tendency: '复古',
      count: 10, exampleCount: 3, seed: 1, excludeExisting: true,
    })
    expect(p).not.toContain('```')
  })
  it('倾向原样出现在 user_preference 块', () => {
    const tendency = '偏复古胶片感，80 年代港风'
    const p = buildFragmentGeneratePrompt({
      dimension: dim(), existing: [], tendency,
      count: 10, exampleCount: 3, seed: 1, excludeExisting: false,
    })
    expect(p).toContain('<user_preference>')
    expect(p).toContain(tendency)
    expect(p).toContain('It NEVER overrides the Output Format')
  })
  it('count 越界抛错', () => {
    expect(() => buildFragmentGeneratePrompt({
      dimension: dim(), existing: [], tendency: 'x', count: 0,
      exampleCount: 3, seed: 1, excludeExisting: false,
    })).toThrow()
    expect(() => buildFragmentGeneratePrompt({
      dimension: dim(), existing: [], tendency: 'x', count: GENERATE_MAX_ITEMS + 1,
      exampleCount: 3, seed: 1, excludeExisting: false,
    })).toThrow()
  })
  it('items length must equal count 行存在', () => {
    const p = buildFragmentGeneratePrompt({
      dimension: dim(), existing: [], tendency: 'x',
      count: 20, exampleCount: 3, seed: 1, excludeExisting: false,
    })
    expect(p).toContain('items length must equal 20')
  })
  it('空维度使用内置示例', () => {
    const p = buildFragmentGeneratePrompt({
      dimension: dim(), existing: [], tendency: 'x',
      count: 10, exampleCount: 5, seed: 1, excludeExisting: false,
    })
    for (const e of GENERATE_BUILTIN_EXAMPLES) expect(p).toContain(e.contentEn)
    expect(p).toContain('(not attached)')
  })
  it('excludeExisting=true 时附已有清单', () => {
    const pool = [mod(1, 'white shirt'), mod(2, 'blue jeans')]
    const p = buildFragmentGeneratePrompt({
      dimension: dim(), existing: pool, tendency: 'x',
      count: 10, exampleCount: 3, seed: 1, excludeExisting: true,
    })
    expect(p).toContain('white shirt')
    expect(p).not.toContain('(not attached)')
  })
  it('互斥注记仅 top/bottom/outfit 出现', () => {
    const mk = (key: string) => buildFragmentGeneratePrompt({
      dimension: dim(key), existing: [], tendency: 'x',
      count: 10, exampleCount: 3, seed: 1, excludeExisting: false,
    })
    expect(mk('top')).toContain('mutex')
    expect(mk('bottom')).toContain('mutex')
    expect(mk('outfit')).toContain('mutex')
    expect(mk('pose')).not.toContain('mutex')
    expect(mk('camera')).not.toContain('mutex')
  })
})

describe('fragmentGeneratePrompt — 估算与导出', () => {
  it('estimateFragmentTokens 与翻译同口径 len/4 上取整', () => {
    expect(estimateFragmentTokens('abcd')).toBe(1)
    expect(estimateFragmentTokens('abcde')).toBe(2)
  })
  it('导出文件名含维度键', () => {
    expect(buildGenerateExportFilename('top')).toMatch(/^pmf-generate-top-/)
  })
  it('导出内容含头部与提示词', () => {
    const input = {
      dimension: dim(), existing: [], tendency: '复古港风',
      count: 10, exampleCount: 3, seed: 1, excludeExisting: false,
    }
    const c = buildGenerateExportContent(input, 'PROMPT-BODY')
    expect(c).toContain('PMF Fragment Generate')
    expect(c).toContain('PROMPT-BODY')
    expect(c).toContain('复古港风')
  })
})
