<script setup lang="ts">
import { ref, computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/composables/useToast'
import { useImageQueueStore } from '@/stores/imageQueue'
import {
  IQ_CONCURRENCY_OPTIONS,
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

function onConcurrencySelect(e: Event): void {
  const v = (e.target as HTMLSelectElement).value
  if (v === 'custom') {
    customConcurrency.value = true
    concurrencyCustom.value = iq.config.concurrency
  } else {
    iq.config.concurrency = parseInt(v, 10)
    iq.markDirty()
  }
}

function onResetApiBase(): void {
  iq.config.apiBase = IQ_DEFAULT_API_BASE
  iq.markDirty()
}
</script>

<template>
  <section data-testid="image-queue-settings" class="flex flex-col gap-3 px-3 py-2">
    <div v-if="iq.dirty" class="rounded border border-amber-500/30 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
      配置未保存
    </div>

    <!-- 连接组 -->
    <div class="flex flex-col gap-2">
      <h3 class="text-xs font-semibold text-muted-foreground">连接</h3>
      <label class="flex items-center gap-2 text-xs">
        <span class="w-20 shrink-0 text-muted-foreground">协议</span>
        <select
          data-testid="iq-protocol"
          class="h-7 flex-1 rounded-md border bg-background px-2 text-xs"
          :value="iq.config.protocol"
          @change="iq.config.protocol = ($event.target as HTMLSelectElement).value as 'agnes'; iq.markDirty()"
        >
          <option v-for="p in IQ_PROTOCOLS" :key="p.value" :value="p.value">{{ p.label }}</option>
        </select>
        <span class="text-[11px] text-muted-foreground">文生图 / 2.5 Flash</span>
      </label>
      <label class="flex items-center gap-2 text-xs">
        <input
          data-testid="iq-loop"
          type="checkbox"
          class="h-3.5 w-3.5 accent-primary"
          :checked="iq.config.loopEnabled"
          @change="iq.config.loopEnabled = ($event.target as HTMLInputElement).checked; iq.markDirty()"
        />
        <span>循环生成</span>
        <span class="text-[11px] text-muted-foreground">队列见底自动补货</span>
      </label>
      <label class="flex items-center gap-2 text-xs">
        <input
          data-testid="iq-auto-random-on-start"
          type="checkbox"
          class="h-3.5 w-3.5 accent-primary"
          :checked="iq.config.autoRandomOnStart"
          @change="iq.config.autoRandomOnStart = ($event.target as HTMLInputElement).checked; iq.markDirty()"
        />
        <span>自动随机新的提示词来生图</span>
        <span class="text-[11px] text-muted-foreground">开始前备料（数量取并发数）</span>
      </label>
      <label class="flex items-center gap-2 text-xs">
        <span class="w-20 shrink-0 text-muted-foreground">API 路径</span>
        <Input
          data-testid="iq-api-base"
          class="h-7 flex-1 text-xs"
          :model-value="iq.config.apiBase"
          @update:model-value="iq.config.apiBase = String($event); iq.markDirty()"
          @blur="onApiBaseBlur"
        />
        <Button size="sm" variant="ghost" class="h-7 px-2 text-xs" title="重置默认" @click="onResetApiBase">重置</Button>
      </label>
      <div class="flex items-center gap-2 text-xs">
        <span class="w-20 shrink-0 text-muted-foreground">API 密钥</span>
        <div class="relative flex-1">
          <Input
            data-testid="iq-api-key"
            class="h-7 w-full pr-8 text-xs"
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
      <div class="flex items-center justify-between text-xs">
        <span v-if="iq.config.apiKeyState === 'set'" class="text-[11px] text-green-600"
          >已设置{{ iq.config.apiKeyMasked ? ` ${iq.config.apiKeyMasked}` : '' }}</span
        >
        <span v-else class="text-[11px] text-muted-foreground">未设置</span>
        <label class="flex items-center gap-1">
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

    <!-- 画面组 -->
    <div class="flex flex-col gap-2">
      <h3 class="text-xs font-semibold text-muted-foreground">画面</h3>
      <label class="flex items-center gap-2 text-xs">
        <span class="w-20 shrink-0 text-muted-foreground">生图输出路径</span>
        <Input
          data-testid="iq-output-dir"
          class="h-7 flex-1 text-xs"
          :placeholder="IQ_DEFAULT_OUTPUT_HINT"
          :model-value="iq.config.outputDir"
          @update:model-value="iq.config.outputDir = String($event); iq.markDirty()"
        />
        <Button data-testid="iq-output-browse" size="sm" variant="outline" class="h-7 px-2 text-xs" @click="onBrowseOutput">浏览</Button>
      </label>
      <label class="flex items-center gap-2 text-xs">
        <span class="w-20 shrink-0 text-muted-foreground">生图分辨率</span>
        <select
          data-testid="iq-size"
          class="h-7 flex-1 rounded-md border bg-background px-2 text-xs"
          :value="iq.config.size"
          @change="iq.config.size = ($event.target as HTMLSelectElement).value; iq.markDirty()"
        >
          <option v-for="s in IQ_SIZES" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
      <label class="flex items-center gap-2 text-xs">
        <span class="w-20 shrink-0 text-muted-foreground">生图比例</span>
        <select
          data-testid="iq-ratio"
          class="h-7 flex-1 rounded-md border bg-background px-2 text-xs"
          :value="iq.config.ratio"
          @change="iq.config.ratio = ($event.target as HTMLSelectElement).value; iq.markDirty()"
        >
          <option v-for="r in IQ_RATIOS" :key="r" :value="r">{{ r }}</option>
        </select>
      </label>
      <div class="pl-24 text-[11px] text-muted-foreground">
        当前 {{ iq.config.size }} {{ iq.config.ratio }} ≈ {{ pixelHint }}（{{ pixelTable }}）
      </div>
    </div>

    <!-- 运行组 -->
    <div class="flex flex-col gap-2">
      <h3 class="text-xs font-semibold text-muted-foreground">运行</h3>
      <div class="flex items-center gap-2 text-xs">
        <span class="w-20 shrink-0 text-muted-foreground">并发数量</span>
        <select
          v-if="!customConcurrency"
          data-testid="iq-concurrency"
          class="h-7 flex-1 rounded-md border bg-background px-2 text-xs"
          :value="String(iq.config.concurrency)"
          @change="onConcurrencySelect($event)"
        >
          <option v-for="n in IQ_CONCURRENCY_OPTIONS" :key="n" :value="String(n)">{{ n }}</option>
          <option value="custom">自定义…</option>
        </select>
        <input
          v-else
          data-testid="iq-concurrency-custom"
          type="number"
          min="1"
          max="8"
          step="1"
          class="h-7 flex-1 rounded-md border bg-background px-2 text-xs"
          :value="concurrencyCustom"
          @input="concurrencyCustom = Math.min(8, Math.max(1, Math.round(parseInt(($event.target as HTMLInputElement).value, 10) || 1))); iq.config.concurrency = concurrencyCustom; iq.markDirty()"
        />
      </div>
      <div v-if="iq.config.size === '4K' && iq.config.concurrency > 2" class="pl-24 text-[11px] text-amber-600">
        4K 建议 ≤2
      </div>
      <label class="flex items-center gap-2 text-xs">
        <span class="w-20 shrink-0 text-muted-foreground">连接超时（秒）</span>
        <input
          data-testid="iq-connect-timeout"
          type="number"
          min="5"
          max="60"
          step="1"
          class="h-7 flex-1 rounded-md border bg-background px-2 text-xs"
          :value="iq.config.connectTimeoutSecs"
          @input="iq.config.connectTimeoutSecs = Math.min(60, Math.max(5, Math.round(Number(($event.target as HTMLInputElement).value) || 15))); iq.markDirty()"
        />
        <span class="text-[11px] text-muted-foreground">5..60</span>
      </label>
      <label class="flex items-center gap-2 text-xs">
        <span class="w-20 shrink-0 text-muted-foreground">总超时（秒）</span>
        <input
          data-testid="iq-total-timeout"
          type="number"
          min="60"
          max="600"
          step="1"
          class="h-7 flex-1 rounded-md border bg-background px-2 text-xs"
          :value="iq.config.totalTimeoutSecs"
          @input="iq.config.totalTimeoutSecs = Math.min(600, Math.max(60, Math.round(Number(($event.target as HTMLInputElement).value) || 300))); iq.markDirty()"
        />
        <span class="text-[11px] text-muted-foreground">60..600</span>
      </label>
    </div>

    <!-- 网络组 -->
    <div class="flex flex-col gap-2">
      <h3 class="text-xs font-semibold text-muted-foreground">网络</h3>
      <label class="flex items-center gap-2 text-xs">
        <input
          data-testid="iq-proxy-on"
          type="checkbox"
          class="h-3.5 w-3.5 accent-primary"
          :checked="iq.config.proxyOn"
          @change="iq.config.proxyOn = ($event.target as HTMLInputElement).checked; iq.markDirty()"
        />
        <span>网络代理启用</span>
      </label>
      <label class="flex items-center gap-2 text-xs">
        <span class="w-20 shrink-0 text-muted-foreground">网络代理地址</span>
        <Input
          data-testid="iq-proxy-url"
          class="h-7 flex-1 text-xs"
          :placeholder="proxyPlaceholder"
          :model-value="iq.config.proxyUrl"
          @update:model-value="iq.config.proxyUrl = String($event); iq.markProxyTouched()"
          @focus="onProxyFocus"
        />
      </label>
      <div v-if="!iq.proxyTouched && iq.config.proxyUrlState === 'set'" class="pl-24 text-[11px] text-green-600">
        已设置（为保密不回显，聚焦即清空待重输；直接保存即保持原值）
      </div>
      <div v-if="socksWarning" class="pl-24 text-[11px] text-red-600">本期仅支持 http/https</div>
    </div>

    <!-- 操作行 -->
    <div class="flex flex-wrap items-center gap-2">
      <Button data-testid="iq-save" size="sm" class="h-7 text-xs" @click="onSave">保存</Button>
      <Button
        data-testid="iq-test"
        size="sm"
        variant="outline"
        class="h-7 text-xs"
        :disabled="iq.testing"
        @click="onTest"
        >{{ iq.testing ? '测试中…（最长 60s）' : '测试连接' }}</Button
      >
      <Button
        v-if="iq.testing"
        size="sm"
        variant="ghost"
        class="h-7 text-xs"
        @click="onCancelTest"
        >取消</Button
      >
      <Button data-testid="iq-reset-default" size="sm" variant="ghost" class="h-7 text-xs" @click="onResetDefault">恢复默认</Button>
    </div>
    <div v-if="iq.testResult" class="text-[11px]" :class="iq.testResult.ok ? 'text-green-600' : 'text-red-600'">
      {{ iq.testResult.message }}
    </div>
  </section>
</template>
