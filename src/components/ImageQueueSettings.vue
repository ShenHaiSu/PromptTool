<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/composables/useToast'
import { useImageQueueStore } from '@/stores/imageQueue'
 import { useAssemblyStore } from '@/stores/assembly'
import { iqGetResolvedOutputDir, pathGetBases } from '@/lib/imageQueueApi'
import {
  IQ_DEFAULT_API_BASE,
  IQ_DEFAULT_OUTPUT_HINT,
  IQ_PIXELS,
  IQ_PROTOCOLS,
  IQ_RATIOS,
  IQ_SIZES,
  iqPixelHint,
  trimTrailingSlash,
} from '@/lib/imageQueue'

const iq = useImageQueueStore()
const { push } = useToast()

const showKey = ref(false)
const customConcurrency = ref(false)
const concurrencyCustom = ref(iq.config.concurrency)

const pixelHint = computed(() => iqPixelHint(iq.config.size, iq.config.ratio))
const pixelTable = computed(() => {
  const row = IQ_PIXELS[iq.config.ratio] ?? {}
  return (IQ_SIZES as readonly string[]).map((s) => `${s} ${row[s] ?? '?'}`).join(' · ')
})
const socksWarning = computed(() => /^socks5:\/\//i.test(iq.config.proxyUrl.trim()))
 const assembly = useAssemblyStore()
 const anchorCount = computed(() => assembly.selectedItems.length)
const keyPlaceholder = computed(() => {
  // S2 脱敏回显：占位态直接展示后端脱敏串，明文永不进输入框；聚焦即清空待重输。
  if (!iq.keyTouched && iq.config.apiKeyState === 'set') {
    return iq.config.apiKeyMasked
      ? `${iq.config.apiKeyMasked}（已设置，聚焦即清空待重输）`
      : '已设置（聚焦即清空待重输）'
  }
  return 'sk-…'
})
const proxyPlaceholder = computed(() =>
  !iq.proxyTouched && iq.config.proxyUrlState === 'set'
    ? '已设置（为保密不回显），聚焦即清空待重输'
    : 'http://127.0.0.1:10808',
)

function onApiBaseBlur(): void {
  iq.config.apiBase = trimTrailingSlash(iq.config.apiBase.trim())
  iq.markDirty()
}

function onKeyFocus(): void {
  // 已设置占位聚焦即清空待重输
  if (!iq.keyTouched && iq.config.apiKeyState === 'set') iq.config.apiKey = ''
}

function onProxyFocus(): void {
  // 代理与密钥对称：已设置占位聚焦即清空待重输
  if (!iq.proxyTouched && iq.config.proxyUrlState === 'set') iq.config.proxyUrl = ''
}

async function onBrowseOutput(): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const dir = await open({ directory: true, multiple: false })
    if (typeof dir === 'string' && dir) {
      iq.config.outputDir = dir
      iq.markDirty()
    }
  } catch (err) {
    push(`选择目录失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}

async function onSave(): Promise<void> {
  await iq.saveConfig()
}

async function onTest(): Promise<void> {
  await iq.testConnection()
}

function onCancelTest(): void {
  iq.cancelTest()
}

function onResetDefault(): void {
  if (!window.confirm('恢复默认配置（不清除已记住的密钥）？')) return
  iq.resetDefaults()
}

function setSize(v: string): void {
  if (iq.config.size === v) return
  iq.config.size = v
  iq.markDirty()
}

function setRatio(v: string): void {
  if (iq.config.ratio === v) return
  iq.config.ratio = v
  iq.markDirty()
}

function stepConcurrency(delta: number): void {
  const next = Math.min(8, Math.max(1, iq.config.concurrency + delta))
  if (next === iq.config.concurrency) return
  iq.config.concurrency = next
  concurrencyCustom.value = next
  iq.markDirty()
}

function enterCustomConcurrency(): void {
  customConcurrency.value = true
  concurrencyCustom.value = iq.config.concurrency
}

function exitCustomConcurrency(): void {
  customConcurrency.value = false
}

function onResetApiBase(): void {
  iq.config.apiBase = IQ_DEFAULT_API_BASE
  iq.markDirty()
}
// need07：输出目录 placeholder 显示后端解析值；老默认保留时给 hint
const resolvedOutputDir = ref('')
const legacyKeptHint = ref('')
onMounted(async () => {
  try {
    const [dir, bases] = await Promise.all([iqGetResolvedOutputDir(), pathGetBases()])
    resolvedOutputDir.value = dir
    const norm = (s: string): string => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    if (!iq.config.outputDir.trim() && norm(dir) === norm(`${bases.activeData}/output/images`)) {
      legacyKeptHint.value = `旧默认位置（已保留）：${dir}`
    }
  } catch { /* 降级：静态 hint */ }
})
</script>

<template>
  <section data-testid="image-queue-settings" class="flex flex-col gap-2 px-3 py-2">
    <!-- 吸顶操作条：标题 + 脏态 + 保存/测试常驻 -->
    <div class="sticky top-0 z-10 -mx-3 -mt-2 flex items-center gap-2 border-b bg-background/95 px-3 py-1.5 backdrop-blur">
      <span class="text-xs font-semibold">生图配置</span>
      <span
        v-if="iq.dirty"
        class="rounded-full border border-amber-500/30 bg-amber-50 px-1.5 text-[11px] leading-4 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        >●未保存</span
      >
      <span v-else class="text-[11px] leading-4 text-muted-foreground">已保存</span>
      <div class="ml-auto flex items-center gap-1.5">
        <Button
          data-testid="iq-test"
          size="sm"
          variant="outline"
          class="h-7 text-xs"
          :disabled="iq.testing"
          @click="onTest"
          >{{ iq.testing ? '测试中…' : '测试连接' }}</Button
        >
        <Button
          v-if="iq.testing"
          size="sm"
          variant="ghost"
          class="h-7 px-2 text-xs"
          @click="onCancelTest"
          >取消</Button
        >
        <Button data-testid="iq-save" size="sm" class="h-7 text-xs" @click="onSave">保存</Button>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-2 min-[560px]:grid-cols-2">
      <!-- 画面卡：分辨率分段 + 比例芯片 + 输出路径 -->
      <div class="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-2.5 min-[560px]:col-span-2">
        <div class="flex min-w-0 items-center gap-2">
          <h3 class="text-xs font-semibold text-muted-foreground">画面</h3>
          <span
            class="ml-auto truncate text-[11px] text-muted-foreground"
            :title="`${iq.config.size} ${iq.config.ratio} ≈ ${pixelHint}（${pixelTable}）`"
          >
            {{ iq.config.size }} {{ iq.config.ratio }} ≈ {{ pixelHint }}
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5 text-xs">
          <span class="shrink-0 text-muted-foreground">分辨率</span>
          <div data-testid="iq-size" role="radiogroup" aria-label="生图分辨率" class="flex flex-wrap items-center gap-1">
            <button
              v-for="s in IQ_SIZES"
              :key="s"
              type="button"
              :aria-pressed="iq.config.size === s"
              class="h-6 rounded-md border px-2 text-xs"
              :class="iq.config.size === s ? 'border-primary bg-primary/10 font-semibold text-primary' : 'bg-background text-muted-foreground hover:text-foreground'"
              @click="setSize(s)"
            >{{ s }}</button>
          </div>
          <span class="ml-1 shrink-0 text-muted-foreground">比例</span>
          <div data-testid="iq-ratio" role="radiogroup" aria-label="生图比例" class="flex flex-wrap items-center gap-1">
            <button
              v-for="r in IQ_RATIOS"
              :key="r"
              type="button"
              :aria-pressed="iq.config.ratio === r"
              class="h-6 rounded-md border px-1.5 text-xs"
              :class="iq.config.ratio === r ? 'border-primary bg-primary/10 font-semibold text-primary' : 'bg-background text-muted-foreground hover:text-foreground'"
              @click="setRatio(r)"
            >{{ r }}</button>
          </div>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <span class="shrink-0 text-muted-foreground">输出</span>
          <Input
            data-testid="iq-output-dir"
            class="h-7 flex-1 text-xs"
            :placeholder="resolvedOutputDir || IQ_DEFAULT_OUTPUT_HINT"
            :model-value="iq.config.outputDir"
            @update:model-value="iq.config.outputDir = String($event); iq.markDirty()"
          />
          <Button data-testid="iq-output-browse" size="sm" variant="outline" class="h-7 shrink-0 px-2 text-xs" @click="onBrowseOutput">浏览</Button>
        </div>
        <div v-if="legacyKeptHint" class="truncate text-[11px] text-muted-foreground" :title="legacyKeptHint">{{ legacyKeptHint }}</div>
      </div>

      <!-- 运行卡 -->
      <div class="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-2.5">
        <div class="flex items-center gap-2">
          <h3 class="text-xs font-semibold text-muted-foreground">运行</h3>
          <span
            v-if="iq.config.size === '4K' && iq.config.concurrency > 2"
            title="4K 建议并发 ≤2"
            class="ml-auto text-[11px] text-amber-600"
            >⚠ 4K 建议 ≤2</span
          >
        </div>
        <div class="flex items-center gap-1.5 text-xs">
          <span class="shrink-0 text-muted-foreground">并发</span>
          <div v-if="!customConcurrency" data-testid="iq-concurrency" class="flex items-center gap-1">
            <button type="button" class="h-6 w-6 rounded-md border bg-background text-xs" title="减少并发" @click="stepConcurrency(-1)">−</button>
            <span class="w-5 text-center text-xs font-semibold">{{ iq.config.concurrency }}</span>
            <button type="button" class="h-6 w-6 rounded-md border bg-background text-xs" title="增加并发" @click="stepConcurrency(1)">+</button>
            <button type="button" class="ml-1 h-6 px-1 text-[11px] text-primary" title="输入 1..8 自定义并发" @click="enterCustomConcurrency">自定义</button>
          </div>
          <div v-else class="flex flex-1 items-center gap-1">
            <input
              data-testid="iq-concurrency-custom"
              type="number"
              min="1"
              max="8"
              step="1"
              class="h-6 w-full min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
              :value="concurrencyCustom"
              @input="concurrencyCustom = Math.min(8, Math.max(1, Math.round(parseInt(($event.target as HTMLInputElement).value, 10) || 1))); iq.config.concurrency = concurrencyCustom; iq.markDirty()"
            />
            <button type="button" class="h-6 shrink-0 px-1 text-[11px] text-primary" title="返回步进器" @click="exitCustomConcurrency">预设</button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-1.5 text-xs">
          <label class="flex min-w-0 items-center gap-1">
            <span class="shrink-0 text-muted-foreground">连接</span>
            <input
              data-testid="iq-connect-timeout"
              type="number"
              min="5"
              max="60"
              step="1"
              title="连接超时 5..60 秒"
              class="h-6 w-full min-w-0 rounded-md border bg-background px-1.5 text-xs"
              :value="iq.config.connectTimeoutSecs"
              @input="iq.config.connectTimeoutSecs = Math.min(60, Math.max(5, Math.round(Number(($event.target as HTMLInputElement).value) || 15))); iq.markDirty()"
            />
            <span class="shrink-0 text-[11px] text-muted-foreground">s</span>
          </label>
          <label class="flex min-w-0 items-center gap-1">
            <span class="shrink-0 text-muted-foreground">总计</span>
            <input
              data-testid="iq-total-timeout"
              type="number"
              min="60"
              max="600"
              step="1"
              title="总超时 60..600 秒"
              class="h-6 w-full min-w-0 rounded-md border bg-background px-1.5 text-xs"
              :value="iq.config.totalTimeoutSecs"
              @input="iq.config.totalTimeoutSecs = Math.min(600, Math.max(60, Math.round(Number(($event.target as HTMLInputElement).value) || 300))); iq.markDirty()"
            />
            <span class="shrink-0 text-[11px] text-muted-foreground">s</span>
          </label>
        </div>
        <div class="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
          <label class="flex min-w-0 items-center gap-1.5" title="队列见底自动补货">
            <input
              data-testid="iq-loop"
              type="checkbox"
              class="h-3.5 w-3.5 shrink-0 accent-primary"
              :checked="iq.config.loopEnabled"
              @change="iq.config.loopEnabled = ($event.target as HTMLInputElement).checked; iq.markDirty()"
            />
            <span class="truncate">循环生成</span>
          </label>
          <label class="flex min-w-0 items-center gap-1.5" title="开始前备料（数量取并发数）">
            <input
              data-testid="iq-auto-random-on-start"
              type="checkbox"
              class="h-3.5 w-3.5 shrink-0 accent-primary"
              :checked="iq.config.autoRandomOnStart"
              @change="iq.config.autoRandomOnStart = ($event.target as HTMLInputElement).checked; iq.markDirty()"
            />
            <span class="truncate">自动备料</span>
          </label>
           <label class="flex min-w-0 items-center gap-1.5" title="以画布已选项为锚点，仅随机缺口维度；画布为空时按纯随机降级">
             <input
               data-testid="iq-loop-partial"
               type="checkbox"
               class="h-3.5 w-3.5 shrink-0 accent-primary"
               :checked="iq.config.loopUsePartial"
               @change="iq.config.loopUsePartial = ($event.target as HTMLInputElement).checked; iq.markDirty()"
             />
             <span class="truncate">可控随机</span>
           </label>
           <label class="flex min-w-0 items-center gap-1.5" title="队列随机是否包含 NSFW 条目">
             <input
               data-testid="iq-loop-nsfw"
               type="checkbox"
               class="h-3.5 w-3.5 shrink-0 accent-primary"
               :checked="iq.config.loopAllowNsfw"
               @change="iq.config.loopAllowNsfw = ($event.target as HTMLInputElement).checked; iq.markDirty()"
             />
             <span class="truncate">含NSFW</span>
           </label>
           <div v-if="iq.config.loopUsePartial && anchorCount === 0" class="col-span-2 text-[11px] text-amber-600">可控已开但画布为空，将按纯随机补货</div>
          <label class="col-span-2 flex min-w-0 items-center gap-1.5" title="关即纯原图">
            <input
              data-testid="iq-embed-meta"
              type="checkbox"
              class="h-3.5 w-3.5 shrink-0 accent-primary"
              :checked="iq.config.embedMeta"
              @change="iq.config.embedMeta = ($event.target as HTMLInputElement).checked; iq.markDirty()"
            />
            <span class="truncate">图片内嵌参数<span class="text-muted-foreground">（关即纯原图）</span></span>
          </label>
        </div>
      </div>

      <!-- 接入卡 -->
      <div class="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-2.5">
        <div class="flex items-center gap-2">
          <h3 class="text-xs font-semibold text-muted-foreground">接入</h3>
          <span
            class="ml-auto rounded-full border px-1.5 text-[11px] leading-4 text-muted-foreground"
            :title="`协议：${IQ_PROTOCOLS[0]?.label ?? ''}（当前仅支持该协议）`"
            >{{ IQ_PROTOCOLS[0]?.label ?? 'Agnes' }}</span
          >
          <!-- 协议单选项：保留原生控件语义（隐藏），避免自动化/逻辑回归 -->
          <select
            data-testid="iq-protocol"
            class="sr-only"
            tabindex="-1"
            aria-hidden="true"
            :value="iq.config.protocol"
            @change="iq.config.protocol = ($event.target as HTMLSelectElement).value as 'agnes'; iq.markDirty()"
          >
            <option v-for="p in IQ_PROTOCOLS" :key="p.value" :value="p.value">{{ p.label }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <span class="shrink-0 text-muted-foreground">路径</span>
          <Input
            data-testid="iq-api-base"
            class="h-6 flex-1 text-xs"
            :model-value="iq.config.apiBase"
            @update:model-value="iq.config.apiBase = String($event); iq.markDirty()"
            @blur="onApiBaseBlur"
          />
          <Button size="sm" variant="ghost" class="h-6 shrink-0 px-1.5 text-[11px]" title="重置默认" @click="onResetApiBase">重置</Button>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <span class="shrink-0 text-muted-foreground">密钥</span>
          <div class="relative min-w-0 flex-1">
            <Input
              data-testid="iq-api-key"
              class="h-6 w-full pr-7 text-xs"
              :type="showKey ? 'text' : 'password'"
              :model-value="iq.config.apiKey"
              :placeholder="keyPlaceholder"
              @update:model-value="iq.config.apiKey = String($event); iq.markKeyTouched()"
              @focus="onKeyFocus"
            />
            <button
              class="absolute right-1 top-1/2 -translate-y-1/2 px-1 text-xs text-muted-foreground"
              title="显示/隐藏本次输入（已设置的密钥仅显示脱敏串）"
              @click="showKey = !showKey"
            >
              {{ showKey ? '🙈' : '👁' }}
            </button>
          </div>
        </div>
        <div class="flex items-center gap-2 text-[11px]">
          <span v-if="iq.config.apiKeyState === 'set'" class="truncate text-green-600"
            >●已设置{{ iq.config.apiKeyMasked ? ` ${iq.config.apiKeyMasked}` : '' }}</span
          >
          <span v-else class="text-muted-foreground">○未设置</span>
          <label class="ml-auto flex shrink-0 items-center gap-1 text-xs">
            <input
              data-testid="iq-remember-key"
              type="checkbox"
              class="h-3.5 w-3.5 accent-primary"
              :checked="iq.config.rememberKey"
              @change="iq.config.rememberKey = ($event.target as HTMLInputElement).checked; iq.markDirty()"
            />
            <span>记住密钥</span>
          </label>
        </div>
      </div>

      <!-- 网络卡：折叠紧凑，整行跨两列 -->
      <div class="flex flex-col gap-1 rounded-lg border bg-muted/30 p-2.5 min-[560px]:col-span-2">
        <div class="flex items-center gap-2 text-xs">
          <h3 class="text-xs font-semibold text-muted-foreground">网络</h3>
          <label class="flex items-center gap-1.5">
            <input
              data-testid="iq-proxy-on"
              type="checkbox"
              class="h-3.5 w-3.5 accent-primary"
              :checked="iq.config.proxyOn"
              @change="iq.config.proxyOn = ($event.target as HTMLInputElement).checked; iq.markDirty()"
            />
            <span>代理启用</span>
          </label>
          <Input
            data-testid="iq-proxy-url"
            class="h-6 flex-1 text-xs"
            :disabled="!iq.config.proxyOn"
            :placeholder="proxyPlaceholder"
            :model-value="iq.config.proxyUrl"
            @update:model-value="iq.config.proxyUrl = String($event); iq.markProxyTouched()"
            @focus="onProxyFocus"
          />
        </div>
        <div v-if="!iq.proxyTouched && iq.config.proxyUrlState === 'set'" class="text-[11px] text-green-600">
          已设置（为保密不回显，聚焦即清空待重输；直接保存即保持原值）
        </div>
        <div v-if="socksWarning" class="text-[11px] text-red-600">本期仅支持 http/https</div>
      </div>
    </div>

    <!-- 底栏：恢复默认 + 测试结果（保存/测试已上移吸顶） -->
    <div class="flex flex-wrap items-center gap-2">
      <Button data-testid="iq-reset-default" size="sm" variant="ghost" class="h-6 px-2 text-[11px]" @click="onResetDefault">恢复默认</Button>
      <span v-if="iq.testResult" class="text-[11px]" :class="iq.testResult.ok ? 'text-green-600' : 'text-red-600'">
        {{ iq.testResult.message }}
      </span>
    </div>
  </section>
</template>
