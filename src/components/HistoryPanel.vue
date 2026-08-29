<script setup lang="ts">
/**
 * HistoryPanel — 资产沉淀完整版
 * Tabs {历史/收藏/模板} + 搜索 + 右键菜单(收藏/重命名/删除/另存为模板) + 双击回填 + 空状态 + 已失效占位
 * 对标 history_panel.py 399行
 */
import { ref, computed, watch, onMounted } from 'vue'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { useAssemblyStore } from '@/stores/assembly'
import { useHistoryStore } from '@/stores/history'
import { useToast } from '@/composables/useToast'
import { ellipsis } from '@/lib/utils'
import SaveDialog from '@/components/SaveDialog.vue'

const assembly = useAssemblyStore()
const history = useHistoryStore()
const { push } = useToast()

const tab = ref('history')
const search = ref('')

// 右键菜单
const ctx = ref<{ kind: 'assembly' | 'template'; id: string; x: number; y: number } | null>(null)
function openCtx(e: MouseEvent, kind: 'assembly' | 'template', id: string): void {
  e.preventDefault()
  ctx.value = { kind, id, x: e.clientX, y: e.clientY }
}
function closeCtx(): void { ctx.value = null }

// 弹窗状态
const renameOpen = ref(false)
const renameId = ref<string | null>(null)
const renameInitial = ref('')
const tmplOpen = ref(false)
const tmplAssemblyId = ref<string | null>(null)

function fmtTime(ts: number): string {
  try {
    const d = new Date(ts * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch { return String(ts) }
}

function previewOf(a: { finalPrompt: string }): string {
  const s = (a.finalPrompt ?? '').trim()
  if (!s) return '（空 Prompt）'
  return ellipsis(s, 72)
}

// 搜索：历史/收藏本地过滤（finalPrompt/title），模板不过滤
const filteredRecent = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return history.recent
  return history.recent.filter((a) => (a.title ?? '').toLowerCase().includes(q) || a.finalPrompt.toLowerCase().includes(q))
})
const filteredFavs = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return history.favorites
  return history.favorites.filter((a) => (a.title ?? '').toLowerCase().includes(q) || a.finalPrompt.toLowerCase().includes(q))
})
const filteredTemplates = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return history.templates
  return history.templates.filter((t) => t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q))
})

// 当输入搜索时，同时触发后端 search（用于跨 title/final/prompt_ir 检索），结果合并到 searchResults 展示由 filteredRecent 覆盖即可
// 为保持简单，搜索框仅做前端过滤；后台搜索能力保留在 history.search 供扩展

watch(search, () => {
  // 可选：防抖调用后端 search，此处仅前端过滤已满足 H1/H2/H8 的验收
})

onMounted(async () => {
  try { await history.fetchAll() } catch { /* ignore in jsdom */ }
})

async function onToggleFavorite(id: string): Promise<void> {
  try {
    const v = await history.toggleFavorite(id)
    push(v ? '已收藏' : '已取消收藏', 'success', 1500)
  } catch (e) { push(`收藏失败: ${String(e)}`, 'error') }
  closeCtx()
}

async function onDeleteAssembly(id: string): Promise<void> {
  const ok = window.confirm('删除后可在 DB 中恢复（软删），确定删除？')
  if (!ok) { closeCtx(); return }
  try {
    await history.softDeleteAssembly(id)
    push('已删除', 'success', 1500)
  } catch (e) { push(`删除失败: ${String(e)}`, 'error') }
  closeCtx()
}

async function onDeleteTemplate(id: string): Promise<void> {
  const ok = window.confirm('确定删除该模板？')
  if (!ok) { closeCtx(); return }
  try { await history.removeTemplate(id); push('已删除模板', 'success', 1500) } catch (e) { push(String(e), 'error') }
  closeCtx()
}

function onRenameAssembly(id: string): void {
  const a = history.recent.find((x) => x.id === id) ?? history.favorites.find((x) => x.id === id)
  renameId.value = id
  renameInitial.value = a?.title ?? ''
  renameOpen.value = true
  closeCtx()
}

async function onRenameConfirm(payload: { name: string; desc: string | null }): Promise<void> {
  if (!renameId.value) return
  const title = payload.name.trim()
  if (!title) { push('标题不能为空', 'warning'); return }
  try { await history.rename(renameId.value, title); push('已重命名', 'success', 1500) } catch (e) { push(String(e), 'error') }
  renameId.value = null
}

function onSaveAsTemplateFromAssembly(id: string): void {
  tmplAssemblyId.value = id
  tmplOpen.value = true
  closeCtx()
}

