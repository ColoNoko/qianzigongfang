<script setup lang="ts">
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { Button as UiButton } from '@renderer/components/ui/button'
import UiInput from '@renderer/components/ui/ControlInput.vue'
// MarkHistoryDialog — 标记台账（第十四轮）。
//
// 存在的理由见 shared/mark-audit.ts：这个项目真的丢过标记，而当时唯一的证据是
// 出事前的整库快照。现在每次写入都留痕，于是"到底是谁在什么时候改了什么"
// 可以当场查清，而且**每一条都能一键还原**（按台账把模式与时间戳精确写回）。
//
// 只做展示与触发：写库在主进程按台账完成（同一个事务），这里不拼 SQL、不猜旧值。
import { lastPathSegment } from '@shared/paths'
import { formatDateTime } from '@shared/format'
import { computed, ref, watch } from 'vue'
import {
  describeMarkEntry,
  isUndoableOperation,
  summarizeMarkOperation,
  type MarkAuditOperation
} from '@shared/mark-audit'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'

const props = withDefaults(
  defineProps<{
    open: boolean
    /** 给了就提供「只看当前话」开关（工作台传当前话；设置页不传）。 */
    childId?: string
  }>(),
  { childId: '' }
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'changed', childIds: string[]): void
  (e: 'toast', payload: { type: 'success' | 'warning' | 'error'; message: string }): void
}>()

const workspace = useProjectWorkspace()
const loading = ref(false)
const error = ref('')
const operations = ref<MarkAuditOperation[]>([])
const expanded = ref<Set<string>>(new Set())
const onlyCurrentChild = ref(false)
const undoing = ref('')

/** 已经被撤销过的操作（按后面的 `kind='undo'` 的 refOpId 认）。 */
const undoneOpIds = computed(
  () =>
    new Set(
      operations.value
        .filter((operation) => operation.kind === 'undo' && operation.refOpId)
        .map((operation) => operation.refOpId as string)
    )
)

const visibleOperations = computed(() =>
  onlyCurrentChild.value && props.childId
    ? operations.value.filter(
        (operation) =>
          operation.children.some((child) => child.childId === props.childId) ||
          (operation.kind === 'undo' && operation.refOpId)
      )
    : operations.value
)

function folderName(folderPath: string): string {
  return lastPathSegment(folderPath, folderPath)
}

function timeText(at: number): string {
  return formatDateTime(at)
}

function kindTag(operation: MarkAuditOperation): { label: string; className: string } {
  switch (operation.kind) {
    // ⚠️ 淡彩底（`-soft`）上的字必须用 `-on-soft`，**不能用 `-fg`**：
    // `-fg` 是"压实心色块"的字（98% 亮度），压在 94% 亮度的 `-soft` 上只有 1.07:1，
    // 昼夜两个主题都读不出字（2026-10-07 修）。详见 styles/tokens.css 那段注释。
    case 'undo':
      return { label: '撤销', className: 'bg-warning-soft text-warning-on-soft' }
    case 'restore':
      return { label: '还原', className: 'bg-info-soft text-info-on-soft' }
    case 'migrate':
      return { label: '迁移', className: 'bg-media-bg text-text-tertiary' }
    default:
      return operation.targetStatus === 'done'
        ? { label: '标记', className: 'bg-primary-soft text-accent' }
        : { label: '取消', className: 'bg-media-bg text-text-secondary' }
  }
}

function toggle(opId: string): void {
  const next = new Set(expanded.value)
  if (next.has(opId)) next.delete(opId)
  else next.add(opId)
  expanded.value = next
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    operations.value = await workspace.listMarkAudit(200)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

async function undo(operation: MarkAuditOperation): Promise<void> {
  undoing.value = operation.opId
  try {
    const result = await workspace.undoMarkOperation(operation.opId)
    if (!result) {
      emit('toast', { type: 'error', message: '撤销失败：主进程没有响应' })
      return
    }
    emit('toast', {
      type: result.revertedFiles > 0 ? 'success' : 'warning',
      message:
        result.revertedFiles > 0
          ? `已还原 ${result.revertedFiles} 个文件（${result.childIds.length} 话）`
          : '这条操作没有需要还原的改动'
    })
    emit('changed', result.childIds)
    await load()
  } catch (reason) {
    emit('toast', {
      type: 'error',
      message: `撤销失败：${reason instanceof Error ? reason.message : String(reason)}`
    })
  } finally {
    undoing.value = ''
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      expanded.value = new Set()
      void load()
    }
  },
  { immediate: true }
)
</script>

