<script setup lang="ts">
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { Button as UiButton } from '@renderer/components/ui/button'
// RestoreMarksDialog — 「从备份还原标记」的确认窗（第十四轮）。
//
// 只做一件事，而且顺序很重要：**先看清楚会变什么，再点确认**。
//   · 打开时向主进程要差异预览（只列会变的行，不猜、也不删东西）；
//   · 确认后由主进程写回 —— 它会在写之前**自动再备份一份当前库**（万一选错了还有回程票），
//     并按台账记一条 `kind='restore'`（连"还原"本身也可追溯）。
import { lastPathSegment } from '@shared/paths'
import { formatDateTime } from '@shared/format'
import { ref, watch } from 'vue'
import type { DbBackupInfo, MarkRestorePreview, MarkWriteBackResult } from '@shared/ipc-api'

const props = defineProps<{ open: boolean; backup: DbBackupInfo | null }>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'restored', result: MarkWriteBackResult): void
  (e: 'toast', payload: { type: 'success' | 'warning' | 'error'; message: string }): void
}>()

const loading = ref(false)
const applying = ref(false)
const error = ref('')
const preview = ref<MarkRestorePreview | null>(null)

function timeText(at: number): string {
  return formatDateTime(at)
}

async function load(): Promise<void> {
  const backup = props.backup
  if (!backup) return
  loading.value = true
  error.value = ''
  preview.value = null
  try {
    preview.value = await window.comicType.dbBackupRestorePreview(backup.path)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

async function apply(): Promise<void> {
  const backup = props.backup
  if (!backup || applying.value) return
  applying.value = true
  try {
    const result = await window.comicType.dbBackupRestoreApply(backup.path)
    emit('restored', result)
    emit('toast', {
      type: result.revertedFiles > 0 ? 'success' : 'warning',
      message:
        result.revertedFiles > 0
          ? `已从备份还原 ${result.revertedFiles} 个文件的标记（${result.childIds.length} 话）`
          : '这份备份与当前标记一致，没有需要还原的行'
    })
    emit('close')
  } catch (reason) {
    emit('toast', {
      type: 'error',
      message: `还原失败：${reason instanceof Error ? reason.message : String(reason)}`
    })
  } finally {
    applying.value = false
  }
}

watch(
  () => [props.open, props.backup?.path] as const,
  ([open]) => {
    if (open) void load()
  },
  { immediate: true }
)
</script>

<template>
  <Dialog :open="true" @update:open="!$event && (emit('close'))" v-if="open">
    <DialogContent
      class="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card-bg text-text-primary shadow-[var(--shadow-3)]"
      data-testid="restore-marks-dialog"
     :show-close="false" :aria-describedby="undefined">
      <header class="flex items-center gap-3 border-b border-border px-5 py-3">
        <DialogTitle class="text-[15px] font-semibold tracking-tight">
          从备份还原标记
        </DialogTitle>
        <span class="min-w-0 flex-1 truncate text-[12px] text-text-tertiary">
          {{ backup?.file }} · {{ backup ? timeText(backup.at) : '' }}
        </span>
        <UiButton variant="ghost" size="sm"
          type="button"
          class="flex w-7 shrink-0 items-center justify-center transition-colors"
          aria-label="关闭"
          data-testid="restore-marks-close"
          @click="emit('close')"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </UiButton>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-3" data-testid="restore-marks-body">
        <p v-if="loading" class="py-8 text-center text-sm text-text-tertiary">正在比对…</p>
        <p v-else-if="error" class="py-8 text-center text-sm text-danger">{{ error }}</p>
        <template v-else-if="preview">
          <p class="text-[13px] text-text-primary">
            会把
            <span class="font-semibold text-accent">{{ preview.changingFiles }}</span><span v-if="preview.statisticsTimeChanges" class="ml-2">另有 {{ preview.statisticsTimeChanges }} 项统计时间调整</span>
            个文件的标记改回这份备份时的样子。
          </p>
          <p
            v-if="preview.missingInBackup > 0 || preview.missingInCurrent > 0"
            class="mt-1 text-[12px] text-text-tertiary"
          >
            另有 {{ preview.missingInBackup }} 个文件是备份之后才出现的、
            {{ preview.missingInCurrent }} 个只在备份里有 —— 这些一律不动。
          </p>
          <p v-if="preview.changingFiles === 0 && !preview.statisticsTimeChanges" class="mt-1 text-[12px] text-text-tertiary">
            这份备份与当前标记一致，没什么可还原的。
          </p>

          <ul class="mt-3 flex flex-col gap-2">
            <li
              v-for="child in preview.children.filter((item) => item.changingCount > 0)"
              :key="child.childId"
              class="rounded-lg border border-border bg-app-bg px-3 py-2"
              data-testid="restore-marks-child"
            >
              <p class="text-[12px] font-medium text-text-secondary">
                {{ lastPathSegment(child.folderPath, child.folderPath) }}
                <span class="text-text-tertiary">（{{ child.changingCount }} 个文件）</span>
              </p>
              <ul class="mt-0.5">
                <li
                  v-for="(line, index) in child.sample"
                  :key="index"
                  class="text-[12px] text-text-primary"
                >
                  {{ line }}
                </li>
                <li v-if="child.changingCount > child.sample.length" class="text-[12px] text-text-tertiary">
                  还有 {{ child.changingCount - child.sample.length }} 行…
                </li>
              </ul>
            </li>
          </ul>
        </template>
      </div>

      <footer class="flex items-center gap-2 border-t border-border px-5 py-3">
        <p class="min-w-0 flex-1 text-[11px] text-text-tertiary">
          写回之前会自动再备份一份当前库，出问题还能回来；还原动作本身也会记进标记记录。
        </p>
        <UiButton variant="outline" size="sm"
          type="button"
          class="shrink-0 transition-colors"
          @click="emit('close')"
        >
          取消
        </UiButton>
        <UiButton variant="default" size="sm"
          type="button"
          class="shrink-0 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!preview || preview.changingFiles === 0 && !preview.statisticsTimeChanges || applying"
          data-testid="restore-marks-apply"
          @click="apply"
        >
          {{ applying ? '还原中…' : '确认还原' }}
        </UiButton>
      </footer>
    </DialogContent>
  </Dialog>
</template>
