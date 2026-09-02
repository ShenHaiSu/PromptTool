import { describe, it, expect } from 'vitest'
import {
  chunkModules,
  buildTranslationPrompt,
  buildAllTranslationPrompts,
  estimateTranslationTokens,
  buildTranslationExportFilename,
  buildTranslationExportContent,
  TRANSLATION_CHUNK_SIZE_DEFAULT,
} from './translationPrompt'
import type { Dimension, Module } from '@/engine/models'

function dim(over: Partial<Dimension> = {}): Dimension {
  return {
    id: 'd_top',
    key: 'top',
    nameCn: '上装',
    nameEn: 'Top',
    sortOrder: 1,
    isMultiSelect: false,
    isEnabled: true,
    ...over,
  }
}

function mod(id: string, contentEn = `content ${id}`): Module {
  return {
    id,
    dimensionId: 'd_top',
    contentEn,
    displayName: contentEn.slice(0, 20),
    weight: 1,
    isEnabled: true,
    isNsfw: false,
    usageCount: 0,
    notes: null,
    dimensionKey: 'top',
  }
}

describe('translationPrompt', () => {
  it('chunkModules 边界：0/30/31/1000', () => {
    expect(chunkModules([], 30)).toEqual([])
    const a30 = Array.from({ length: 30 }, (_, i) => mod(`m_${i}`))
    const c1 = chunkModules(a30, 30)
    expect(c1.length).toBe(1)
    expect(c1[0]!.chunkId).toBe('c01')
    expect(c1[0]!.modules.length).toBe(30)

    const a31 = Array.from({ length: 31 }, (_, i) => mod(`m_${i}`))
    const c2 = chunkModules(a31, 30)
    expect(c2.length).toBe(2)
    expect(c2[1]!.chunkId).toBe('c02')
    expect(c2[1]!.modules.length).toBe(1)

    const a1000 = Array.from({ length: 1000 }, (_, i) => mod(`m_${i}`))
    const c3 = chunkModules(a1000, 30)
    expect(c3.length).toBe(34)
    expect(c3[33]!.modules.length).toBe(10)
  })

  it('chunkModules 非法尺寸抛错', () => {
    expect(() => chunkModules([mod('m1')], 0)).toThrow()
  })

  it('buildTranslationPrompt 含 dimensionKey/chunkId 且输出含合法 JSON 结构', () => {
    const d = dim()
    const chunk = { chunkId: 'c01', index: 1, total: 1, modules: [mod('m1', 'oversized white shirt'), mod('m2', 'cropped tank')] }
    const text = buildTranslationPrompt({ dimension: d, chunk, totalModules: 2 })
    expect(text).toContain('dimensionKey: top')
    expect(text).toContain('chunkId')
    expect(text).toContain('pmf-translation')
    expect(text).toContain('oversized white shirt')
    expect(text).toContain('Translate chunk c01/1')
  })

  it('buildAllTranslationPrompts 与 chunkModules 一致', () => {
    const d = dim()
    const mods = Array.from({ length: 65 }, (_, i) => mod(`m_${i}`))
    const { prompts, chunks } = buildAllTranslationPrompts(d, mods, 30)
    expect(chunks.length).toBe(3)
    expect(prompts.length).toBe(3)
    expect(prompts[0]).toContain('c01')
    expect(prompts[2]).toContain('c03')
  })

  it('estimateTranslationTokens ≈ len/4 向上取整', () => {
    expect(estimateTranslationTokens('abcd')).toBe(1)
    expect(estimateTranslationTokens('a'.repeat(10))).toBe(3)
  })

  it('buildTranslationExportFilename 含 key 与时间戳', () => {
    const name = buildTranslationExportFilename('top')
    expect(name).toMatch(/^pmf-translate-top-/)
    expect(name).toMatch(/\.md$/)
  })

  it('buildTranslationExportContent 首行总览 + 片间分隔', () => {
    const d = dim()
    const mods = [mod('m1'), mod('m2')]
    const { prompts } = buildAllTranslationPrompts(d, mods, 30)
    const content = buildTranslationExportContent(d, mods, 30, prompts)
    expect(content).toContain('PMF Translation')
    expect(content).toContain('chunk c01')
  })

  it('默认 chunkSize 为 30', () => {
    expect(TRANSLATION_CHUNK_SIZE_DEFAULT).toBe(30)
  })
})
