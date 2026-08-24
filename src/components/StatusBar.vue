<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { useThemeStore } from '@/stores/theme'
import { useAssemblyStore } from '@/stores/assembly'
import { useHistoryStore } from '@/stores/history'

defineProps<{
  dimCount: number
  moduleCount: number
}>()

const theme = useThemeStore()
const assembly = useAssemblyStore()
const history = useHistoryStore()
</script>

<template>
  <footer
    data-testid="status-bar"
    class="flex h-7 shrink-0 items-center justify-between border-t bg-muted px-3 text-xs text-muted-foreground"
  >
    <div class="flex items-center gap-3">
      <span data-testid="status-dimensions">维度: {{ dimCount || 14 }}</span>
      <span data-testid="status-modules">条目: {{ moduleCount || 311 }}</span>
      <span data-testid="status-selected">已选: {{ assembly.selectedItems.length }}</span>
      <span data-testid="status-history">历史: {{ history.recent.length }}</span>
      <span data-testid="status-favorites">收藏: {{ history.favorites.length }}</span>
      <span data-testid="status-model" class="rounded bg-background px-1.5 py-0.5 font-mono">{{ assembly.config.modelProfile.toUpperCase() }}</span>
    </div>
    <div class="flex items-center gap-2">
      <span class="hidden sm:inline">就绪 · Tauri P3</span>
      <Button
        data-testid="theme-toggle"
        variant="ghost"
        size="sm"
        class="h-6 px-2 text-xs"
        @click="theme.toggle()"
      >
        {{ theme.mode === 'light' ? '🌙 深色' : '☀️ 浅色' }}
      </Button>
    </div>
  </footer>
</template>
