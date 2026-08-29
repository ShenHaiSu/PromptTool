import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  dbListRecent,
  dbListFavorites,
  dbListTemplates,
  dbSearchAssemblies,
  dbSaveAssembly,
  dbSaveTemplate,
  dbToggleFavorite,
  dbRenameAssembly,
  dbSoftDeleteAssembly,
  dbSoftDeleteTemplate,
  dbLoadSelectedItems,
  dbApplyTemplate,
} from '@/lib/db'
import type { Assembly, Template, SelectedItem, AssemblyConfig } from '@/engine/models'

export const useHistoryStore = defineStore('history', () => {
  const recent = ref<Assembly[]>([])
  const favorites = ref<Assembly[]>([])
  const templates = ref<Template[]>([])
  const loading = ref(false)
  const searchQuery = ref('')
  const searchResults = ref<Assembly[]>([])

  async function fetchRecent(limit = 50, offset = 0) {
    loading.value = true
    try { recent.value = await dbListRecent(limit, offset) } finally { loading.value = false }
  }

  async function fetchFavorites(limit = 100) {
    favorites.value = await dbListFavorites(limit)
  }

  async function fetchTemplates() {
    templates.value = await dbListTemplates()
  }

  async function fetchAll() {
    await Promise.all([fetchRecent(), fetchFavorites(), fetchTemplates()])
  }

  async function refresh() {
    await fetchAll()
  }

  // 保存方案：原子事务 assemblies + assembly_items
  async function save(
    title: string | null,
    irJson: string,
    finalPrompt: string,
    config: AssemblyConfig,
    items: SelectedItem[],
    isFavorite = false,
  ): Promise<string> {
    const id = await dbSaveAssembly(title, irJson, finalPrompt, config, items, isFavorite)
    await Promise.all([fetchRecent(), isFavorite ? fetchFavorites() : Promise.resolve()])
    return id
  }

  async function rename(id: string, title: string) {
    await dbRenameAssembly(id, title)
    for (const a of recent.value) if (a.id === id) a.title = title
    for (const a of favorites.value) if (a.id === id) a.title = title
    for (const a of searchResults.value) if (a.id === id) a.title = title
  }

  async function softDeleteAssembly(id: string) {
    await dbSoftDeleteAssembly(id)
    await removeAssemblyLocal(id)
  }

  // 兼容旧名 removeAssembly
  async function removeAssembly(id: string) {
    await softDeleteAssembly(id)
  }

  function removeAssemblyLocal(id: string) {
    recent.value = recent.value.filter((a) => a.id !== id)
    favorites.value = favorites.value.filter((a) => a.id !== id)
    searchResults.value = searchResults.value.filter((a) => a.id !== id)
  }

  async function toggleFavorite(id: string) {
    const v = await dbToggleFavorite(id)
    for (const a of recent.value) if (a.id === id) a.isFavorite = v
    for (const a of searchResults.value) if (a.id === id) a.isFavorite = v
    await fetchFavorites()
    return v
  }

  async function search(keyword: string) {
    searchQuery.value = keyword
    if (!keyword.trim()) {
      searchResults.value = []
      return
    }
    searchResults.value = await dbSearchAssemblies(keyword.trim())
  }

  function clearSearch() {
    searchQuery.value = ''
    searchResults.value = []
  }

  async function loadSelectedItems(assemblyId: string): Promise<SelectedItem[]> {
    return dbLoadSelectedItems(assemblyId)
  }

  // 模板 — Need04 破坏性：必传 selectedItems，返回值含 items 三元组
  async function saveTemplate(
    name: string,
    desc: string | null,
    config: AssemblyConfig,
    enabledKeys: string[],
    cover: string | null,
    selectedItems: SelectedItem[],
  ): Promise<string> {
    const id = await dbSaveTemplate(name, desc, config, enabledKeys, cover, selectedItems)
    await fetchTemplates()
    return id
  }

  async function applyTemplate(id: string): Promise<[AssemblyConfig, string[], SelectedItem[]]> {
    return dbApplyTemplate(id)
  }

  async function removeTemplate(id: string) {
    await dbSoftDeleteTemplate(id)
    templates.value = templates.value.filter((t) => t.id !== id)
  }

  return {
    recent, favorites, templates, loading, searchQuery, searchResults,
    fetchRecent, fetchFavorites, fetchTemplates, fetchAll, refresh,
    save, rename, softDeleteAssembly, removeAssembly, removeAssemblyLocal,
    toggleFavorite, search, clearSearch, loadSelectedItems,
    saveTemplate, applyTemplate, removeTemplate,
  }
})
