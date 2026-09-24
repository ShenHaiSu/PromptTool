<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useStatsReport } from '@/composables/useStatsReport'
import { useToast } from '@/composables/useToast'
import { useImageQueueStore } from '@/stores/imageQueue'
import {
  statsLedgerSummary,
  statsLedgerDaily,
  statsLedgerHourly,
  todayStr,
  addDaysStr,
  formatPixels,
  type LedgerSummary,
  type LedgerDailyRow,
  type LedgerHourlyRow,
} from '@/lib/statsApi'

const statsUi = useStatsReport()
const { push } = useToast()
const iq = useImageQueueStore()

const from = ref(addDaysStr(todayStr(), -6))
const to = ref(todayStr())
const focusDay = ref(todayStr())
const loading = ref(false)
const summary = ref<LedgerSummary | null>(null)
const daily = ref<LedgerDailyRow[]>([])
const hourly = ref<LedgerHourlyRow[]>([])
const estimated = ref(false)

const successRate = computed(() => {
  const s = summary.value
  if (!s || s.total <= 0) return '—'
  return `${((s.succeeded / s.total) * 100).toFixed(1)}%`
})

const maxHour = computed(() => Math.max(1, ...hourly.value.map((h) => h.total)))

function setToday(): void {
  const t = todayStr()
  from.value = t
  to.value = t
  focusDay.value = t
  void fetchAll()
}

function setWeek(): void {
  const t = todayStr()
  from.value = addDaysStr(t, -6)
  to.value = t
  focusDay.value = t
  void fetchAll()
}

