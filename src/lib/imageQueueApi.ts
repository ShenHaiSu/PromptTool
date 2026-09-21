/**
 * 生图队列 invoke 封装（need05 F1 §1 / F2 §1 / B2 §1.3）
 * 与 `src/lib/db.ts` 同风格：参数一律 camelCase，DTO 集中。
 * 后端施工中：调用失败由上层降级处理（事件缺失时轮询，见 store）。
 */
import { invoke } from '@tauri-apps/api/core'
import type { ImageQueueConfig } from './imageQueue'
import { IQ_DEFAULT_CONFIG, IQ_KEY_SET_PLACEHOLDER } from './imageQueue'

export type ImageTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface ImageTaskView {
  id: string
  prompt: string
  irHash?: string | null
  size: string
  ratio: string
  status: ImageTaskStatus
  imageUrl?: string | null
  filePath?: string | null
  elapsedMs?: number | null
  error?: string | null
  retryCount: number
  createdAt: number
}

export interface IqStats {
  queued: number
  running: number
  succeeded: number
  failed: number
  consecFail: number
  stopped: boolean
}

export interface IqHungryPayload { want: number }
export interface IqHaltedPayload { reason: 'manual' | 'circuit' | 'io' | 'disk'; message?: string }

export interface IqEnqueueItem { prompt: string; irHash?: string | null }
export interface IqEnqueueResult { enqueued: number; skipped: number; ids: string[] }

export interface IqTestResult {
  ok: boolean
  elapsedMs?: number
  stage?: 'dns' | 'connect' | 'auth' | 'api' | 'parse'
  message?: string
}

/** 后端纠正视图：apiKey 为 `__SET__` 占位或空串。 */
export type IqConfigView = Omit<ImageQueueConfig, 'apiKeyState'> & { apiKey: string }

/** 前端内存态 → 后端 payload（含 `__SET__` 占位逻辑：未改动 key 时送占位）。 */
export function configToPayload(c: ImageQueueConfig, keyTouched: boolean): IqConfigView {
  return {
    protocol: c.protocol,
    loopEnabled: c.loopEnabled,
    autoRandomOnStart: c.autoRandomOnStart,
    apiBase: c.apiBase,
    apiKey: keyTouched ? c.apiKey : IQ_KEY_SET_PLACEHOLDER,
    outputDir: c.outputDir,
    size: c.size,
    ratio: c.ratio,
    concurrency: c.concurrency,
    proxyOn: c.proxyOn,
    proxyUrl: c.proxyUrl,
    rememberKey: c.rememberKey,
    connectTimeoutSecs: c.connectTimeoutSecs,
    totalTimeoutSecs: c.totalTimeoutSecs,
  }
}

/** 后端视图 → 前端内存态（占位转 `apiKeyState='set'`，apiKey 置空等待重输）。 */
export function viewToConfig(view: Partial<IqConfigView>): ImageQueueConfig {
  const merged: ImageQueueConfig = { ...IQ_DEFAULT_CONFIG, ...(view as object) } as ImageQueueConfig
  // 兼容旧 localStorage / 旧后端回包缺超时字段的情形
  if (!Number.isFinite(merged.connectTimeoutSecs)) merged.connectTimeoutSecs = IQ_DEFAULT_CONFIG.connectTimeoutSecs
  if (!Number.isFinite(merged.totalTimeoutSecs)) merged.totalTimeoutSecs = IQ_DEFAULT_CONFIG.totalTimeoutSecs
  if ((view.apiKey ?? '') === IQ_KEY_SET_PLACEHOLDER) {
    merged.apiKey = ''
    merged.apiKeyState = 'set'
  } else if (view.apiKey) {
    merged.apiKey = ''
    merged.apiKeyState = 'set'
  } else {
    merged.apiKey = ''
    merged.apiKeyState = 'unset'
  }
  return merged
}

/** localStorage 只存非敏感字段（apiKey 永不进 localStorage）。 */
export function toLocalCache(c: ImageQueueConfig): Record<string, unknown> {
  const { apiKey: _omit, ...rest } = c
  void _omit
  return { ...rest, apiKeyState: c.apiKeyState }
}

export async function iqGetConfig(): Promise<IqConfigView> {
  return invoke<IqConfigView>('iq_get_config')
}

export async function iqSetConfig(cfg: IqConfigView): Promise<IqConfigView> {
  return invoke<IqConfigView>('iq_set_config', { cfg })
}

export async function iqTestConnection(): Promise<IqTestResult> {
  return invoke<IqTestResult>('iq_test_connection')
}

export async function iqEnqueue(items: IqEnqueueItem[]): Promise<string[]> {
  return invoke<string[]>('iq_enqueue', { items })
}

export async function iqStart(): Promise<number> {
  return invoke<number>('iq_start')
}

export async function iqStop(): Promise<void> {
  await invoke('iq_stop')
}

export async function iqRetry(taskId: string): Promise<void> {
  await invoke('iq_retry', { taskId })
}

export async function iqRemove(taskId: string, deleteFile = false): Promise<void> {
  await invoke('iq_remove', { taskId, deleteFile })
}

export async function iqClearFinished(): Promise<number> {
  return invoke<number>('iq_clear_finished')
}

export async function iqList(
  offset = 0,
  limit = 100,
  status?: string,
): Promise<{ total: number; items: ImageTaskView[] }> {
  return invoke<{ total: number; items: ImageTaskView[] }>('iq_list', { offset, limit, status: status ?? null })
}
