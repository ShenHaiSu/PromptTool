/**
 * need03 S6：dbRegistry store —— 库切换 / 新建 / 列表 / 移除的成功与失败分支。
 * @/lib/db 整体 mock；window.location.reload 在 jsdom 不可用，需 stub。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const { db } = vi.hoisted(() => ({
  db: {
    dbGetActiveInfo: vi.fn(),
    dbListRegistry: vi.fn(),
    dbSwitchActive: vi.fn(),
    dbSetMaxActive: vi.fn(),
    dbRepairPath: vi.fn(),
    dbRebuildMissing: vi.fn(),
    dbRemoveRegistry: vi.fn(),
    dbUpdateRegistryMeta: vi.fn(),
    dbSetTempCarry: vi.fn(),
    dbCreateBusiness: vi.fn(),
    dbCheckAlias: vi.fn(),
  },
}))
vi.mock('@/lib/db', () => db)

// assembly store 依赖 library store（会拉 @tauri-apps/api/core），单测里 stub 掉
vi.mock('@/stores/library', () => ({
  useLibraryStore: () => ({ dimOrderMap: {} }),
}))

import { useDbRegistryStore } from '../dbRegistry'
import { useAssemblyStore } from '@/stores/assembly'
import { on, off, LIBRARY_CHANGED } from '@/lib/libraryEvents'
import type { Module } from '@/engine/models'

const reload = vi.fn()
const origLocation = window.location

const row = {
  id: 'g1',
  path: 'C:/lib',
  alias: '主库',
  remark: null,
  status: 'available' as const,
  createdAt: 1,
  lastOpenedAt: null,
  dimCount: 2,
  moduleCount: 3,
  favoriteCount: 0,
}

const info = { foreground: row, resident: [row], maxActive: 3 }

function mod(id: string, key: string): Module {
  return {
    id,
    dimensionId: 'd_' + key,
    contentEn: 'x',
    displayName: 'x',
    weight: 1,
    isEnabled: true,
    isNsfw: false,
    usageCount: 0,
    dimensionKey: key,
  } as Module
}

beforeEach(() => {
  setActivePinia(createPinia())
  for (const fn of Object.values(db)) fn.mockReset()
  db.dbListRegistry.mockResolvedValue([row])
  db.dbGetActiveInfo.mockResolvedValue(info)
  db.dbSwitchActive.mockResolvedValue({ normalizedPath: 'D:/lib2' })
  db.dbCreateBusiness.mockResolvedValue({ normalizedPath: 'C:/lib', alias: 'a' })
  db.dbSetTempCarry.mockResolvedValue(undefined)
  db.dbSetMaxActive.mockResolvedValue(undefined)
  db.dbRepairPath.mockResolvedValue(undefined)
  db.dbRebuildMissing.mockResolvedValue(undefined)
  db.dbUpdateRegistryMeta.mockResolvedValue(undefined)
  db.dbCheckAlias.mockResolvedValue({ available: true, message: '' })
  // jsdom 下 location.reload 不可用且只读，只能整体替换 location
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...origLocation, reload },
  })
  reload.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: origLocation,
  })
  vi.restoreAllMocks()
})

describe('dbRegistry fetchList / fetchActiveInfo', () => {
  it('fetchList 写入 list', async () => {
    const s = useDbRegistryStore()
    await s.fetchList()
    expect(db.dbListRegistry).toHaveBeenCalled()
    expect(s.list).toEqual([row])
  })

  it('fetchList 失败向上抛出且 list 不变', async () => {
    const s = useDbRegistryStore()
    db.dbListRegistry.mockRejectedValueOnce(new Error('list boom'))
    await expect(s.fetchList()).rejects.toThrow('list boom')
    expect(s.list).toEqual([])
  })

  it('fetchActiveInfo 有前台库时不打开引导', async () => {
    const s = useDbRegistryStore()
    await s.fetchActiveInfo()
    expect(s.activeInfo!.foreground!.path).toBe('C:/lib')
    expect(s.onboardingOpen).toBe(false)
  })

  it('fetchActiveInfo 无前台库时打开引导', async () => {
    const s = useDbRegistryStore()
    db.dbGetActiveInfo.mockResolvedValueOnce({ foreground: null, resident: [], maxActive: 3 })
    await s.fetchActiveInfo()
    expect(s.onboardingOpen).toBe(true)
  })

  it('fetchActiveInfo 失败向上抛出', async () => {
    const s = useDbRegistryStore()
    db.dbGetActiveInfo.mockRejectedValueOnce(new Error('info boom'))
    await expect(s.fetchActiveInfo()).rejects.toThrow('info boom')
  })
})

describe('dbRegistry switchActive', () => {
  it('无选中项时不暂存，直接切换 + 广播 + reload', async () => {
    const s = useDbRegistryStore()
    const seen: unknown[] = []
    const handler = (p: unknown) => seen.push(p)
    on(LIBRARY_CHANGED, handler)
    await s.switchActive('D:/lib2')
    off(LIBRARY_CHANGED, handler)
    expect(db.dbSetTempCarry).not.toHaveBeenCalled()
    expect(db.dbSwitchActive).toHaveBeenCalledWith('D:/lib2')
    expect(seen).toEqual([{ source: 'dbRegistry', op: 'switchActive', path: 'D:/lib2' }])
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('有选中项时先暂存 selectedItemIds/weightDraft 再切换', async () => {
    const a = useAssemblyStore()
    a.addModule({ module: mod('m1', 'top'), locked: false })
    a.addModule({ module: mod('m2', 'bottom'), locked: false })
    a.updateWeight('m1', 1.8)
    const s = useDbRegistryStore()
    await s.switchActive('D:/lib2')
    expect(db.dbSetTempCarry).toHaveBeenCalledWith({
      selectedItemIds: ['m1', 'm2'],
      weightDraft: { m1: 1.8 },
    })
    expect(db.dbSwitchActive).toHaveBeenCalledWith('D:/lib2')
  })

  it('暂存失败只 warn 不阻断切换', async () => {
    const a = useAssemblyStore()
    a.addModule({ module: mod('m1', 'top'), locked: false })
    const s = useDbRegistryStore()
    db.dbSetTempCarry.mockRejectedValueOnce(new Error('carry fail'))
    await expect(s.switchActive('D:/lib2')).resolves.toBeUndefined()
    expect(db.dbSwitchActive).toHaveBeenCalledWith('D:/lib2')
    expect(reload).toHaveBeenCalled()
  })

  it('切换失败向上抛出且不 reload', async () => {
    const s = useDbRegistryStore()
    db.dbSwitchActive.mockRejectedValueOnce(new Error('switch boom'))
    await expect(s.switchActive('D:/lib2')).rejects.toThrow('switch boom')
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('dbRegistry createBusiness', () => {
  it('无选中项时直接新建 + 广播 + reload', async () => {
    const s = useDbRegistryStore()
    const seen: unknown[] = []
    const handler = (p: unknown) => seen.push(p)
    on(LIBRARY_CHANGED, handler)
    await s.createBusiness({ path: 'C:/new', alias: 'a', withSeed: true })
    off(LIBRARY_CHANGED, handler)
    expect(db.dbSetTempCarry).not.toHaveBeenCalled()
    expect(db.dbCreateBusiness).toHaveBeenCalledWith({ path: 'C:/new', alias: 'a', withSeed: true })
    expect(seen).toEqual([{ source: 'dbRegistry', op: 'createBusiness', path: 'C:/new' }])
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('有选中项时先暂存', async () => {
    const a = useAssemblyStore()
    a.addModule({ module: mod('m9', 'top'), locked: false })
    const s = useDbRegistryStore()
    await s.createBusiness({ path: 'C:/new', alias: 'a', remark: 'r', withSeed: false })
    expect(db.dbSetTempCarry).toHaveBeenCalledWith({ selectedItemIds: ['m9'], weightDraft: {} })
  })

  it('暂存失败只 warn 不阻断新建', async () => {
    const a = useAssemblyStore()
    a.addModule({ module: mod('m9', 'top'), locked: false })
    const s = useDbRegistryStore()
    db.dbSetTempCarry.mockRejectedValueOnce(new Error('carry fail'))
    await expect(s.createBusiness({ path: 'C:/new', alias: 'a', withSeed: false })).resolves.toBeUndefined()
    expect(db.dbCreateBusiness).toHaveBeenCalled()
  })

  it('新建失败向上抛出且不 reload', async () => {
    const s = useDbRegistryStore()
    db.dbCreateBusiness.mockRejectedValueOnce(new Error('create boom'))
    await expect(s.createBusiness({ path: 'C:/new', alias: 'a', withSeed: true })).rejects.toThrow('create boom')
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('dbRegistry repairPath / rebuildMissing / updateMeta / setMaxActive', () => {
  it('repairPath 成功后刷新 list/activeInfo 并广播', async () => {
    const s = useDbRegistryStore()
    const seen: unknown[] = []
    const handler = (p: unknown) => seen.push(p)
    on(LIBRARY_CHANGED, handler)
    await s.repairPath('C:/old', 'C:/new')
    off(LIBRARY_CHANGED, handler)
    expect(db.dbRepairPath).toHaveBeenCalledWith('C:/old', 'C:/new')
    expect(s.list).toEqual([row])
    expect(s.activeInfo).not.toBeNull()
    expect(seen).toEqual([{ source: 'dbRegistry', op: 'repairPath' }])
  })

  it('repairPath 失败向上抛出', async () => {
    const s = useDbRegistryStore()
    db.dbRepairPath.mockRejectedValueOnce(new Error('repair boom'))
    await expect(s.repairPath('a', 'b')).rejects.toThrow('repair boom')
  })

  it('rebuildMissing 成功后刷新并广播', async () => {
    const s = useDbRegistryStore()
    const seen: unknown[] = []
    const handler = (p: unknown) => seen.push(p)
    on(LIBRARY_CHANGED, handler)
    await s.rebuildMissing('C:/lib', true)
    off(LIBRARY_CHANGED, handler)
    expect(db.dbRebuildMissing).toHaveBeenCalledWith('C:/lib', true)
    expect(seen).toEqual([{ source: 'dbRegistry', op: 'rebuildMissing', path: 'C:/lib' }])
  })

  it('rebuildMissing 失败向上抛出', async () => {
    const s = useDbRegistryStore()
    db.dbRebuildMissing.mockRejectedValueOnce(new Error('rebuild boom'))
    await expect(s.rebuildMissing('C:/lib', false)).rejects.toThrow('rebuild boom')
  })

  it('updateMeta 成功后刷新 list/activeInfo', async () => {
    const s = useDbRegistryStore()
    await s.updateMeta('C:/lib', '别名', '备注')
    expect(db.dbUpdateRegistryMeta).toHaveBeenCalledWith('C:/lib', '别名', '备注')
    expect(s.list).toEqual([row])
  })

  it('updateMeta 失败向上抛出', async () => {
    const s = useDbRegistryStore()
    db.dbUpdateRegistryMeta.mockRejectedValueOnce(new Error('meta boom'))
    await expect(s.updateMeta('C:/lib')).rejects.toThrow('meta boom')
  })

  it('setMaxActive 成功后刷新 activeInfo', async () => {
    const s = useDbRegistryStore()
    await s.setMaxActive(4)
    expect(db.dbSetMaxActive).toHaveBeenCalledWith(4)
    expect(s.activeInfo!.maxActive).toBe(3)
  })

  it('setMaxActive 失败向上抛出', async () => {
    const s = useDbRegistryStore()
    db.dbSetMaxActive.mockRejectedValueOnce(new Error('max boom'))
    await expect(s.setMaxActive(4)).rejects.toThrow('max boom')
  })

  it('checkAlias 直接透传后端结果', async () => {
    const s = useDbRegistryStore()
    const r = await s.checkAlias('main')
    expect(db.dbCheckAlias).toHaveBeenCalledWith('main')
    expect(r.available).toBe(true)
  })

  it('checkAlias 失败向上抛出', async () => {
    const s = useDbRegistryStore()
    db.dbCheckAlias.mockRejectedValueOnce(new Error('alias boom'))
    await expect(s.checkAlias('main')).rejects.toThrow('alias boom')
  })
})

describe('dbRegistry removeRegistry', () => {
  it('移除前台库：广播 + reload，不刷新列表', async () => {
    const s = useDbRegistryStore()
    db.dbRemoveRegistry.mockResolvedValueOnce({ wasForeground: true, nextForeground: 'D:/other' })
    const seen: unknown[] = []
    const handler = (p: unknown) => seen.push(p)
    on(LIBRARY_CHANGED, handler)
    const res = await s.removeRegistry('C:/lib')
    off(LIBRARY_CHANGED, handler)
    expect(res.wasForeground).toBe(true)
    expect(seen).toEqual([{ source: 'dbRegistry', op: 'removeRegistry', path: 'C:/lib' }])
    expect(reload).toHaveBeenCalledTimes(1)
    expect(db.dbListRegistry).not.toHaveBeenCalled()
  })

  it('移除常驻库：刷新 list/activeInfo，不 reload', async () => {
    const s = useDbRegistryStore()
    db.dbRemoveRegistry.mockResolvedValueOnce({ wasForeground: false, nextForeground: null })
    const res = await s.removeRegistry('D:/other')
    expect(res.nextForeground).toBeNull()
    expect(db.dbListRegistry).toHaveBeenCalled()
    expect(db.dbGetActiveInfo).toHaveBeenCalled()
    expect(s.list).toEqual([row])
    expect(reload).not.toHaveBeenCalled()
  })

  it('移除失败向上抛出', async () => {
    const s = useDbRegistryStore()
    db.dbRemoveRegistry.mockRejectedValueOnce(new Error('remove boom'))
    await expect(s.removeRegistry('C:/lib')).rejects.toThrow('remove boom')
  })
})

describe('dbRegistry 事件总线容错', () => {
  it('订阅者抛异常不影响 switchActive 主流程', async () => {
    const bad = () => {
      throw new Error('handler boom')
    }
    on(LIBRARY_CHANGED, bad)
    const s = useDbRegistryStore()
    await expect(s.switchActive('D:/lib2')).resolves.toBeUndefined()
    off(LIBRARY_CHANGED, bad)
    expect(db.dbSwitchActive).toHaveBeenCalledWith('D:/lib2')
  })
})