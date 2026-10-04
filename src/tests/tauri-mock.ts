import { vi } from 'vitest'

/**
 * need03 S6: 唯一 mock 工厂 — 封装 invoke/listen/isTauri 的 mock（成功/失败/延迟三形态）。
 * 各测试文件禁止手写第二套 mock，一律从此 import。
 */
export function mockInvokeOk<T>(data: T) {
  return vi.fn().mockResolvedValue(data)
}

export function mockInvokeFail(msg = 'mock invoke fail') {
  return vi.fn().mockRejectedValue(new Error(msg))
}

export function mockInvokeDelayed<T>(data: T, ms = 50) {
  return vi.fn().mockImplementation(() => new Promise((r) => setTimeout(() => r(data), ms)))
}

export function tauriApiMock(invokeImpl: ReturnType<typeof vi.fn>) {
  return { invoke: invokeImpl }
}

export function tauriEventMock() {
  return { listen: vi.fn().mockResolvedValue(() => undefined) }
}

export const isTauriMock = (v = false) => vi.fn().mockReturnValue(v)
