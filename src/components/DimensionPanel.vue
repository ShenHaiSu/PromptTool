<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAssemblyStore } from '@/stores/assembly'
import { dbGetDimensions, dbGetAllModulesGrouped } from '@/lib/db'
import type { Dimension, Module } from '@/engine/models'

const assembly = useAssemblyStore()

const keyword = ref('')
const allowNsfw = ref(false)

const dimensions = ref<Dimension[]>([])
const modulesByDim = ref<Record<string, Module[]>>({})
const loading = ref(false)
const expandedKeys = ref<Set<string>>(new Set())

const nsfwCount = computed(() => {
  let c = 0
  for (const mods of Object.values(modulesByDim.value)) for (const m of mods) if (m.isNsfw) c++
  return c
})

const filteredDimensions = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return dimensions.value
  // 过滤：维度名或条目命中时保留维度
  return dimensions.value.filter((d) => {
    if (d.nameCn.toLowerCase().includes(kw) || d.nameEn.toLowerCase().includes(kw) || d.key.toLowerCase().includes(kw)) return true
    const mods = modulesByDim.value[d.id] ?? []
    return mods.some((m) => m.displayName.toLowerCase().includes(kw) || m.contentEn.toLowerCase().includes(kw))
  })
})

/** 对单个维度的条目做搜索过滤 */
function filteredModules(dimId: string): Module[] {
  const list = modulesByDim.value[dimId] ?? []
  const kw = keyword.value.trim().toLowerCase()
  let out = list
  if (kw) out = out.filter((m) => m.displayName.toLowerCase().includes(kw) || m.contentEn.toLowerCase().includes(kw))
  if (!allowNsfw.value) out = out.filter((m) => !m.isNsfw)
  return out
}

function toggleExpand(key: string): void {
  const s = expandedKeys.value
  if (s.has(key)) s.delete(key)
  else s.add(key)
  // trigger reactivity (Set mutated)
  expandedKeys.value = new Set(s)
}

function isExpanded(key: string): boolean {
  return expandedKeys.value.has(key)
}

function isSelected(moduleId: string): boolean {
  return assembly.selectedItems.some((it) => it.module.id === moduleId)
}

function onAdd(m: Module, dim: Dimension): void {
  if (isSelected(m.id)) return
  // 若维度不允许多选且已有一项，则先移除同维度已选项（与原规则一致，由 assembly.addModule 兜底）
  if (!dim.isMultiSelect) {
    const existing = assembly.selectedItems.find((it) => it.module.dimensionId === dim.id)
    if (existing) assembly.removeModule(existing.module.id)
  }
  assembly.addModule({ module: { ...m, dimensionKey: dim.key }, locked: false, weightOverride: null })
}

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const dims = await dbGetDimensions()
    dimensions.value = dims
    // 默认展开全部（与原 Treeview 行为对齐）
    expandedKeys.value = new Set(dims.map((d) => d.key))
    try {
      const grouped = await dbGetAllModulesGrouped()
      // grouped key 为 dimension key，需映射到 id
      const byId: Record<string, Module[]> = {}
      for (const d of dims) {
        const key = d.key
        byId[d.id] = (grouped[key] ?? (grouped[d.id] ?? []))
      }
      // 若后端返回以 id 为 key 的，再补一次
      for (const [k, v] of Object.entries(grouped)) {
        const dim = dims.find((d) => d.id === k)
        if (dim && !byId[dim.id]) byId[dim.id] = v
      }
      modulesByDim.value = byId
    } catch {
      // 非 Tauri 环境（vitest/jsdom）下 invoke 失败时保持空列表，不阻塞布局验收
      modulesByDim.value = {}
    }
  } catch {
    // 同上，允许空状态渲染
  } finally {
    loading.value = false
  }
}

onMounted(() => { void refresh() })

// 暴露给测试/手验：刷新与状态
defineExpose({ refresh, keyword, allowNsfw, dimensions, modulesByDim })
</script>

