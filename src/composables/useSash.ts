import { ref, watch } from 'vue'

const STORAGE_KEY = 'pmf:sash'
const DEFAULT = [0.30, 0.38] as const // left 30%, center 38%, right 32% 余量

function load(): [number, number] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const arr = JSON.parse(raw) as number[]
      if (Array.isArray(arr) && arr.length === 2 && arr.every((v) => typeof v === 'number' && v > 0.12 && v < 0.65)) {
        return [arr[0]!, arr[1]!]
      }
    }
  } catch { /* ignore */ }
  return [DEFAULT[0], DEFAULT[1]]
}

export function useSash() {
  const leftFrac = ref(load()[0])
  const centerFrac = ref(load()[1])

  // 持久化
  watch([leftFrac, centerFrac], () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([leftFrac.value, centerFrac.value])) } catch { /* ignore */ }
  })

  function setFracs(left: number, center: number): void {
    // 约束：每栏 12%~65%，且 left+center < 0.92
    const l = Math.min(0.65, Math.max(0.12, left))
    const c = Math.min(0.65, Math.max(0.12, center))
    if (l + c >= 0.92) return
    leftFrac.value = l
    centerFrac.value = c
  }

  return { leftFrac, centerFrac, setFracs }
}
