import { describe, it, expect, beforeEach } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useSash } from '@/composables/useSash'

function setup() {
  let api!: ReturnType<typeof useSash>
  const C = defineComponent({ setup() { api = useSash(); return () => h('div') } })
  const w = mount(C)
  return { api, w }
}

beforeEach(() => { localStorage.clear() })

describe('useSash（need04 双栏）', () => {
  it('无存档时回落 33%', () => {
    const { api } = setup()
    expect(api.leftFrac.value).toBeCloseTo(0.33, 5)
  })

  it('旧双比例 [0.28,0.42] 迁移为 0.4', () => {
    localStorage.setItem('pmf:sash', JSON.stringify([0.28, 0.42]))
    const { api } = setup()
    expect(api.leftFrac.value).toBeCloseTo(0.4, 5)
  })

  it('新格式单比例 [0.3] 直读', () => {
    localStorage.setItem('pmf:sash', JSON.stringify([0.3]))
    const { api } = setup()
    expect(api.leftFrac.value).toBeCloseTo(0.3, 5)
  })

  it('超界比例收敛到 50%', () => {
    localStorage.setItem('pmf:sash', JSON.stringify([0.6, 0.3]))
    const { api } = setup()
    expect(api.leftFrac.value).toBeCloseTo(0.5, 5)
  })

  it('脏值回落默认不抛错', () => {
    localStorage.setItem('pmf:sash', '"oops"')
    const { api } = setup()
    expect(api.leftFrac.value).toBeCloseTo(0.33, 5)
  })

  it('setLeftFrac 夹取到 [0.18,0.5]', () => {
    const { api } = setup()
    api.setLeftFrac(0.9);  expect(api.leftFrac.value).toBeCloseTo(0.5, 5)
    api.setLeftFrac(0.05); expect(api.leftFrac.value).toBeCloseTo(0.18, 5)
    api.setLeftFrac(Number.NaN)
    expect(api.leftFrac.value).toBeCloseTo(0.18, 5) // NaN 被忽略，保持上一次有效值
  })

  it('变化后持久化为单元素数组', async () => {
    const { api } = setup()
    api.setLeftFrac(0.25)
    await nextTick()
    expect(JSON.parse(localStorage.getItem('pmf:sash')!)).toEqual([0.25])
  })
})
