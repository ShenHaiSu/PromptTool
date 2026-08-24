/**
 * 语法适配器 — 对标 src/engine/adapters.py
 * SD / MJ / Flux — 与 Python 同步
 */
import type { AssemblyConfig, IRSegment } from './models'
import type { PromptIR } from './models'

export function adaptToModel(ir: PromptIR, profile: string, config: AssemblyConfig): string {
  let parts: string[]
  if (profile === 'mj') parts = ir.segments.map((s) => adaptSegmentMJ(s, config))
  else if (profile === 'flux') parts = ir.segments.map((s) => adaptSegmentFlux(s, config))
  else parts = ir.segments.map((s) => adaptSegmentSD(s, config))
  return parts.join(config.separator)
}

function adaptSegmentSD(seg: IRSegment, config: AssemblyConfig): string {
  if (!config.useWeightBrackets || seg.weight === 1.0) return seg.text
  if (seg.weight > 1.0) return `(${seg.text}:${seg.weight.toFixed(1)})`
  return `[${seg.text}]`
}

function adaptSegmentMJ(seg: IRSegment, _config: AssemblyConfig): string {
  if (seg.weight === 1.0) return seg.text
  return `${seg.text}::${seg.weight}`
}

function adaptSegmentFlux(seg: IRSegment, _config: AssemblyConfig): string {
  return seg.text
}
