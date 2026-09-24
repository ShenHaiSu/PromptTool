/**
* 生图队列 invoke 封装（need05 F1 §1 / F2 §1 / B2 §1.3）
* 与 `src/lib/db.ts` 同风格：参数一律 camelCase，DTO 集中。
* 后端施工中：调用失败由上层降级处理（事件缺失时轮询，见 store）。
*/
import { invoke } from '@tauri-apps/api/core'
import { stripVerbatim } from './pathDisplay'
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
   /** 2a 预占 stem（无扩展名），入队即有；老任务为 null。 */
   expectedStem?: string | null
   /** 2a 落盘确定名（含扩展名与碰撞 -N 后缀）；完成前为 null。 */
   filename?: string | null
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

export interface IqEnqueueItem {
  prompt: string
  irHash?: string | null
  /** 一键复用下单带的单条 size/ratio；缺省时后端回落当前配置快照。 */
  size?: string
  ratio?: string
}
export interface IqEnqueueResult { enqueued: number; skipped: number; ids: string[] }

export interface IqTestResult {
  ok: boolean
  elapsedMs?: number
  stage?: 'dns' | 'connect' | 'auth' | 'api' | 'parse'
  message?: string
}

/** 后端纠正视图：apiKey 为 `__SET__` 占位或空串。 */
/** 后端视图：占位字段回 `__SET__`， state 字段不出后端（前端推导）。 */
export type IqConfigView = Omit<ImageQueueConfig, 'apiKeyState' | 'proxyUrlState'> & {
  apiKey: string
}

/** 前端内存态 → 后端 payload（含 `__SET__` 占位逻辑：未改动 key / proxy 时送占位保持原值）。 */
export function configToPayload(c: ImageQueueConfig, keyTouched: boolean, proxyTouched: boolean): IqConfigView {
  return {
    protocol: c.protocol,
    loopEnabled: c.loopEnabled,
    autoRandomOnStart: c.autoRandomOnStart,
    loopUsePartial: c.loopUsePartial,
    loopAllowNsfw: c.loopAllowNsfw,
    apiBase: c.apiBase,
    apiKey: keyTouched ? c.apiKey : IQ_KEY_SET_PLACEHOLDER,
    apiKeyMasked: c.apiKeyMasked,
    outputDir: c.outputDir,
    size: c.size,
    ratio: c.ratio,
    concurrency: c.concurrency,
    proxyOn: c.proxyOn,
    proxyUrl: proxyTouched ? c.proxyUrl : IQ_KEY_SET_PLACEHOLDER,
    rememberKey: c.rememberKey,
    embedMeta: c.embedMeta,
    connectTimeoutSecs: c.connectTimeoutSecs,
    totalTimeoutSecs: c.totalTimeoutSecs,
  }
}

/** need07：旧缓存清洗——`\\?\` 脱壳 + `<...>` 占位符置空。 */
export function washOutputDir(v: unknown): string {
  if (typeof v !== 'string') return ''
  const t = v.trim()
  if (!t || t.startsWith('<')) return ''
  return stripVerbatim(t)
}

