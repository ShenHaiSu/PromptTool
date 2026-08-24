<script setup lang="ts">
import { inject, computed, type Ref } from "vue"
import { cn } from "@/lib/utils"

interface Props {
  value: string
  class?: string
}
const props = defineProps<Props>()
const current = inject<Ref<string>>("tabs:value")
const setValue = inject<(v: string) => void>("tabs:setValue")

const active = computed(() => current?.value === props.value)
</script>

<template>
  <button
    :data-state="active ? 'active' : 'inactive'"
    :class="cn('inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow', $props.class)"
    @click="setValue?.(props.value)"
  >
    <slot />
  </button>
</template>
