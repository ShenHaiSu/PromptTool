import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SingleShotPanel from '../SingleShotPanel.vue'
import { useImageQueueStore } from '@/stores/imageQueue'
import { useConnectionProfileStore } from '@/stores/connectionProfile'

vi.mock('@/lib/db', () => ({
  dbRevealInExplorer: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/imageQueueApi', () => ({
  iqGetResolvedOutputDir: vi.fn().mockResolvedValue('D:/out'),
  iqGetConfig: vi.fn().mockResolvedValue({ apiKey: '__SET__', apiKeyMasked: 'sk-***12' }),
  iqSetConfig: vi.fn(async (c: unknown) => c),
  viewToConfig: (v: Record<string, unknown>) => ({
    protocol: 'agnes',
    apiBase: 'https://apihub.agnes-ai.com',
    apiKey: '',
    apiKeyState: '__SET__' === v.apiKey ? 'set' : 'unset',
    apiKeyMasked: (v.apiKeyMasked as string) ?? '',
    outputDir: '',
    size: '1K',
    ratio: '1:1',
    concurrency: 2,
    proxyOn: false,
    proxyUrl: '',
    proxyUrlState: 'unset',
    rememberKey: true,
    embedMeta: true,
    connectTimeoutSecs: 15,
    totalTimeoutSecs: 300,
    loopEnabled: false,
    autoRandomOnStart: false,
    loopUsePartial: false,
    loopAllowNsfw: false,
  }),
  configToPayload: (c: unknown) => c,
}))

const statsMocks = vi.hoisted(() => ({
  gen: vi.fn(),
}))
vi.mock('@/lib/statsApi', () => ({
  iqGenerateOnePreview: (...a: unknown[]) => statsMocks.gen(...a),
  iqSavePreview: vi.fn().mockResolvedValue({ filename: 'a.png', filePath: 'D:/out/a.png' }),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  statsMocks.gen.mockReset()
  statsMocks.gen.mockResolvedValue({ imageBase64: 'AAAA', mime: 'image/png', elapsedMs: 800 })
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

function mountReady() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const iq = useImageQueueStore()
  iq.config.apiKeyState = 'set'
  const conn = useConnectionProfileStore()
  conn.profile.apiKeyState = 'set'
  conn.loaded = true
  return mount(SingleShotPanel, { global: { plugins: [pinia] } })
}

describe('need01-02A 单发健壮三件套', () => {
  it('失败存 lastError 并展示重试按钮，重试再次调用生成', async () => {
    statsMocks.gen.mockRejectedValueOnce(new Error('net down'))
    const w = mountReady()
    await w.vm.$nextTick()
    await w.find('[data-testid="single-shot-prompt"]').setValue('a cat')
    await w.find('[data-testid="single-shot-generate"]').trigger('click')
    await new Promise((r) => setTimeout(r, 20))
    await w.vm.$nextTick()
    expect(w.find('[data-testid="single-shot-error"]').exists()).toBe(true)
    expect(w.find('[data-testid="single-shot-retry"]').exists()).toBe(true)
    await w.find('[data-testid="single-shot-retry"]').trigger('click')
    await new Promise((r) => setTimeout(r, 20))
    await w.vm.$nextTick()
    expect(statsMocks.gen).toHaveBeenCalledTimes(2)
  })

  it('img 带 decoding=async，草稿仅 prompt/size/ratio', async () => {
    const w = mountReady()
    await w.vm.$nextTick()
    await w.find('[data-testid="single-shot-prompt"]').setValue('hello')
    await w.find('[data-testid="single-shot-generate"]').trigger('click')
    await new Promise((r) => setTimeout(r, 20))
    await w.vm.$nextTick()
    const img = w.find('[data-testid="single-shot-preview"]')
    expect(img.exists()).toBe(true)
    expect(img.attributes('decoding')).toBe('async')
    const raw = localStorage.getItem('singleShotDraft') ?? ''
    expect(raw).toContain('hello')
    expect(raw).not.toContain('AAAA')
  })

  it('密钥缺失空态带引导', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const w = mount(SingleShotPanel, { global: { plugins: [pinia] } })
    await w.vm.$nextTick()
    expect(w.find('[data-testid="single-shot-empty"]').exists()).toBe(true)
    expect(w.find('[data-testid="single-shot-empty"]').text()).toContain('先到生图队列保存密钥')
  })
})
