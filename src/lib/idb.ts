/**
 * IndexedDB 轻量 Promise 封装（阶段二，零生产依赖）。
 * 对标 docs/webFullStack/02§2 方案 A：open/upgrade/tx/store，约 150 行。
 * 测试时由 `fake-indexeddb/auto` 提供 globalThis.indexedDB（见 db.idb.test.ts）。
 */

export const IDB_NAME = 'pmf-web'
export const IDB_VERSION = 1

/** 在此层抛出的“纯 Web 不支持”错误（06 处理 UI，Toast 直接透出 message）。 */
export class NotSupportedInWebError extends Error {
  readonly fn: string
  constructor(fn: string, hint = '见 docs/webFullStack/06') {
    super(`NotSupportedInWeb: ${fn}（纯 Web 单库模式不支持，${hint}）`)
    this.name = 'NotSupportedInWebError'
    this.fn = fn
  }
}

export function notSupportedInWeb(fn: string): NotSupportedInWebError {
  return new NotSupportedInWebError(fn)
}

function factory(): IDBFactory {
  const f = globalThis.indexedDB
  if (!f) throw notSupportedInWeb('IndexedDB')
  return f
}

export type UpgradeHandler = (
  db: IDBDatabase,
  oldVersion: number,
  newVersion: number,
  t: IDBTransaction | null,
) => void

export function openDb(name: string, version: number, upgrade: UpgradeHandler): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest
    try {
      req = factory().open(name, version)
    } catch (e) {
      reject(e)
      return
    }
    req.onupgradeneeded = (ev) => {
      const oldVersion = (ev as IDBVersionChangeEvent).oldVersion ?? 0
      upgrade(req.result, oldVersion, version, req.transaction ?? null)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open 失败'))
    req.onblocked = () => reject(new Error('IndexedDB 被其他页面阻塞，请关闭旧标签页后重试'))
  })
}

function storeOf(t: IDBTransaction, name: string): IDBObjectStore {
  return t.objectStore(name)
}

/** 单事务执行回调；fn 内抛错即 abort 并 reject。 */
export function tx<T>(
  db: IDBDatabase,
  names: string | string[],
  mode: IDBTransactionMode,
  fn: (stores: Record<string, IDBObjectStore>, t: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let t: IDBTransaction
    try {
      t = db.transaction(Array.isArray(names) ? names : [names], mode)
    } catch (e) {
      reject(e)
      return
    }
    const list = Array.isArray(names) ? names : [names]
    const stores: Record<string, IDBObjectStore> = {}
    try {
      for (const n of list) stores[n] = storeOf(t, n)
    } catch (e) {
      reject(e)
      return
    }
    let result: Promise<T> | T
    try {
      result = fn(stores, t)
    } catch (e) {
      try { t.abort() } catch { /* ignore */ }
      reject(e)
      return
    }
    Promise.resolve(result).then(
      (v) => {
        t.oncomplete = () => resolve(v)
        t.onerror = () => reject(t.error ?? new Error('IndexedDB 事务失败'))
        t.onabort = () => reject(t.error ?? new Error('IndexedDB 事务已中止'))
      },
      (e) => {
        try { t.abort() } catch { /* ignore */ }
        reject(e)
      },
    )
  })
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('IndexedDB 请求失败'))
  })
}

export function getAll<T>(s: IDBObjectStore): Promise<T[]> {
  return req<T[]>(s.getAll() as IDBRequest<T[]>)
}

export function getByKey<T>(s: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> {
  return req<T | undefined>(s.get(key) as IDBRequest<T | undefined>)
}

export function putValue(s: IDBObjectStore, value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
  return req(s.put(value as never, key as never))
}

export function delByKey(s: IDBObjectStore, key: IDBValidKey): Promise<void> {
  return req(s.delete(key) as unknown as IDBRequest<void>).then(() => undefined)
}

/** 清空整个 store（阶段五“清空本地数据”用）。 */
export function clearStore(s: IDBObjectStore): Promise<void> {
  return req(s.clear() as unknown as IDBRequest<void>).then(() => undefined)
}

export function countAll(s: IDBObjectStore): Promise<number> {
  return req<number>(s.count() as IDBRequest<number>)
}

/** 按索引等值取全量（数据量 300-5000，无需游标优化）。 */
export function getAllByIndex<T>(s: IDBObjectStore, index: string, key: IDBValidKey): Promise<T[]> {
  return req<T[]>(s.index(index).getAll(key) as IDBRequest<T[]>)
}