async function onTemplateConfirm(payload: { name: string; desc: string | null }): Promise<void> {
  const name = payload.name.trim()
  if (!name) { push('模板名称不能为空', 'warning'); return }
  const cfg = assembly.config
  let items = [...assembly.selectedItems]
  if (tmplAssemblyId.value) {
    try { items = await history.loadSelectedItems(tmplAssemblyId.value) } catch { /* 回退到当前画布 */ }
  }
  if (items.length === 0) { push('模板内容为空，无法保存', 'warning'); tmplAssemblyId.value = null; return }
  if (items.some((it) => !it.module.dimensionKey?.trim())) { push('存在缺失分类的词条，无法存为模板', 'error'); tmplAssemblyId.value = null; return }
  const enabledKeys = [...new Set(items.map((it) => it.module.dimensionKey).filter(Boolean) as string[])]
  const cover = assembly.finalPrompt || null
  try {
    await history.saveTemplate(name, payload.desc, cfg, enabledKeys, cover, items)
    push('已另存为模板', 'success', 1500)
  } catch (e) { push(`保存模板失败: ${String(e)}`, 'error') }
  tmplAssemblyId.value = null
}

// 回填：双击或右键/卡片按钮回填
async function restoreAssembly(id: string): Promise<void> {
  if (assembly.selectedItems.length > 0) {
    const ok = window.confirm(`当前画布已有 ${assembly.selectedItems.length} 项，回填将覆盖为历史方案，是否继续？`)
    if (!ok) return
  }
  try {
    const items = await history.loadSelectedItems(id)
    // 已删占位已在 Rust 侧处理：[已失效] displayName + notes="[原条目已删除]"
    const invalidCount = items.filter((it) => (it.module.displayName ?? '').startsWith('[已失效]')).length
    assembly.setItems(items as typeof assembly.selectedItems)
    // setItems 已 reassemble
    if (invalidCount > 0) push(`已回填（${invalidCount} 项已失效为占位）`, 'warning', 2200)
    else push('已回填到画布', 'success', 1500)
  } catch (e) { push(`回填失败: ${String(e)}`, 'error') }
}

async function applyTemplateById(id: string): Promise<void> {
  if (assembly.selectedItems.length > 0) {
    const ok = window.confirm(`当前画布已有 ${assembly.selectedItems.length} 项，应用模板将覆盖为模板内容，是否继续？`)
    if (!ok) return
  }
  try {
    const [cfg, _keys, items] = await history.applyTemplate(id)
    assembly.setConfig(cfg as Partial<typeof assembly.config>)
    const invalidCount = items.filter((it) => (it.module.displayName ?? '').startsWith('[已失效]')).length
    assembly.setItems(items as typeof assembly.selectedItems)
    if (items.some((it) => !it.module.dimensionKey?.trim())) {
      push('模板回填分类异常：存在空 dimensionKey', 'error')
      return
    }
    if (invalidCount > 0) push(`已应用模板（${invalidCount} 项已失效为占位）`, 'warning', 2200)
    else push('已应用模板', 'success', 1500)
  } catch (e) { push(`应用模板失败: ${String(e)}`, 'error') }
}

function copyPrompt(text: string): void {
  if (!text) { push('空 Prompt 无法复制', 'warning'); return }
  navigator.clipboard?.writeText(text).then(() => push('已复制', 'success', 1200)).catch(() => push('复制失败', 'error'))
}
</script>

