<script setup lang="ts">
/**
 * HistoryDrawer — need04：收纳原主界面右栏（历史/收藏/模板）。
 * 覆盖式 Modal Drawer（决策 D1）；懒挂载 HistoryPanel（决策 D5），关闭不销毁以保留滚动位置与页签状态。
 * need05 v2：关闭按钮只用 el-drawer 原生（默认 show-close=true），不手写 ×（见 docs/need05/02 §6）。
 */
import { ref, computed, watch } from 'vue'
import HistoryPanel from '@/components/HistoryPanel.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const openProxy = computed({
  get: () => props.open,
  set: (v: boolean) => emit('update:open', v),
})

/** 首次打开后才挂载 HistoryPanel；之后常驻（不随关闭销毁） */
const mountedOnce = ref(props.open)
watch(openProxy, (v) => { if (v) mountedOnce.value = true }, { immediate: true })
</script>

<template>
  <el-drawer
    v-model="openProxy"
    direction="rtl"
    size="420px"
    modal
    :close-on-click-modal="true"
    :close-on-press-escape="true"
    :destroy-on-close="false"
    append-to-body
    data-testid="history-drawer"
    class="history-drawer"
  >
    <template #header>
      <div class="flex w-full items-center">
        <h2 class="text-sm font-semibold">历史 · 收藏 · 模板</h2>
      </div>
    </template>

    <div v-if="mountedOnce" class="flex h-full min-h-0 flex-col overflow-hidden">
      <HistoryPanel />
    </div>
  </el-drawer>
</template>
