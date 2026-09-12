import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import path from "node:path"

// 纯 Web 基座（web-pure 阶段一）：无 Tauri、无 HMR 特殊端口，仅静态 SPA
// 阶段六：base './' 相对路径，任意静态托管子路径 / file:// 均可直接打开
// https://vite.dev/config/
export default defineConfig(async () => ({
  base: "./",
  plugins: [vue()],

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,js}", "tests/**/*.{test,spec}.{ts,js}"],
    setupFiles: ["./vitest.setup.ts"],
  },
}))
