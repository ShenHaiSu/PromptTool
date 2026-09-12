/**
 * IndexedDB 建表与种子数据（阶段二）。
 * 口径对标 src-tauri/resources/schema.sql + commands/migration.rs：
 * - DB 名 pmf-web，版本 1；10 个 object store（03§1）
 * - 种子：14 维 / samplePrompt 全量词条 / 3 条规则（见 seed-data.ts，由 scripts/gen-seed.mjs 生成）
 * - 幂等：kv['seed_version']=1；dimensions 非空时不重写用户数据
 */
import { IDB_NAME, IDB_VERSION, countAll, getByKey, openDb, putValue, tx } from './idb'
import { SEED_DIMENSIONS, SEED_MODULES, SEED_RULES, SEED_VERSION } from './seed-data'

export const KV_SEED_VERSION = 'seed_version'

function ensureStore(
  db: IDBDatabase,
  t: IDBTransaction | null,
  name: string,
  keyPath: string,
  indexes: Array<{ name: string; key: string; unique?: boolean }> = [],
): void {
  let store: IDBObjectStore
  if (db.objectStoreNames.contains(name)) {
    if (!t) return
    store = t.objectStore(name)
  } else {
    store = db.createObjectStore(name, { keyPath })
  }
  for (const idx of indexes) {
    if (!store.indexNames.contains(idx.name)) {
      store.createIndex(idx.name, idx.key, { unique: !!idx.unique })
    }
  }
}

/** onupgradeneeded：按 oldVersion 顺序建 store/索引，不删用户数据。 */
export function upgradeDb(db: IDBDatabase, oldVersion: number, _newVersion: number, t: IDBTransaction | null = null): void {
  void oldVersion
  void _newVersion
  ensureStore(db, t, 'dimensions', 'id', [
    { name: 'key', key: 'key', unique: true },
    { name: 'isDeleted', key: 'isDeleted' },
    { name: 'sortOrder', key: 'sortOrder' },
  ])
  ensureStore(db, t, 'modules', 'id', [
    { name: 'dimensionId', key: 'dimensionId' },
    { name: 'isDeleted', key: 'isDeleted' },
    { name: 'contentEn', key: 'contentEn' },
  ])
  ensureStore(db, t, 'tags', 'id', [{ name: 'name', key: 'name', unique: true }])
  ensureStore(db, t, 'module_tags', 'key', [
    { name: 'moduleId', key: 'moduleId' },
    { name: 'tagId', key: 'tagId' },
  ])
  ensureStore(db, t, 'assemblies', 'id', [
    { name: 'isDeleted', key: 'isDeleted' },
    { name: 'isFavorite', key: 'isFavorite' },
    { name: 'createdAt', key: 'createdAt' },
  ])
  ensureStore(db, t, 'assembly_items', 'id', [
    { name: 'assemblyId', key: 'assemblyId' },
    { name: 'moduleId', key: 'moduleId' },
  ])
  ensureStore(db, t, 'templates', 'id', [{ name: 'isDeleted', key: 'isDeleted' }])
  ensureStore(db, t, 'template_items', 'id', [
    { name: 'templateId', key: 'templateId' },
    { name: 'moduleId', key: 'moduleId' },
  ])
  ensureStore(db, t, 'rules', 'id', [
    { name: 'isEnabled', key: 'isEnabled' },
    { name: 'type', key: 'type' },
  ])
  ensureStore(db, t, 'kv', 'k')
}

let dbPromise: Promise<IDBDatabase> | null = null

/** 单例 DB：首次 open 后若空库则写入种子。 */
export function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDb(IDB_NAME, IDB_VERSION, upgradeDb).then(async (db) => {
      try {
        await ensureSeed(db)
      } catch (e) {
        // 种子失败不阻断开库（Toast 层可见），下次 open 重试
        console.error('[seed] ensureSeed 失败:', e)
      }
      return db
    })
    dbPromise.catch(() => {
      dbPromise = null
    })
  }
  return dbPromise
}

/** 测试/排查用：关闭并丢弃单例（下次 getDb 重新 open）。 */
export async function resetDbForTest(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise
      db.close()
    } catch {
      /* ignore */
    }
  }
  dbPromise = null
}

export async function ensureSeed(db: IDBDatabase): Promise<boolean> {
  const marked = await tx(db, 'kv', 'readonly', (s) =>
    getByKey<{ k: string; v: number }>(s['kv']!, 'seed_version'),
  )
  if (marked) return false
  const dimCount = await tx(db, 'dimensions', 'readonly', (s) => countAll(s['dimensions']!))
  if (dimCount > 0) {
    await tx(db, 'kv', 'readwrite', (s) =>
      putValue(s['kv']!, { k: KV_SEED_VERSION, v: SEED_VERSION }),
    )
    return false
  }
  const ts = Date.now()
  const dimIdByKey = new Map(SEED_DIMENSIONS.map((d) => [d.key, d.id]))
  await tx(db, ['dimensions', 'modules', 'rules', 'kv'], 'readwrite', (s) => {
    const ds = s['dimensions']!
    const ms = s['modules']!
    const rs = s['rules']!
    const kv = s['kv']!
    const jobs: Promise<unknown>[] = []
    for (const d of SEED_DIMENSIONS) {
      jobs.push(
        putValue(ds, {
          id: d.id,
          key: d.key,
          nameCn: d.nameCn,
          nameEn: d.nameEn,
          sortOrder: d.sortOrder,
          isMultiSelect: d.isMultiSelect ? 1 : 0,
          isEnabled: 1,
          icon: null,
          createdAt: ts,
          updatedAt: ts,
          isDeleted: 0,
        }),
      )
    }
    for (const m of SEED_MODULES) {
      jobs.push(
        putValue(ms, {
          id: m.id,
          dimensionId: dimIdByKey.get(m.dimKey) ?? '',
          contentEn: m.contentEn,
          displayName: m.displayName,
          weight: 1.0,
          isEnabled: m.isEnabled ? 1 : 0,
          isNsfw: m.isNsfw ? 1 : 0,
          usageCount: 0,
          exampleImage: null,
          notes: null,
          createdAt: ts,
          updatedAt: ts,
          isDeleted: 0,
        }),
      )
    }
    for (const r of SEED_RULES) {
      jobs.push(
        putValue(rs, {
          id: r.id,
          name: r.name,
          type: r.type,
          sourceDimensionId: r.sourceDimensionId,
          sourceModuleId: r.sourceModuleId,
          targetDimensionId: r.targetDimensionId,
          targetModuleId: r.targetModuleId,
          message: r.message,
          isEnabled: 1,
          createdAt: ts,
          isDeleted: 0,
        }),
      )
    }
    jobs.push(putValue(kv, { k: KV_SEED_VERSION, v: SEED_VERSION }))
    return Promise.all(jobs).then(() => undefined)
  })
  return true
}
