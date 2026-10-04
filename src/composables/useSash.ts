import { ref, watch } from 'vue'
import { STORAGE_KEYS } from '@/lib/storageKeys'
import { logger } from '@/lib/logger'

const STORAGE_KEY = STORAGE_KEYS.SASH // 'pmf:sash'

/** need04：主界面收敛为双栏，左栏区间与默认值 */
const MIN = 0.18
const MAX = 0.5
const DEFAULT_LEFT = 0.33

function clamp(v: number): number {
  return Math.min(MAX, Math.max(MIN, v))
}

/**
 * 读取左栏比例。
 * 兼容 need04 之前的双比例存量格式 [left, center]（元素个数为 2），
 * 按 left/(left+center) 归一化迁移为单比例（决策 D2）。
 */
function load(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_LEFT
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_LEFT
    const nums = arr.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (nums.length === 0) return DEFAULT_LEFT

    if (nums.length >= 2) {
      const [left, center] = nums as [number, number]
      const sum = left + center
      if (sum > 0) {
        const migrated = clamp(left / sum) // 旧 28:42 → 0.40 → clamp 0.40
        logger.warn('useSash', `need04 布局迁移：旧双比例 [${left}, ${center}] → ${migrated.toFixed(4)}`)
        return migrated
      }
      logger.warn('useSash', `旧比例和为 0（${JSON.stringify(nums)}），回落默认值`)
      return DEFAULT_LEFT
    }

    const only = nums[0] as number
    if (only <= 0 || only >= 1) {
      logger.warn('useSash', `单比例越界（${only}），回落默认值`)
      return DEFAULT_LEFT
    }
    const v = clamp(only)
    if (v !== only) logger.warn('useSash', `单比例超区间（${only}），收敛为 ${v.toFixed(4)}`)
    return v
  } catch (e) {
    logger.warn('useSash', '读取分栏比例失败，回落默认值：', e)
  }
  return DEFAULT_LEFT
}

export function useSash() {
  const leftFrac = ref(load())

  watch(leftFrac, (v) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([Number(v.toFixed(4))]))
    } catch (e) {
      logger.warn('useSash', '保存分栏比例失败：', e)
    }
  })

  function setLeftFrac(v: number): void {
    if (!Number.isFinite(v)) {
      logger.warn('useSash', `非法比例 ${String(v)}，忽略`)
      return
    }
    leftFrac.value = clamp(v)
  }

  return { leftFrac, setLeftFrac }
}
