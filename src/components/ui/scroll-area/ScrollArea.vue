<script setup lang="ts">
import { cn } from "@/lib/utils"
interface Props { class?: string }
defineProps<Props>()
</script>
<template>
  <div :class="cn('relative overflow-auto', $props.class)">
    <slot />
  </div>
</template>