<template>
  <section data-testid="dimension-panel" class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <!-- 工具行：搜索 + NSFW pill -->
    <div class="flex shrink-0 flex-col gap-2 border-b px-3 py-2">
      <Input
        v-model="keyword"
        data-testid="dimension-search"
        placeholder="搜索 维度/条目…"
        class="h-8 text-sm"
      />
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground">维度 {{ filteredDimensions.length }} / {{ dimensions.length }}</span>
        <Button
          data-testid="nsfw-pill"
          size="sm"
          :variant="allowNsfw ? 'default' : 'outline'"
          class="h-7 px-2 text-xs"
          :title="allowNsfw ? '已显示 NSFW 条目' : '已隐藏 NSFW 条目'"
          @click="allowNsfw = !allowNsfw"
        >
          <span class="mr-1 h-2 w-2 rounded-full" :class="allowNsfw ? 'bg-red-500' : 'bg-muted-foreground'" />
          NSFW {{ allowNsfw ? '开' : '关' }} · {{ nsfwCount }}
        </Button>
      </div>
    </div>

    <!-- Tree 按维度分组 -->
    <ScrollArea class="flex-1">
      <div class="p-2">
        <p v-if="loading" class="py-4 text-center text-xs text-muted-foreground">加载中…</p>
        <p v-else-if="filteredDimensions.length === 0" data-testid="dimension-empty" class="py-6 text-center text-xs text-muted-foreground">
          无匹配维度 — <button class="text-primary underline" @click="keyword = ''">清空搜索</button>
        </p>
        <div v-else class="space-y-1">
          <div
            v-for="dim in filteredDimensions"
            :key="dim.id"
            data-testid="dimension-group"
            :data-dim-key="dim.key"
            class="rounded-md border bg-card"
          >
            <!-- 维度头 -->
            <button
              :data-testid="`dimension-header-${dim.key}`"
              class="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-accent/50"
              @click="toggleExpand(dim.key)"
            >
              <div class="flex min-w-0 items-center gap-2">
                <span class="shrink-0 text-xs text-muted-foreground">{{ isExpanded(dim.key) ? '▾' : '▸' }}</span>
                <span class="truncate text-sm font-medium">{{ dim.nameCn }} <span class="text-xs font-normal text-muted-foreground">/ {{ dim.key }}</span></span>
                <span v-if="!dim.isMultiSelect" class="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800 dark:bg-amber-900 dark:text-amber-100">单选</span>
              </div>
              <span class="shrink-0 text-xs text-muted-foreground">{{ filteredModules(dim.id).length }}</span>
            </button>

            <!-- 条目列表 -->
            <div v-if="isExpanded(dim.key)" class="border-t px-1 py-1">
              <div v-if="filteredModules(dim.id).length === 0" class="py-2 text-center text-xs text-muted-foreground">（该维度暂无可显示条目）</div>
              <button
                v-for="m in filteredModules(dim.id)"
                :key="m.id"
                :data-testid="`module-row-${m.id}`"
                :data-module-id="m.id"
                class="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                :class="isSelected(m.id) ? 'bg-primary/10 hover:bg-primary/15' : ''"
                :title="m.contentEn"
                @dblclick="onAdd(m, dim)"
                @click="onAdd(m, dim)"
              >
                <span class="min-w-0 flex-1 truncate text-sm">{{ m.displayName }}</span>
                <span class="flex shrink-0 items-center gap-1">
                  <span v-if="m.weight !== 1" class="text-xs text-muted-foreground">w{{ m.weight.toFixed(1) }}</span>
                  <span v-if="m.isNsfw" class="h-1.5 w-1.5 rounded-full bg-red-500" title="NSFW" />
                  <Badge v-if="isSelected(m.id)" variant="secondary" class="h-5 px-1 py-0 text-[10px]">已选</Badge>
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  </section>
</template>
