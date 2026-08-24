import { defineStore } from "pinia"
import { ref, watch } from "vue"

export type ThemeMode = "light" | "dark"

const STORAGE_KEY = "pmf:theme"

function getInitialTheme(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null
  if (stored === "light" || stored === "dark") return stored
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark"
  return "light"
}

function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle("dark", mode === "dark")
  document.documentElement.style.colorScheme = mode
}

export const useThemeStore = defineStore("theme", () => {
  const mode = ref<ThemeMode>(getInitialTheme())

  // Apply immediately on creation
  applyTheme(mode.value)

  watch(
    mode,
    (v) => {
      localStorage.setItem(STORAGE_KEY, v)
      applyTheme(v)
    },
    { flush: "sync" },
  )

  function toggle(): void {
    mode.value = mode.value === "light" ? "dark" : "light"
  }

  function setTheme(v: ThemeMode): void {
    mode.value = v
  }

  return { mode, toggle, setTheme }
})
