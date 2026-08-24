/**
 * 规则引擎 — 对标 src/engine/rules.py
 * R01 套装互斥 / R02 裸足 / R03 室内外 — 使用对象引用 WeakSet 避免 id() 误判
 */
import type { SelectedItem } from './models'

export function applyRules(selected: SelectedItem[]): [SelectedItem[], string[]] {
  const warnings: string[] = []
  const items = [...selected]
  const removed = new WeakSet<SelectedItem>()

  // R01: outfit → top/bottom 剔除（未锁定）
  const hasOutfit = items.some((it) => it.module.dimensionKey === 'outfit')
  if (hasOutfit) {
    let removedAny = false
    for (const it of items) {
      if ((it.module.dimensionKey === 'top' || it.module.dimensionKey === 'bottom') && !it.locked) {
        removed.add(it)
        removedAny = true
      }
    }
    if (removedAny) warnings.push('已选全身套装，上装/下装将自动忽略')
  }

  // R02: 鞋袜与赤脚互斥
  const shoesItems = items.filter((it) => it.module.dimensionKey === 'shoes')
  const hasBarefoot = shoesItems.some((it) => it.module.contentEn.toLowerCase().includes('barefoot'))
  const hasShoes = shoesItems.some((it) => !it.module.contentEn.toLowerCase().includes('barefoot'))
  if (hasBarefoot && hasShoes) {
    const barefootLocked = shoesItems.some(
      (it) => it.locked && it.module.contentEn.toLowerCase().includes('barefoot'),
    )
    if (barefootLocked) {
      let removedAny = false
      for (const it of shoesItems) {
        if (!it.module.contentEn.toLowerCase().includes('barefoot') && !it.locked) {
          if (!removed.has(it)) { removed.add(it); removedAny = true }
        }
      }
      if (removedAny) warnings.push('赤脚与鞋袜不可共存，已剔除鞋袜项')
    } else {
      let removedAny = false
      for (const it of shoesItems) {
        if (it.module.contentEn.toLowerCase().includes('barefoot') && !it.locked) {
          if (!removed.has(it)) { removed.add(it); removedAny = true }
        }
      }
      if (removedAny) warnings.push('赤脚与鞋袜不可共存，已剔除赤脚项')
    }
  }

  // R03: 室内外背景互斥 — 保留 studio
  const bgItems = items.filter((it) => it.module.dimensionKey === 'background')
  const hasStudio = bgItems.some((it) => it.module.contentEn.toLowerCase().includes('studio'))
  const hasOutdoor = bgItems.some((it) =>
    ['beach', 'sunset', 'street', 'rooftop'].some((kw) => it.module.contentEn.toLowerCase().includes(kw)),
  )
  if (hasStudio && hasOutdoor) {
    let removedAny = false
    for (const it of bgItems) {
      if (!it.module.contentEn.toLowerCase().includes('studio') && !it.locked) {
        if (!removed.has(it)) { removed.add(it); removedAny = true }
      }
    }
    if (removedAny) warnings.push('室内背景与户外背景冲突，已保留棚拍')
  }

  const filtered = items.filter((it) => !removed.has(it))
  return [filtered, warnings]
}
