<script setup lang="ts">
import { provide, ref, watch } from "vue"

interface Props {
  defaultValue?: string
  modelValue?: string
}
const props = withDefaults(defineProps<Props>(), { defaultValue: undefined, modelValue: undefined })
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>()

const current = ref(props.modelValue ?? props.defaultValue ?? "")

watch(() => props.modelValue, (v) => {
  if (v !== undefined) current.value = v
})

function setValue(v: string): void {
  current.value = v
  emit("update:modelValue", v)
}

provide("tabs:value", current)
provide("tabs:setValue", setValue)
</script>

<template>
  <div>
    <slot />
  </div>
</template>
