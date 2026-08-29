import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  loadHistory,
  saveHistory,
  clearHistory as clearStorage,
  emptyHistory,
  type RandomHistoryState,
} from '@/engine/randomHistory'

export const useRandomHistoryStore = defineStore('randomHistory', () => {
  const state = ref<RandomHistoryState>(loadHistory())

  function persist(): void {
    saveHistory(state.value)
  }

  function clear(): void {
    state.value = emptyHistory()
    clearStorage()
  }

  return { state, persist, clear }
})
