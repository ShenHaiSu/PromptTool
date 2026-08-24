<script setup lang="ts">
import { cn } from "@/lib/utils"
interface Props { class?: string }
defineProps<Props>()
</script>
<template>
  <div :class="cn('p-6 pt-0', $props.class)">
    <slot />
  </div>
</template>