<template>
  <section data-testid="history-panel" class="flex min-h-0 flex-1 flex-col overflow-hidden border-t" @click="closeCtx()">
    <Tabs v-model="tab" default-value="history" class="flex min-h-0 flex-1 flex-col">
      <div class="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
        <TabsList class="shrink-0">
          <TabsTrigger value="history" data-testid="history-tab">历史</TabsTrigger>
          <TabsTrigger value="favorites" data-testid="favorites-tab">收藏</TabsTrigger>
          <TabsTrigger value="templates" data-testid="templates-tab">模板</TabsTrigger>
        </TabsList>
        <div class="ml-auto flex min-w-0 flex-1 justify-end">
          <div class="relative w-full max-w-[180px]">
            <Input
              data-testid="history-search"
              v-model="search"
              placeholder="搜索标题/Prompt..."
              class="h-7 pr-7 text-xs"
            />
            <button
              v-if="search"
              data-testid="history-search-clear"
              class="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-xs text-muted-foreground hover:bg-accent"
              title="清空"
              @click="search = ''"
            >✕</button>
          </div>
        </div>
      </div>

      <!-- 历史 -->
      <TabsContent value="history" class="flex min-h-0 flex-1 flex-col p-2" @click.stop>
        <ScrollArea class="flex-1">
          <div v-if="filteredRecent.length === 0" data-testid="history-empty" class="flex min-h-[160px] flex-col items-center justify-center gap-2 p-6 text-center">
            <div class="text-lg text-muted-foreground">◈</div>
            <p class="text-sm font-medium">暂无历史</p>
            <p class="text-xs text-muted-foreground">保存方案后在此查看 — 双击回填 · 右键更多</p>
            <p v-if="search" class="text-xs"><button data-testid="history-empty-clear-search" class="text-primary underline" @click="search = ''">清空搜索</button></p>
          </div>
          <ul v-else data-testid="history-list" class="space-y-1.5">
            <li
              v-for="a in filteredRecent"
              :key="a.id"
              :data-testid="`history-item-${a.id}`"
              :data-assembly-id="a.id"
              class="group flex flex-col gap-1 rounded-md border bg-card px-2.5 py-2 text-xs hover:bg-accent/40 cursor-pointer"
              :title="a.finalPrompt"
              @dblclick="restoreAssembly(a.id)"
              @contextmenu="openCtx($event, 'assembly', a.id)"
            >
              <div class="flex items-center gap-1.5">
                <span class="min-w-0 flex-1 truncate font-medium" :title="a.title ?? ''">{{ a.title ?? '（无标题）' }}</span>
                <button
                  :data-testid="`history-fav-btn-${a.id}`"
                  class="shrink-0 rounded px-1 hover:bg-background"
                  :class="a.isFavorite ? 'text-amber-500' : 'text-muted-foreground'"
                  :title="a.isFavorite ? '已收藏 — 点击取消' : '收藏'"
                  @click.stop="onToggleFavorite(a.id)"
                >{{ a.isFavorite ? '★' : '☆' }}</button>
                <Badge variant="secondary" class="h-5 shrink-0 px-1 text-[10px] font-mono">{{ fmtTime(a.createdAt) }}</Badge>
              </div>
              <p data-testid="history-item-preview" class="line-clamp-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-muted-foreground">{{ previewOf(a) }}</p>
              <div class="flex items-center gap-1">
                <Button size="sm" variant="ghost" class="h-6 px-1.5 text-[11px]" :data-testid="`history-restore-${a.id}`" @click.stop="restoreAssembly(a.id)">回填</Button>
                <Button size="sm" variant="ghost" class="h-6 px-1.5 text-[11px]" @click.stop="copyPrompt(a.finalPrompt)">复制</Button>
                <Button size="sm" variant="ghost" class="h-6 px-1.5 text-[11px]" @click.stop="onRenameAssembly(a.id)">重命名</Button>
                <Button size="sm" variant="ghost" class="h-6 px-1.5 text-[11px] text-destructive" @click.stop="onDeleteAssembly(a.id)">删除</Button>
              </div>
            </li>
          </ul>
        </ScrollArea>
      </TabsContent>

      <!-- 收藏 -->
      <TabsContent value="favorites" class="flex min-h-0 flex-1 flex-col p-2" @click.stop>
        <ScrollArea class="flex-1">
          <div v-if="filteredFavs.length === 0" data-testid="favorites-empty" class="flex min-h-[160px] flex-col items-center justify-center gap-2 p-6 text-center">
            <div class="text-lg text-muted-foreground">☆</div>
            <p class="text-sm font-medium">暂无收藏</p>
            <p class="text-xs text-muted-foreground">历史中点 ☆ 收藏 · 批量卡片 ★ 亦可</p>
            <p v-if="search" class="text-xs"><button class="text-primary underline" @click="search = ''">清空搜索</button></p>
          </div>
          <ul v-else data-testid="favorites-list" class="space-y-1.5">
            <li
              v-for="a in filteredFavs"
              :key="a.id"
              :data-testid="`favorite-item-${a.id}`"
              :data-assembly-id="a.id"
              class="flex flex-col gap-1 rounded-md border bg-card px-2.5 py-2 text-xs hover:bg-accent/40 cursor-pointer"
              @dblclick="restoreAssembly(a.id)"
              @contextmenu="openCtx($event, 'assembly', a.id)"
            >
              <div class="flex items-center gap-1.5">
                <span class="min-w-0 flex-1 truncate font-medium">{{ a.title ?? '（无标题）' }}</span>
                <Badge class="h-5 shrink-0 bg-amber-500 text-white">★ 收藏</Badge>
                <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{{ fmtTime(a.createdAt) }}</span>
              </div>
              <p class="line-clamp-2 whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">{{ previewOf(a) }}</p>
              <div class="flex gap-1">
                <Button size="sm" variant="ghost" class="h-6 px-1.5 text-[11px]" @click.stop="restoreAssembly(a.id)">回填</Button>
                <Button size="sm" variant="ghost" class="h-6 px-1.5 text-[11px]" @click.stop="onToggleFavorite(a.id)">取消收藏</Button>
                <Button size="sm" variant="ghost" class="h-6 px-1.5 text-[11px]" @click.stop="copyPrompt(a.finalPrompt)">复制</Button>
              </div>
            </li>
          </ul>
        </ScrollArea>
      </TabsContent>

      <!-- 模板 -->
      <TabsContent value="templates" class="flex min-h-0 flex-1 flex-col p-2" @click.stop>
        <ScrollArea class="flex-1">
          <div v-if="filteredTemplates.length === 0" data-testid="templates-empty" class="flex min-h-[160px] flex-col items-center justify-center gap-2 p-6 text-center">
            <div class="text-lg text-muted-foreground">◇</div>
            <p class="text-sm font-medium">暂无模板</p>
            <p class="text-xs text-muted-foreground">「另存为模板」后在此查看 · 双击应用配置</p>
          </div>
          <ul v-else data-testid="templates-list" class="space-y-1.5">
            <li
              v-for="t in filteredTemplates"
              :key="t.id"
              :data-testid="`template-item-${t.id}`"
              :data-template-id="t.id"
              class="flex flex-col gap-1 rounded-md border bg-card px-2.5 py-2 text-xs hover:bg-accent/40 cursor-pointer"
              @dblclick="applyTemplateById(t.id)"
              @contextmenu="openCtx($event, 'template', t.id)"
            >
              <div class="flex items-center gap-1.5">
                <span class="min-w-0 flex-1 truncate font-semibold">{{ t.name }}</span>
                <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{{ fmtTime(t.createdAt) }}</span>
              </div>
              <p v-if="t.description" class="line-clamp-2 text-[11px] text-muted-foreground">{{ t.description }}</p>
              <p v-if="t.coverPrompt" class="line-clamp-2 font-mono text-[11px] text-muted-foreground">{{ ellipsis(t.coverPrompt, 80) }}</p>
              <div class="flex gap-1">
                <Button size="sm" variant="ghost" class="h-6 px-1.5 text-[11px]" :data-testid="`template-apply-${t.id}`" @click.stop="applyTemplateById(t.id)">应用</Button>
                <Button size="sm" variant="ghost" class="h-6 px-1.5 text-[11px] text-destructive" @click.stop="onDeleteTemplate(t.id)">删除</Button>
              </div>
            </li>
          </ul>
        </ScrollArea>
      </TabsContent>
    </Tabs>

    <!-- ContextMenu -->
    <div
      v-if="ctx"
      data-testid="history-context-menu"
      class="fixed z-50 min-w-[160px] rounded-md border bg-popover p-1 shadow-lg"
      :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }"
      @click.stop
    >
      <template v-if="ctx.kind === 'assembly'">
        <button data-testid="ctx-toggle-fav" class="flex w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent" @click="onToggleFavorite(ctx.id)">收藏 / 取消收藏</button>
        <button data-testid="ctx-rename" class="flex w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent" @click="onRenameAssembly(ctx.id)">重命名</button>
        <button data-testid="ctx-save-as-template" class="flex w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent" @click="onSaveAsTemplateFromAssembly(ctx.id)">另存为模板</button>
        <button data-testid="ctx-restore" class="flex w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent" @click="restoreAssembly(ctx.id); closeCtx()">回填到画布</button>
        <div class="my-1 border-t" />
        <button data-testid="ctx-delete" class="flex w-full rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-accent" @click="onDeleteAssembly(ctx.id)">删除</button>
      </template>
      <template v-else>
        <button data-testid="ctx-template-apply" class="flex w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent" @click="applyTemplateById(ctx.id); closeCtx()">应用模板</button>
        <button data-testid="ctx-template-delete" class="flex w-full rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-accent" @click="onDeleteTemplate(ctx.id)">删除模板</button>
      </template>
    </div>

    <!-- 重命名弹窗 -->
    <SaveDialog
      :open="renameOpen"
      mode="rename"
      :initial-name="renameInitial"
      placeholder="新标题"
      @update:open="renameOpen = $event"
      @confirm="onRenameConfirm"
      @cancel="renameId = null"
    />
    <!-- 另存为模板弹窗 -->
    <SaveDialog
      :open="tmplOpen"
      mode="template"
      :initial-name="''"
      @update:open="tmplOpen = $event; if (!$event) tmplAssemblyId = null"
      @confirm="onTemplateConfirm"
      @cancel="tmplAssemblyId = null"
    />
  </section>
</template>
