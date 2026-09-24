import { ref } from 'vue'

/** need01 需求3：报表浮层全局开关（运行条 + StatusBar 双入口共用同一 Dialog）。 */
const showStatsReport = ref(false)

export function useStatsReport() {
  function open(): void {
    showStatsReport.value = true
  }
  function close(): void {
    showStatsReport.value = false
  }
  return { showStatsReport, open, close }
}
