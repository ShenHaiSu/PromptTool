import { describe, it, expect } from 'vitest'
import { parseSegmentsText, validateBatch, parseAndValidate, toSegmentsJson, toTaggedText } from './segmentParse'
import type { Dimension } from '@/engine/models'

const dims: Dimension[] = [
  { id: 'd_body', key: 'body', nameCn: '身材', nameEn: 'Body', sortOrder: 1, isMultiSelect: false, isEnabled: true },
  { id: 'd_face', key: 'face', nameCn: '面部', nameEn: 'Face', sortOrder: 2, isMultiSelect: false, isEnabled: true },
  { id: 'd_top', key: 'top', nameCn: '上装', nameEn: 'Top', sortOrder: 3, isMultiSelect: false, isEnabled: true },
  { id: 'd_acc', key: 'accessories', nameCn: '配饰', nameEn: 'Accessories', sortOrder: 4, isMultiSelect: true, isEnabled: true },
  { id: 'd_camera', key: 'camera', nameCn: '相机', nameEn: 'Camera', sortOrder: 5, isMultiSelect: false, isEnabled: true },
]

function jsonBatchOne(): string {
  return JSON.stringify({
    format: 'pmf-segments',
    formatVersion: 1,
    prompts: [
      {
        id: 'p01',
        raw: 'slim waist, oval face, white shirt',
        segments: [
          { dimensionKey: 'body', contentEn: 'slim waist' },
          { dimensionKey: 'face', contentEn: 'oval face' },
          { dimensionKey: 'top', contentEn: 'white shirt' },
        ],
      },
    ],
  })
}

describe('segmentParse', () => {
  it('JSON 单条 roundtrip status ok', () => {
    const batch = parseAndValidate(jsonBatchOne(), dims)
    expect(batch.stats.prompts).toBe(1)
    expect(batch.prompts[0]!.status).toBe('ok')
    expect(batch.stats.segments).toBe(3)
  })

  it('JSON 批量 3 条', () => {
    const text = JSON.stringify({
      format: 'pmf-segments',
      formatVersion: 1,
      prompts: [0, 1, 2].map(i => ({
        id: `p0${i + 1}`,
        raw: `prompt ${i}`,
        segments: [{ dimensionKey: 'body', contentEn: `body ${i}` }],
      })),
    })
    const batch = parseAndValidate(text, dims)
    expect(batch.stats.prompts).toBe(3)
    expect(batch.prompts.length).toBe(3)
  })

  it('tagged 单条 -> JSON 再解析', () => {
    const tagged = '[body] slim waist\n[face] oval face\n[top] white shirt'
    const batch = parseAndValidate(tagged, dims)
    expect(batch.kind).toBe('tagged')
    expect(batch.prompts.length).toBe(1)
    const json = toSegmentsJson(batch)
    const roundtrip = parseAndValidate(json, dims)
    expect(roundtrip.stats.prompts).toBe(1)
    expect(roundtrip.prompts[0]!.segments.length).toBe(3)
  })

  it('兼容：顶层单 entry 无 prompts 包裹', () => {
    const text = JSON.stringify({ raw: 'slim waist, oval face', segments: [{ dimensionKey: 'body', contentEn: 'slim waist' }] })
    const { batch } = parseSegmentsText(text)
    expect(batch.prompts.length).toBe(1)
    expect(batch.prompts[0]!.raw).toBe('slim waist, oval face')
  })

  it('维度校验：未知 key 标记 needs_review', () => {
    const text = JSON.stringify({
      format: 'pmf-segments',
      formatVersion: 1,
      prompts: [{ id: 'p01', raw: 'a', segments: [{ dimensionKey: 'unknown_xyz', contentEn: 'something' }] }],
    })
    const batch = parseAndValidate(text, dims)
    expect(batch.prompts[0]!.status).toBe('needs_review')
    expect(batch.prompts[0]!.stats.unknownDimension).toBe(1)
  })

  it('单选维度多段告警：accessories 多段不告警，body 多段告警', () => {
    const text = JSON.stringify({
      format: 'pmf-segments',
      formatVersion: 1,
      prompts: [{
        id: 'p01',
        raw: 'a, b, c',
        segments: [
          { dimensionKey: 'accessories', contentEn: 'earring' },
          { dimensionKey: 'accessories', contentEn: 'bag' },
          { dimensionKey: 'body', contentEn: 'slim' },
          { dimensionKey: 'body', contentEn: 'tall' },
        ],
      }],
    })
    const batch = parseAndValidate(text, dims)
    const p = batch.prompts[0]!
    // body 多段应产生 entry 警告
    expect(p.warnings.some(w => w.includes('body'))).toBe(true)
    // accessories 多段不应告警
    expect(p.warnings.some(w => w.includes('accessories'))).toBe(false)
  })

  it('weight 超范围 clamp 2.0', () => {
    const text = JSON.stringify({
      format: 'pmf-segments',
      formatVersion: 1,
      prompts: [{ id: 'p01', raw: 'a', segments: [{ dimensionKey: 'top', contentEn: 'shirt', weight: 3.0 }] }],
    })
    const batch = parseAndValidate(text, dims)
    expect(batch.prompts[0]!.segments[0]!.weight).toBe(2.0)
    expect(batch.prompts[0]!.segments[0]!.warnings.length).toBeGreaterThan(0)
  })

  it('空 contentEn 丢弃', () => {
    const text = JSON.stringify({
      format: 'pmf-segments',
      formatVersion: 1,
      prompts: [{ id: 'p01', raw: 'a', segments: [{ dimensionKey: 'top', contentEn: '   ' }] }],
    })
    const batch = parseAndValidate(text, dims)
    expect(batch.prompts[0]!.segments[0]!.status).toBe('error')
  })

  it('非法 JSON 返回 unknown 错误', () => {
    const text = 'not a json nor tagged { broken'
    const batch = parseAndValidate(text, dims)
    expect(batch.errors.length).toBeGreaterThan(0)
    expect(batch.stats.prompts).toBe(0)
  })

  it('带 fence 的 JSON 可解析', () => {
    const json = '```json\n' + jsonBatchOne() + '\n```'
    const batch = parseAndValidate(json, dims)
    expect(batch.stats.prompts).toBe(1)
  })

  it('toTaggedText / toSegmentsJson 往返', () => {
    const tagged = '[body] slim waist\n[face] oval face'
    const batch = parseAndValidate(tagged, dims)
    const json = toSegmentsJson(batch)
    const jsonBatch = parseAndValidate(json, dims)
    expect(jsonBatch.stats.prompts).toBe(1)
    const backToTagged = toTaggedText(jsonBatch)
    expect(backToTagged).toContain('[body]')
  })

  it('validateBatch counts mismatch 仅告警', () => {
    const text = JSON.stringify({
      format: 'pmf-segments',
      formatVersion: 1,
      counts: { prompts: 99, segments: 99, unassigned: 0 },
      prompts: [{ id: 'p01', raw: 'a', segments: [{ dimensionKey: 'body', contentEn: 'a' }] }],
    })
    const { batch } = parseSegmentsText(text)
    const validated = validateBatch(batch, dims)
    expect(validated.warnings.some(w => w.includes('counts.prompts'))).toBe(true)
  })
})