async function fetchAll(): Promise<void> {
  if (!statsUi.showStatsReport.value) return
  if (loading.value) return
  loading.value = true
  estimated.value = false
  try {
    const [s, d, h] = await Promise.all([
      statsLedgerSummary(from.value, to.value),
      statsLedgerDaily(from.value, to.value),
      statsLedgerHourly(focusDay.value),
    ])
    summary.value = s
    daily.value = d
    hourly.value = h
  } catch (err) {
    // 主库不可用：toast + 内存回退（当日内存计数，标注“估算”）
    push(`报表读取失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    estimated.value = true
    const mem = iq.stats
    summary.value = {
      total: mem.succeeded + mem.failed,
      succeeded: mem.succeeded,
      failed: mem.failed,
      pixels: 0,
      avgElapsedMs: 0,
    }
    daily.value = [{ day: todayStr(), total: mem.succeeded + mem.failed, succeeded: mem.succeeded, pixels: 0 }]
    hourly.value = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, succeeded: 0, pixels: 0 }))
  } finally {
    loading.value = false
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && statsUi.showStatsReport.value) statsUi.close()
}

watch(() => statsUi.showStatsReport.value, (open) => {
  if (open) {
    focusDay.value = to.value || todayStr()
    void fetchAll()
  }
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="statsUi.showStatsReport.value"
      data-testid="stats-report-dialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      @click.self="statsUi.close()"
    >
      <Card class="max-h-[85vh] w-full max-w-2xl overflow-auto p-4">
        <div class="flex items-center gap-2">
          <h4 class="text-sm font-semibold">📊 生成统计报表</h4>
          <span v-if="estimated" class="rounded bg-amber-100 px-1.5 py-px text-[11px] text-amber-700">估算（主库不可用，内存回退）</span>
          <div class="ml-auto flex items-center gap-1">
            <Button size="sm" variant="outline" class="h-7 text-xs" @click="setToday">今天</Button>
            <Button size="sm" variant="outline" class="h-7 text-xs" @click="setWeek">近7天</Button>
            <Button size="sm" variant="ghost" class="h-7 text-xs" @click="statsUi.close()">关闭</Button>
          </div>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <label class="flex items-center gap-1">
            <span class="text-muted-foreground">从</span>
            <input v-model="from" data-testid="stats-from" type="date" class="h-7 rounded border bg-background px-2 text-xs" />
          </label>
          <label class="flex items-center gap-1">
            <span class="text-muted-foreground">到</span>
            <input v-model="to" data-testid="stats-to" type="date" class="h-7 rounded border bg-background px-2 text-xs" />
          </label>
          <label class="flex items-center gap-1">
            <span class="text-muted-foreground">小时聚焦</span>
            <input v-model="focusDay" data-testid="stats-day" type="date" class="h-7 rounded border bg-background px-2 text-xs" />
          </label>
          <Button size="sm" class="h-7 text-xs" :disabled="loading" @click="fetchAll">{{ loading ? '读取中…' : '查询' }}</Button>
        </div>
        <div v-if="summary" class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div data-testid="stats-total" class="rounded border p-2">
            <div class="text-[11px] text-muted-foreground">总数</div>
            <div class="text-lg font-semibold">{{ summary.total }}</div>
          </div>
          <div data-testid="stats-succeeded" class="rounded border p-2">
            <div class="text-[11px] text-muted-foreground">成功</div>
            <div class="text-lg font-semibold text-green-600">{{ summary.succeeded }}</div>
          </div>
          <div data-testid="stats-rate" class="rounded border p-2">
            <div class="text-[11px] text-muted-foreground">成功率</div>
            <div class="text-lg font-semibold">{{ successRate }}</div>
          </div>
          <div data-testid="stats-pixels" class="rounded border p-2">
            <div class="text-[11px] text-muted-foreground">像素总量 · 平均耗时</div>
            <div class="text-lg font-semibold">{{ formatPixels(summary.pixels) }}</div>
            <div class="text-[11px] text-muted-foreground">{{ (summary.avgElapsedMs / 1000).toFixed(1) }}s 平均</div>
          </div>
        </div>
        <div v-else class="mt-3 rounded border p-4 text-center text-xs text-muted-foreground">
          {{ loading ? '读取中…' : '暂无数据 — 成功/失败一次生成后会记账' }}
        </div>
        <h5 class="mt-4 text-xs font-semibold">按天</h5>
        <div data-testid="stats-daily" class="mt-1 max-h-40 overflow-auto rounded border">
          <table class="w-full text-xs">
            <thead class="sticky top-0 bg-muted">
              <tr><th class="px-2 py-1 text-left">日期</th><th class="px-2 py-1 text-right">总数</th><th class="px-2 py-1 text-right">成功</th><th class="px-2 py-1 text-right">像素</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in daily" :key="r.day" class="border-t">
                <td class="px-2 py-1 font-mono">{{ r.day }}</td>
                <td class="px-2 py-1 text-right">{{ r.total }}</td>
                <td class="px-2 py-1 text-right">{{ r.succeeded }}</td>
                <td class="px-2 py-1 text-right font-mono">{{ formatPixels(r.pixels) }}</td>
              </tr>
              <tr v-if="!daily.length"><td colspan="4" class="px-2 py-3 text-center text-muted-foreground">所选区间暂无数据</td></tr>
            </tbody>
          </table>
        </div>
        <h5 class="mt-4 text-xs font-semibold">按小时（{{ focusDay }}）</h5>
        <div data-testid="stats-hourly" class="mt-1 flex h-24 items-end gap-1 rounded border p-2">
          <div
            v-for="h in hourly"
            :key="h.hour"
            :data-testid="`stats-hour-${h.hour}`"
            :title="`${h.hour}时：${h.total} 次 / 成功 ${h.succeeded}`"
            class="flex-1 rounded-t bg-primary/70"
            :style="{ height: `${Math.max(4, Math.round((h.total / maxHour) * 100))}%`, opacity: h.total ? 1 : 0.15 }"
          />
        </div>
        <div class="mt-1 flex gap-1 text-[10px] text-muted-foreground">
          <span v-for="h in hourly" :key="`l-${h.hour}`" class="flex-1 text-center">{{ h.hour % 3 === 0 ? h.hour : '' }}</span>
        </div>
      </Card>
    </div>
  </Teleport>
</template>
