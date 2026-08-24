<script setup lang="ts">
import { inject, computed, type Ref } from "vue"
import { cn } from "@/lib/utils"

interface Props {
  value: string
  class?: string
}
const props = defineProps<Props>()
const current = inject<Ref<string>>("tabs:value")
const visible = computed(() => current?.value === props.value)
</script>

<template>
  <div v-show="visible" :class="cn('mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', $props.class)">
    <slot />
  </div>
</template>