<template>
  <Dialog :open="true" @update:open="!$event && (emit('close'))" v-if="open">
    <DialogContent
      class="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card-bg text-text-primary shadow-[var(--shadow-3)]"
      data-testid="mark-history-dialog"
     :show-close="false" :aria-describedby="undefined">
      <header class="flex items-center gap-3 border-b border-border px-5 py-3">
        <DialogTitle class="text-[15px] font-semibold tracking-tight">
          标记记录
        </DialogTitle>
        <span class="shrink-0 rounded-full bg-media-bg px-2 py-0.5 text-[11px] leading-none text-text-tertiary">
          最近 {{ operations.length }} 次操作
        </span>
        <label
          v-if="childId"
          class="ml-2 flex cursor-pointer items-center gap-1.5 text-[12px] text-text-secondary"
        >
          <UiInput
            v-model="onlyCurrentChild"
            type="checkbox"
            class="accent-[var(--accent)]"
            data-testid="mark-history-only-current"
          />
          只看当前话
        </label>
        <UiButton variant="ghost" size="sm"
          type="button"
          class="ml-auto flex items-center transition-colors"
          data-testid="mark-history-refresh"
          @click="load"
        >
          刷新
        </UiButton>
        <UiButton variant="ghost" size="sm"
          type="button"
          class="flex w-7 shrink-0 items-center justify-center transition-colors"
          aria-label="关闭"
          data-testid="mark-history-close"
          @click="emit('close')"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </UiButton>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-3" data-testid="mark-history-list">
        <p v-if="loading" class="py-8 text-center text-sm text-text-tertiary">读取台账中…</p>
        <p v-else-if="error" class="py-8 text-center text-sm text-danger">{{ error }}</p>
        <p
          v-else-if="visibleOperations.length === 0"
          class="py-8 text-center text-sm text-text-tertiary"
        >
          还没有任何标记记录。从这一版起，每一次标记（含批量）都会留痕。
        </p>

        <ul v-else class="flex flex-col gap-2">
          <li
            v-for="operation in visibleOperations"
            :key="operation.opId"
            class="rounded-lg border border-border bg-app-bg"
            data-testid="mark-history-item"
          >
            <div class="flex items-center gap-2 px-3 py-2">
              <span
                class="shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-none"
                :class="kindTag(operation).className"
              >
                {{ kindTag(operation).label }}
              </span>
              <span class="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                {{ summarizeMarkOperation(operation) }}
              </span>
              <span
                v-if="undoneOpIds.has(operation.opId)"
                class="shrink-0 rounded-full bg-media-bg px-2 py-0.5 text-[11px] leading-none text-text-tertiary"
                data-testid="mark-history-undone-tag"
              >
                已撤销
              </span>
              <span class="shrink-0 text-[12px] tabular-nums text-text-tertiary">
                {{ timeText(operation.at) }}
              </span>
              <UiButton variant="ghost" size="sm"
                type="button"
                class="shrink-0 transition-colors"
                :data-testid="`mark-history-expand-${operation.opId}`"
                @click="toggle(operation.opId)"
              >
                {{ expanded.has(operation.opId) ? '收起' : '明细' }}
              </UiButton>
              <UiButton variant="outline" size="sm"
                v-if="isUndoableOperation(operation) && !undoneOpIds.has(operation.opId)"
                type="button"
                class="shrink-0 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="undoing === operation.opId"
                :data-testid="`mark-history-undo-${operation.opId}`"
                @click="undo(operation)"
              >
                还原到这一步之前
              </UiButton>
            </div>

            <div
              v-if="expanded.has(operation.opId)"
              class="border-t border-hairline px-3 py-2"
              data-testid="mark-history-detail"
            >
              <p class="mb-1 text-[11px] text-text-tertiary">
                改动 {{ operation.fileCount }} 个文件
                <span v-if="operation.skippedCount > 0">
                  · 另有 {{ operation.skippedCount }} 个本来就是目标状态（没动）
                </span>
              </p>
              <div v-for="child in operation.children" :key="child.childId" class="mb-2 last:mb-0">
                <p class="text-[12px] font-medium text-text-secondary">
                  {{ folderName(child.folderPath) }}
                </p>
                <ul class="mt-0.5 flex flex-col gap-0.5">
                  <li
                    v-for="entry in child.entries.slice(0, 40)"
                    :key="entry.pathKey"
                    class="truncate text-[12px] text-text-primary"
                    :title="entry.path"
                  >
                    {{ describeMarkEntry(entry) }}
                  </li>
                  <li v-if="child.entries.length > 40" class="text-[12px] text-text-tertiary">
                    还有 {{ child.entries.length - 40 }} 行…
                  </li>
                </ul>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <footer class="border-t border-border px-5 py-2 text-[11px] text-text-tertiary">
        还原只会把「改之前」的标记与时间戳写回去，不会动文件、也不会删任何记录 ——
        还原动作本身也会记一条流水。
      </footer>
    </DialogContent>
  </Dialog>
</template>