/** 后端视图 → 前端内存态（占位转 `*State='set'`，原文置空等待重输；脱敏串仅展示）。 */
export function viewToConfig(view: Partial<IqConfigView>): ImageQueueConfig {
  const merged: ImageQueueConfig = { ...IQ_DEFAULT_CONFIG, ...(view as object) } as ImageQueueConfig
  merged.outputDir = washOutputDir(merged.outputDir)
  // 兼容旧 localStorage / 旧后端回包缺超时字段的情形
  if (!Number.isFinite(merged.connectTimeoutSecs)) merged.connectTimeoutSecs = IQ_DEFAULT_CONFIG.connectTimeoutSecs
  if (!Number.isFinite(merged.totalTimeoutSecs)) merged.totalTimeoutSecs = IQ_DEFAULT_CONFIG.totalTimeoutSecs
  // 兼容旧后端回包缺 embedMeta 的情形（旧 image_queue.json 无此字段 → 默认 true）
  if (typeof merged.embedMeta !== 'boolean') merged.embedMeta = true
  // 兼容旧后端回包缺队列独立随机字段的情形（默认纯随机、不含 NSFW）
  if (typeof merged.loopUsePartial !== 'boolean') merged.loopUsePartial = false
  if (typeof merged.loopAllowNsfw !== 'boolean') merged.loopAllowNsfw = false
  // 兼容旧后端回包缺 apiKeyMasked 的情形
  if (typeof merged.apiKeyMasked !== 'string') merged.apiKeyMasked = ''
  if ((view.apiKey ?? '') === IQ_KEY_SET_PLACEHOLDER) {
    merged.apiKey = ''
    merged.apiKeyState = 'set'
  } else if (view.apiKey) {
    merged.apiKey = ''
    merged.apiKeyState = 'set'
  } else {
    merged.apiKey = ''
    merged.apiKeyState = 'unset'
    merged.apiKeyMasked = ''
  }
  // 代理与密钥对称：占位/真值一律转 set 态且内存置空（明文不出内存/缓存）。
  if ((view.proxyUrl ?? '') === IQ_KEY_SET_PLACEHOLDER) {
    merged.proxyUrl = ''
    merged.proxyUrlState = 'set'
  } else if (view.proxyUrl) {
    merged.proxyUrl = ''
    merged.proxyUrlState = 'set'
  } else {
    merged.proxyUrl = ''
    merged.proxyUrlState = 'unset'
  }
  return merged
}

/** localStorage 只存非敏感字段（apiKey / proxyUrl 明文永不进 localStorage）。 */
export function toLocalCache(c: ImageQueueConfig): Record<string, unknown> {
  const { apiKey: _omitKey, proxyUrl: _omitProxy, ...rest } = c
  void _omitKey
  void _omitProxy
  return { ...rest, outputDir: washOutputDir(c.outputDir), apiKeyState: c.apiKeyState, proxyUrlState: c.proxyUrlState }
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
 /** 2b 文件名反查：支持 stem/全名/大小写/绝对路径/-1 后缀；找不到返回 null（不抛错）。 */
 export async function iqFindByFilename(query: string): Promise<ImageTaskView | null> {
   return invoke<ImageTaskView | null>('iq_find_by_filename', { query })
 }

/** 内嵌生图参数（need06）：与旧 sidecar 同构，无内嵌返回 null。 */
export interface EmbeddedImageMeta {
  prompt: string
  irHash?: string | null
  size: string
  ratio: string
  model: string
  imageUrl: string
  elapsedMs: number
  createdAt: number
  taskId: string
}

export async function readImageMeta(filePath: string): Promise<EmbeddedImageMeta | null> {
  return await invoke<EmbeddedImageMeta | null>('iq_read_image_meta', { filePath })
}

/** need07：输出目录解析/打开 + 路径探针（camelCase DTO）。 */
export interface PathBases {
  exeDir: string
  exeData: string
  activeData: string
  docDir: string | null
  base: 'exe' | 'appdata'
  writable: boolean
}

export interface PathMigrateStatus {
  version: string
  washed: number
  deduped: number
}

/** 只解析不打开，供设置页 placeholder/验收。 */
export async function iqGetResolvedOutputDir(): Promise<string> {
  return invoke<string>('iq_get_resolved_output_dir')
}

/** 解析 + 保活 + 打开，返回 display 形态绝对目录。 */
export async function iqOpenOutputDir(): Promise<string> {
  return invoke<string>('iq_open_output_dir')
}

export async function pathGetBases(): Promise<PathBases> {
  return invoke<PathBases>('path_get_bases')
}

export async function pathMigrateStatus(): Promise<PathMigrateStatus> {
  return invoke<PathMigrateStatus>('path_migrate_status')
}
