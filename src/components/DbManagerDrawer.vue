<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { useDbRegistryStore } from '@/stores/dbRegistry'
import type { RegistryRow } from '@/stores/dbRegistry'
import { useToast } from '@/composables/useToast'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const store = useDbRegistryStore()
const { push } = useToast()

const showCreate = ref(false)
const createPath = ref('PromptDataBase.db')
const createAlias = ref('')
const createRemark = ref('')
const createWithSeed = ref(true)
const editingId = ref<string | null>(null)
const editAlias = ref('')
const editRemark = ref('')
const maxActiveSelect = ref(2)

onMounted(async () => {
  try {
    await store.fetchList()
    await store.fetchActiveInfo()
    if (store.activeInfo) maxActiveSelect.value = store.activeInfo.maxActive
  } catch {}
})

async function handleSwitch(path: string): Promise<void> {
  try { await store.switchActive(path) } catch (e) { push(String(e), 'error') }
}

async function handleRemove(row: RegistryRow): Promise<void> {
  const isMissing = row.status === 'missing'
  const msg = isMissing
    ? `该库文件已不存在，确定移除注册「${row.alias}」？`
    : `确定删除「${row.alias}」？\n路径：${row.path}\n此操作将永久删除数据库文件及伴生文件，且不可恢复。`
  if (!confirm(msg)) return
  try { await store.removeRegistry(row.path) } catch (e) { push(String(e), 'error') }
}

async function handleRepair(row: RegistryRow): Promise<void> {
  let newPath: string | null = null
  if (!newPath) newPath = window.prompt('请输入新 .db 绝对路径', '')?.trim() || null
  if (!newPath) return
  try { await store.repairPath(row.path, newPath); push('已补新路径', 'success') } catch (e) { push(String(e), 'error') }
}

async function handleRebuild(row: RegistryRow): Promise<void> {
  const withSeed = confirm('重建时是否插入样板？\n确定=带样板，取消=空白库')
  try { await store.rebuildMissing(row.path, withSeed); push('已重建', 'success') } catch (e) { push(String(e), 'error') }
}

function startEdit(row: RegistryRow): void {
  editingId.value = row.id
  editAlias.value = row.alias
  editRemark.value = row.remark ?? ''
}

async function confirmEdit(row: RegistryRow): Promise<void> {
  if (!editingId.value) return
  try {
    await store.updateMeta(row.path, editAlias.value.trim() || undefined, editRemark.value)
    editingId.value = null
    push('已更新', 'success')
  } catch (e) { push(String(e), 'error') }
}

async function handleSetMaxActive(): Promise<void> {
  try { await store.setMaxActive(maxActiveSelect.value); push(`已设为 ${maxActiveSelect.value} 个分区同时活跃`, 'success') } catch (e) { push(String(e), 'error') }
}

async function handleCreate(): Promise<void> {
  if (!createAlias.value.trim()) { push('别名必填', 'warning'); return }
  try {
    await store.createBusiness({ path: createPath.value.trim(), alias: createAlias.value.trim(), remark: createRemark.value.trim() || undefined, withSeed: createWithSeed.value })
  } catch (e) { push(String(e), 'error') }
}
</script>

