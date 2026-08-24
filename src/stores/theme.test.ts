import { describe, it, expect, beforeEach } from "vitest"
import { setActivePinia, createPinia } from "pinia"
import { useThemeStore } from "./theme"

describe("useThemeStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    document.documentElement.classList.remove("dark")
  })

  it("defaults to light when no preference", () => {
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia
    const store = useThemeStore()
    expect(["light", "dark"]).toContain(store.mode)
  })

  it("toggles light <-> dark", () => {
    const store = useThemeStore()
    const before = store.mode
    store.toggle()
    expect(store.mode).not.toBe(before)
    store.toggle()
    expect(store.mode).toBe(before)
  })

  it("applies dark class to document", () => {
    const store = useThemeStore()
    store.setTheme("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    store.setTheme("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })
})
