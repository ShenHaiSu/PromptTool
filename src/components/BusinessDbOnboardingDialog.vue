<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDbRegistryStore } from '@/stores/dbRegistry'
import { dbValidateBusiness, dbCheckAlias } from '@/lib/db'
import { notify } from '@/lib/notify'

const props = defineProps<{ open: boolean }>()
defineEmits<{ (e: 'update:open', v: boolean): void }>()

const store = useDbRegistryStore()

const pathInput = ref('PromptDataBase.db')
const aliasInput = ref('')
const remarkInput = ref('')
const withSeed = ref(true)
const pathError = ref('')
const aliasError = ref('')
const submitting = ref(false)

async function validatePathInline(): Promise<boolean> {
  pathError.value = ''
  const p = pathInput.value.trim()
  if (!p) { pathError.value = '路径不能为空'; return false }
  if (!p.toLowerCase().endsWith('.db')) { pathError.value = '必须以 .db 结尾'; return false }
  const lower = p.toLowerCase().replace(/\\/g, '/')
  const compatLower = lower.startsWith('data/') ? lower.slice(5) : lower
  for (const row of store.list) {
    const rl = row.path.toLowerCase().replace(/\\/g, '/')
    if (rl === lower || rl === compatLower) {
      pathError.value = '该路径已注册，请在列表中切换'
      return false
    }
  }
  try {
    const r = await dbValidateBusiness(p)
    if (!r.valid) { pathError.value = r.message; return false }
  } catch (e) {
    pathError.value = String(e)
    return false
  }
  return true
}

async function validateAliasInline(): Promise<boolean> {
  aliasError.value = ''
  const a = aliasInput.value.trim()
  if (!a) { aliasError.value = '别名必填'; return false }
  if (a.length > 32) { aliasError.value = '别名不能超过 32 个字符'; return false }
  try {
    const r = await dbCheckAlias(a)
    if (!r.available) { aliasError.value = r.message; return false }
  } catch (e) {
    aliasError.value = String(e)
    return false
  }
  return true
}

watch(() => props.open, (v) => {
  if (v) {
    if (store.list.length === 1 && store.activeInfo && !store.activeInfo.foreground) {
      const row = store.list[0]
      aliasInput.value = row.alias || ''
      pathInput.value = row.path || 'PromptDataBase.db'
    }
  }
})

async function handleCreate(): Promise<void> {
  if (submitting.value) return
  const okPath = await validatePathInline()
  const okAlias = await validateAliasInline()
  if (!okPath || !okAlias) return
  if (remarkInput.value.trim().length > 200) { notify('备注不能超过 200 个字符', 'error'); return }
  submitting.value = true
  try {
    await store.createBusiness({
      path: pathInput.value.trim(),
      alias: aliasInput.value.trim(),
      remark: remarkInput.value.trim() || undefined,
      withSeed: withSeed.value,
    })
  } catch (e) {
    notify(String(e), 'error')
  } finally {
    submitting.value = false
  }
}

async function handlePickExisting(): Promise<void> {
  let picked: string | null = null
  if (!picked) {
    const manual = window.prompt('请输入已存在 .db 的绝对路径', pathInput.value)
    if (!manual) return
    picked = manual
  }
  pathInput.value = picked
  const ok = await validatePathInline()
  if (!ok) return
  const okAlias = await validateAliasInline()
  if (!okAlias) { notify('请填写可用别名后再关联', 'warning'); return }
  if (submitting.value) return
  submitting.value = true
  try {
    await store.createBusiness({
      path: picked,
      alias: aliasInput.value.trim(),
      remark: remarkInput.value.trim() || undefined,
      withSeed: withSeed.value,
    })
  } catch (e) {
    notify(String(e), 'error')
  } finally {
    submitting.value = false
  }
}

async function handleBrowse(): Promise<void> {
  const manual = window.prompt('请输入 .db 路径', pathInput.value)
  if (manual) pathInput.value = manual
}
</script>

<template>
  <div
    v-if="open"
    data-testid="onboarding-dialog"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    @click.self="() => {}"
  >
    <el-card shadow="never" class="w-[560px] max-w-[90vw]">
      <template #header>
        <span class="text-base font-semibold">选择提示词数据库</span>
        <p class="text-sm text-muted-foreground">请选择或新建一个分区数据库（.db）。首次使用需创建一个业务库。</p>
      </template>
      <div class="space-y-4">
        <div class="space-y-1">
          <label class="text-sm font-medium">数据库路径</label>
          <div class="flex gap-2">
            <el-input v-model="pathInput" placeholder="PromptDataBase.db" class="flex-1" data-testid="onboarding-path" @blur="validatePathInline" />
            <el-button plain size="small" data-testid="onboarding-browse" @click="handleBrowse">浏览…</el-button>
          </div>
          <p v-if="pathError" data-testid="onboarding-path-error" class="text-xs text-red-500">{{ pathError }}</p>
          <p v-else class="text-xs text-muted-foreground">可为绝对或相对路径（相对 exe/data/）</p>
        </div>
        <div class="space-y-1">
          <label class="text-sm font-medium">别名 <span class="text-red-500">*</span></label>
          <el-input v-model="aliasInput" placeholder="如：默认库" data-testid="onboarding-alias" @blur="validateAliasInline" />
          <p v-if="aliasError" data-testid="onboarding-alias-error" class="text-xs text-red-500">{{ aliasError }}</p>
          <p v-else class="text-xs text-muted-foreground">1–32 个字符，大小写不敏感唯一</p>
        </div>
        <div class="space-y-1">
          <label class="text-sm font-medium">备注（选填）</label>
          <textarea v-model="remarkInput" placeholder="选填，最多 200 字" maxlength="200" rows="2" class="w-full rounded-md border px-3 py-2 text-sm" data-testid="onboarding-remark" />
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="withSeed" data-testid="onboarding-with-seed" />
          插入默认分类及样板提示词
        </label>
        <div class="flex justify-end gap-2 pt-2">
          <el-button data-testid="onboarding-create" type="primary" :disabled="submitting" @click="handleCreate">创建并切换</el-button>
          <el-button plain data-testid="onboarding-pick-existing" :disabled="submitting" @click="handlePickExisting">关联已有 .db</el-button>
        </div>
      </div>
    </el-card>
  </div>
</template>
