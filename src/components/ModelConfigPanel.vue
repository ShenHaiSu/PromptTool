<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/composables/useToast'
import { useConnectionProfileStore } from '@/stores/connectionProfile'
import { DEFAULT_MODEL, SUPPORTED_MODELS } from '@/lib/connectionProfile'
import { IQ_DEFAULT_API_BASE, trimTrailingSlash } from '@/lib/imageQueue'
import { modelTestConnection, type IqTestResult } from '@/lib/imageQueueApi'

const conn = useConnectionProfileStore()
const { push } = useToast()

const showKey = ref(false)
const dirty = ref(false)
const testing = ref(false)
const testResult = ref<string | null>(null)

const keyPlaceholder = computed(() => {
  if (!conn.keyTouched && conn.profile.apiKeyState === 'set') {
    return conn.profile.apiKeyMasked
      ? `${conn.profile.apiKeyMasked}（已设置，聚焦即清空待重输）`
      : '已设置（聚焦即清空待重输）'
  }
  return 'sk-…'
})
const proxyPlaceholder = computed(() =>
  !conn.proxyTouched && conn.profile.proxyUrlState === 'set'
    ? '已设置（为保密不回显），聚焦即清空待重输'
    : 'http://127.0.0.1:10808',
)
const socksWarning = computed(() => /^socks5:\/\//i.test(conn.profile.proxyUrl.trim()))

function markDirty(): void {
  dirty.value = true
}

function onApiBaseBlur(): void {
  conn.profile.apiBase = trimTrailingSlash(conn.profile.apiBase.trim())
  markDirty()
}

function onKeyInput(v: string): void {
  conn.profile.apiKey = v
  conn.markKeyTouched()
  markDirty()
}

function onKeyFocus(): void {
  if (!conn.keyTouched && conn.profile.apiKeyState === 'set') conn.profile.apiKey = ''
}

function onProxyInput(v: string): void {
  conn.profile.proxyUrl = v
  conn.markProxyTouched()
  markDirty()
}

function onProxyFocus(): void {
  if (!conn.proxyTouched && conn.profile.proxyUrlState === 'set') conn.profile.proxyUrl = ''
}

function onResetApiBase(): void {
  conn.profile.apiBase = IQ_DEFAULT_API_BASE
  markDirty()
}

async function onSave(): Promise<void> {
  const ok = await conn.saveConnection()
  if (ok) dirty.value = false
}

async function onCancel(): Promise<void> {
  if (dirty.value && !window.confirm('模型配置未保存，确定放弃修改？')) return
  await conn.loadModel()
  dirty.value = false
}

function onResetDefault(): void {
  if (!window.confirm('恢复默认配置（不清除已记住的密钥）？')) return
  const keepKeyState = conn.profile.apiKeyState
  const keepMasked = conn.profile.apiKeyMasked
  const keepProxyState = conn.profile.proxyUrlState
  conn.profile.apiBase = IQ_DEFAULT_API_BASE
  conn.profile.model = DEFAULT_MODEL
  conn.profile.protocol = 'agnes'
  conn.profile.proxyOn = false
  conn.profile.connectTimeoutSecs = 15
  conn.profile.totalTimeoutSecs = 300
  conn.profile.apiKeyState = keepKeyState
  conn.profile.apiKeyMasked = keepMasked
  conn.profile.proxyUrlState = keepProxyState
  markDirty()
}

function translateStage(r: IqTestResult): string {
  if (r.ok) {
    const secs = r.elapsedMs != null ? (r.elapsedMs / 1000).toFixed(1) : '?'
    return `连接正常（1K/1:1，${secs}s）`
  }
  switch (r.stage) {
    case 'auth':
      return '密钥无效，请检查 API 密钥'
    case 'connect':
    case 'dns':
      return '连不上，先看代理开关/地址'
    case 'parse':
      return '网关返回异常，请稍后重试'
    default:
      return r.message ? `测试失败：${r.message}` : '测试失败'
  }
}

async function onTest(): Promise<void> {
  if (testing.value) return
  testing.value = true
  testResult.value = null
  try {
    const r = await modelTestConnection()
    testResult.value = translateStage(r)
    push(testResult.value, r.ok ? 'success' : 'error')
  } catch (err) {
    testResult.value = `测试失败：${err instanceof Error ? err.message : String(err)}`
    push(testResult.value, 'error')
  } finally {
    testing.value = false
  }
}

onMounted(async () => {
  if (!conn.loaded) {
    try {
      await conn.loadModel()
    } catch { /* 降级：默认值 */ }
  }
})

defineExpose({ isDirty: () => dirty.value })
</script>

<template>
  <section data-testid="model-config-panel" class="flex flex-col gap-2 px-3 py-2">
    <!-- 吸顶操作条：标题 + 脏态 + 保存/测试常驻 -->
    <div class="sticky top-0 z-10 -mx-3 -mt-2 flex items-center gap-2 border-b bg-background/95 px-3 py-1.5 backdrop-blur">
      <span class="text-xs font-semibold">模型配置</span>
      <span
        v-if="dirty"
        class="rounded-full border border-amber-500/30 bg-amber-50 px-1.5 text-[11px] leading-4 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
      >●未保存</span>
      <span v-else class="text-[11px] leading-4 text-muted-foreground">已保存</span>
      <div class="ml-auto flex items-center gap-1.5">
        <Button
          data-testid="model-test"
          size="sm"
          variant="outline"
          class="h-7 text-xs"
          :disabled="testing"
          @click="onTest"
        >{{ testing ? '测试中…' : '测试连接' }}</Button>
        <Button data-testid="model-save" size="sm" class="h-7 text-xs" @click="onSave">保存</Button>
        <Button size="sm" variant="ghost" class="h-7 px-2 text-xs" @click="onCancel">取消</Button>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-2 min-[560px]:grid-cols-2">
      <!-- 接入卡（唯一可写） -->
      <div class="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-2.5">
        <div class="flex items-center gap-2">
          <h3 class="text-xs font-semibold text-muted-foreground">接入</h3>
          <span
            data-testid="model-protocol"
            class="ml-auto rounded-full border px-1.5 text-[11px] leading-4 text-muted-foreground"
            title="协议：Agnes（Image 2.5 Flash）（当前仅支持该协议）"
          >Agnes（Image 2.5 Flash）</span>
          <!-- 协议单选项：保留原生控件语义（隐藏），避免自动化/逻辑回归 -->
          <select
            class="sr-only"
            tabindex="-1"
            aria-hidden="true"
            :value="conn.profile.protocol"
            @change="conn.profile.protocol = ($event.target as HTMLSelectElement).value as 'agnes'; markDirty()"
          >
            <option value="agnes">Agnes（Image 2.5 Flash）</option>
          </select>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <span class="shrink-0 text-muted-foreground">模型</span>
          <select
            data-testid="model-name"
            class="h-6 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-xs"
            :value="conn.profile.model"
            @change="conn.profile.model = ($event.target as HTMLSelectElement).value; markDirty()"
          >
            <option v-for="m in SUPPORTED_MODELS" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <span class="shrink-0 text-muted-foreground">路径</span>
          <Input
            data-testid="model-api-base"
            class="h-6 flex-1 text-xs"
            :model-value="conn.profile.apiBase"
            @update:model-value="conn.profile.apiBase = String($event); markDirty()"
            @blur="onApiBaseBlur"
          />
          <Button size="sm" variant="ghost" class="h-6 shrink-0 px-1.5 text-[11px]" title="重置默认" @click="onResetApiBase">重置</Button>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <span class="shrink-0 text-muted-foreground">密钥</span>
          <div class="relative min-w-0 flex-1">
            <Input
              data-testid="model-api-key"
              class="h-6 w-full pr-7 text-xs"
              :type="showKey ? 'text' : 'password'"
              :model-value="conn.profile.apiKey"
              :placeholder="keyPlaceholder"
              @update:model-value="onKeyInput(String($event))"
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
          <span v-if="conn.profile.apiKeyState === 'set'" class="truncate text-green-600"
            >●已设置{{ conn.profile.apiKeyMasked ? ` ${conn.profile.apiKeyMasked}` : '' }}</span
          >
          <span v-else class="text-muted-foreground">○未设置</span>
          <label class="ml-auto flex shrink-0 items-center gap-1 text-xs">
            <input
              type="checkbox"
              class="h-3.5 w-3.5 accent-primary"
              :checked="conn.profile.rememberKey"
              @change="conn.profile.rememberKey = ($event.target as HTMLInputElement).checked; markDirty()"
            />
            <span>记住密钥</span>
          </label>
        </div>
      </div>

      <!-- 网络卡（唯一可写） -->
      <div class="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-2.5">
        <div class="flex items-center gap-2">
          <h3 class="text-xs font-semibold text-muted-foreground">网络</h3>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <label class="flex items-center gap-1.5">
            <input
              type="checkbox"
              class="h-3.5 w-3.5 accent-primary"
              :checked="conn.profile.proxyOn"
              @change="conn.profile.proxyOn = ($event.target as HTMLInputElement).checked; markDirty()"
            />
            <span>代理启用</span>
          </label>
          <Input
            class="h-6 flex-1 text-xs"
            :disabled="!conn.profile.proxyOn"
            :placeholder="proxyPlaceholder"
            :model-value="conn.profile.proxyUrl"
            @update:model-value="onProxyInput(String($event))"
            @focus="onProxyFocus"
          />
        </div>
        <div v-if="!conn.proxyTouched && conn.profile.proxyUrlState === 'set'" class="text-[11px] text-green-600">
          已设置（为保密不回显，聚焦即清空待重输；直接保存即保持原值）
        </div>
        <div v-if="socksWarning" class="text-[11px] text-red-600">本期仅支持 http/https</div>
        <div class="grid grid-cols-2 gap-1.5 text-xs">
          <label class="flex min-w-0 items-center gap-1">
            <span class="shrink-0 text-muted-foreground">连接</span>
            <input
              type="number"
              min="5"
              max="60"
              step="1"
              title="连接超时 5..60 秒"
              class="h-6 w-full min-w-0 rounded-md border bg-background px-1.5 text-xs"
              :value="conn.profile.connectTimeoutSecs"
              @input="conn.profile.connectTimeoutSecs = Math.min(60, Math.max(5, Math.round(Number(($event.target as HTMLInputElement).value) || 15))); markDirty()"
            />
            <span class="shrink-0 text-[11px] text-muted-foreground">s</span>
          </label>
          <label class="flex min-w-0 items-center gap-1">
            <span class="shrink-0 text-muted-foreground">总计</span>
            <input
              type="number"
              min="60"
              max="600"
              step="1"
              title="总超时 60..600 秒"
              class="h-6 w-full min-w-0 rounded-md border bg-background px-1.5 text-xs"
              :value="conn.profile.totalTimeoutSecs"
              @input="conn.profile.totalTimeoutSecs = Math.min(600, Math.max(60, Math.round(Number(($event.target as HTMLInputElement).value) || 300))); markDirty()"
            />
            <span class="shrink-0 text-[11px] text-muted-foreground">s</span>
          </label>
        </div>
      </div>
    </div>

    <!-- 底栏：恢复默认 + 测试结果 -->
    <div class="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="ghost" class="h-6 px-2 text-[11px]" @click="onResetDefault">恢复默认</Button>
      <span v-if="testResult" class="text-[11px] text-muted-foreground">{{ testResult }}</span>
    </div>
  </section>
</template>
