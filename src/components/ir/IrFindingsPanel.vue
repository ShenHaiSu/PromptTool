 <script setup lang="ts">
 import type { Finding, IRSegment } from '@/engine/models'
 import RuleListPanel from '@/components/RuleListPanel.vue'
 
 const props = defineProps<{
   draft: IRSegment[]
   tab: string
   findings: Finding[]
   activeCount: number
   engineRulesCount: number
   loadError: string | null
   fixingId: string | null
   ruleDims: { id: string; key: string; nameCn: string }[]
   ruleModulesByDimId: Record<string, { id: string; displayName: string }[]>
 }>()
 
 defineEmits<{
   (e: 'tab-change', v: string): void
   (e: 'retry'): void
   (e: 'ignore-all'): void
   (e: 'locate', index: number): void
   (e: 'fix-toggle', ruleId: string): void
   (e: 'fix-confirm', f: Finding): void
   (e: 'fix-cancel'): void
   (e: 'ignore', f: Finding): void
   (e: 'unignore', f: Finding): void
 }>()
 
 function dimKeyOf(i: number): string {
   return props.draft[i]?.dimensionKey || '空段'
 }
 
 function chipsFor(f: Finding): { index: number; label: string }[] {
   return f.involvedIndexes.map((i) => ({ index: i, label: `#${i + 1} ${dimKeyOf(i)}` }))
 }
 
 function fixChips(f: Finding): { remove: { index: number; label: string }[]; keep: { index: number; label: string }[] } {
   const label = (i: number): string => `#${i + 1} ${dimKeyOf(i)}`
   return {
     remove: (f.fix?.removeIndexes ?? []).map((i) => ({ index: i, label: label(i) })),
     keep: (f.fix?.keepIndexes ?? []).map((i) => ({ index: i, label: label(i) })),
   }
 }
</script>

<template>
  <section class="flex min-h-0 flex-[42] flex-col overflow-hidden max-[900px]:max-h-[38vh]" aria-label="冲突与规则">
    <div data-testid="ir-editor-tabs" class="flex min-h-0 flex-1 flex-col">
      <div class="flex shrink-0 gap-1 border-b">
        <button
          data-testid="ir-editor-tab-findings"
          class="rounded-t px-3 py-1.5 text-xs font-medium"
          :class="tab === 'findings' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'"
          @click="$emit('tab-change', 'findings')"
        >冲突（{{ activeCount }}）</button>
        <button
          data-testid="ir-editor-tab-rules"
          class="rounded-t px-3 py-1.5 text-xs font-medium"
          :class="tab === 'rules' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'"
          @click="$emit('tab-change', 'rules')"
        >规则管理</button>
      </div>
      <div v-if="tab === 'findings'" class="flex min-h-0 flex-1 flex-col">
        <div class="flex shrink-0 items-center justify-between py-1">
          <span class="text-[11px] text-muted-foreground">{{ loadError ? `规则加载失败，仅预览：${loadError}` : `${engineRulesCount} 条规则参与判定` }}</span>
          <div class="flex items-center gap-1">
            <el-button v-if="loadError" text size="small" @click="$emit('retry')">重试</el-button>
            <button class="rounded px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground" @click="$emit('ignore-all')">全部忽略</button>
          </div>
        </div>
        <el-scrollbar class="min-h-0 flex-1">
          <div v-if="findings.length === 0" class="flex min-h-[120px] flex-col items-center justify-center gap-1 p-4 text-center">
            <p class="text-xs font-medium">✓ 暂无冲突</p>
            <p class="text-[11px] text-muted-foreground">改段、改权重或开关规则会实时重算</p>
          </div>
          <ul v-else class="flex flex-col gap-2 p-1" role="list">
            <li
              v-for="f in findings"
              :key="f.ruleId"
              :data-testid="`ir-editor-finding-row-${f.ruleId}`"
              role="listitem"
              class="rounded-md border p-2"
              :class="f.ignored ? 'opacity-60' : ''"
            >
              <div class="flex items-center gap-1.5">
                <span class="h-2 w-2 shrink-0 rounded-full" :class="f.severity === 'error' ? 'bg-red-500' : 'bg-amber-500'" />
                <span class="truncate text-xs font-semibold" :title="f.ruleName">{{ f.ruleName }}</span>
                <span class="rounded bg-muted px-1 text-[10px] text-muted-foreground">{{ f.type }}</span>
                <span v-if="f.ignored" class="rounded bg-muted px-1 text-[10px]">已忽略</span>
              </div>
              <p class="mt-1 line-clamp-2 text-xs text-muted-foreground" :title="f.message">{{ f.message }}</p>
              <div class="mt-1 flex flex-wrap gap-1">
                <button
                   v-for="c in chipsFor(f)"
                  :key="c.index"
                  :data-testid="`ir-editor-goto-${c.index}`"
                  class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] hover:bg-accent"
                  :title="`定位到第 ${c.index + 1} 段`"
                  @click="$emit('locate', c.index)"
                >{{ c.label }}</button>
              </div>
              <div class="mt-1.5 flex items-center gap-1.5">
                <template v-if="!f.ignored">
                  <el-button v-if="f.fix" :data-testid="`ir-editor-fix-${f.ruleId}`" type="primary" size="small" @click="$emit('fix-toggle', f.ruleId)">自动修复</el-button>
                  <el-button v-else :data-testid="`ir-editor-locate-${f.ruleId}`" text size="small" @click="$emit('locate', f.involvedIndexes[0] ?? 0)">定位</el-button>
                  <el-button :data-testid="`ir-editor-ignore-${f.ruleId}`" text size="small" @click="$emit('ignore', f)">忽略</el-button>
                </template>
                <el-button v-else text size="small" @click="$emit('unignore', f)">取消忽略</el-button>
              </div>
              <div v-if="fixingId === f.ruleId && f.fix && !f.ignored" class="mt-1.5 rounded-md border bg-muted/30 p-2">
                <p class="text-[11px]">{{ f.fix.reason }}</p>
                <div class="mt-1 flex flex-wrap gap-1">
                  <span class="text-[11px] text-muted-foreground">将移除：</span>
                   <span v-for="c in fixChips(f).remove" :key="c.index" class="rounded border border-destructive/50 px-1.5 py-0.5 font-mono text-[10px] text-destructive">{{ c.label }}</span>
                </div>
                <div class="mt-1 flex flex-wrap gap-1">
                  <span class="text-[11px] text-muted-foreground">将保留：</span>
                   <span v-for="c in fixChips(f).keep" :key="c.index" class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{{ c.label }}</span>
                </div>
                <div class="mt-1.5 flex justify-end gap-1.5">
                  <el-button text size="small" @click="$emit('fix-cancel')">取消</el-button>
                  <el-button :data-testid="`ir-editor-fix-confirm-${f.ruleId}`" :type="f.severity === 'error' ? 'danger' : 'primary'" size="small" @click="$emit('fix-confirm', f)">{{ f.severity === 'error' ? `仍要应用（将清空 ${f.fix.removeIndexes.length} 段）` : '确认应用' }}</el-button>
                </div>
              </div>
            </li>
          </ul>
        </el-scrollbar>
      </div>
      <div v-else class="flex min-h-0 flex-1 flex-col">
        <RuleListPanel :dimensions="ruleDims" :modules-by-dim-id="ruleModulesByDimId" />
      </div>
    </div>
  </section>
</template>