<template>
  <div v-if="open" data-testid="db-manager-drawer" class="fixed inset-0 z-40 flex justify-end">
    <div class="absolute inset-0 bg-black/20" @click="emit('update:open', false)" />
    <div class="relative flex w-[420px] max-w-[90vw] flex-col bg-background shadow-xl">
      <div class="flex items-center justify-between border-b px-4 py-3">
        <h2 class="text-sm font-semibold">数据库管理</h2>
        <button class="rounded px-2 py-1 text-sm hover:bg-accent" data-testid="drawer-close" @click="emit('update:open', false)">×</button>
      </div>
      <div class="flex-1 overflow-auto p-4 space-y-4">
        <div v-if="store.activeInfo?.foreground" class="rounded bg-muted p-3 text-sm">
          <div class="font-medium">当前前台：{{ store.activeInfo.foreground.alias }}</div>
          <div class="text-xs text-muted-foreground break-all">{{ store.activeInfo.foreground.path }}</div>
        </div>
        <div class="space-y-2">
          <div v-for="row in store.list" :key="row.id" :data-testid="`registry-row-${row.alias}`" class="rounded border p-3">
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-full" :class="row.status === 'available' ? 'bg-green-500' : 'bg-red-500'" />
              <span class="text-sm font-medium">{{ row.alias }}</span>
              <span v-if="store.activeInfo?.foreground?.id === row.id" class="rounded bg-primary px-1 py-0.5 text-xs text-primary-foreground">前台</span>
              <span v-else-if="store.activeInfo?.resident.some(r => r.id === row.id)" class="rounded bg-muted px-1 py-0.5 text-xs">驻留</span>
              <span v-if="row.status === 'missing'" class="rounded bg-red-100 px-1 py-0.5 text-xs text-red-700">失效</span>
            </div>
            <div class="text-xs text-muted-foreground break-all">{{ row.path }}</div>
            <div class="text-xs text-muted-foreground">{{ row.dimCount }} 分类 · {{ row.moduleCount }} 词条 · 收藏 {{ row.favoriteCount }}</div>
            <div v-if="row.remark" class="text-xs">{{ row.remark }}</div>
            <div v-if="row.status === 'missing'" class="text-xs text-red-500">文件不存在</div>
            <div class="mt-2 flex flex-wrap gap-1">
              <template v-if="row.status === 'available'">
                <Button size="sm" variant="outline" class="h-7 text-xs" :data-testid="`switch-${row.alias}`" @click="handleSwitch(row.path)">切换</Button>
                <Button size="sm" variant="ghost" class="h-7 text-xs" @click="startEdit(row)">编辑</Button>
                <Button size="sm" variant="ghost" class="h-7 text-xs text-red-600" @click="handleRemove(row)">删除</Button>
              </template>
              <template v-else>
                <Button size="sm" variant="outline" class="h-7 text-xs" @click="handleRepair(row)">补新路径</Button>
                <Button size="sm" variant="outline" class="h-7 text-xs" @click="handleRebuild(row)">重建空白</Button>
                <Button size="sm" variant="ghost" class="h-7 text-xs" @click="handleRemove(row)">移除</Button>
              </template>
            </div>
            <div v-if="editingId === row.id" class="mt-2 space-y-2 rounded bg-muted p-2">
              <Input v-model="editAlias" placeholder="别名" class="h-7 text-xs" />
              <Input v-model="editRemark" placeholder="备注" class="h-7 text-xs" />
              <div class="flex gap-1">
                <Button size="sm" class="h-7 text-xs" @click="confirmEdit(row)">保存</Button>
                <Button size="sm" variant="ghost" class="h-7 text-xs" @click="editingId = null">取消</Button>
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-sm">最大驻留</span>
          <select v-model.number="maxActiveSelect" data-testid="max-active-select" class="rounded border px-2 py-1 text-sm" @change="handleSetMaxActive">
            <option :value="1">1</option>
            <option :value="2">2</option>
            <option :value="3">3</option>
            <option :value="4">4</option>
            <option :value="5">5</option>
          </select>
          <span class="text-xs text-muted-foreground">当前 {{ store.activeInfo?.maxActive ?? 2 }}</span>
        </div>

        <Card>
          <CardHeader><CardTitle class="text-sm">新建分区</CardTitle></CardHeader>
          <CardContent class="space-y-2">
            <Button size="sm" variant="outline" data-testid="toggle-create" @click="showCreate = !showCreate">{{ showCreate ? '收起' : '展开' }}</Button>
            <div v-if="showCreate" class="space-y-2">
              <Input v-model="createPath" placeholder="路径 .db" data-testid="create-path" />
              <Input v-model="createAlias" placeholder="别名 *必填" data-testid="create-alias" />
              <Input v-model="createRemark" placeholder="备注选填" data-testid="create-remark" />
              <label class="flex items-center gap-2 text-xs"><input type="checkbox" v-model="createWithSeed" data-testid="create-with-seed" /> 插入样板</label>
              <Button size="sm" data-testid="create-confirm" @click="handleCreate">创建并切换</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>
