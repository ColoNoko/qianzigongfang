<script setup lang="ts">
// 「备份管理」弹窗（第二十三轮）—— 设置页里那条只摆最新 3 条的列表，全部搬到这里。
//
// 为什么不就地展开：保留策略是主进程的 `KEEP_BACKUPS = 20`，那块列表迟早 20 行（每行约 44px
// ⇒ 约 880px），会把设置页长期撑长；而同一张卡里已经有「标记记录 / 诊断 / 还原标记」三个弹窗，
// 弹窗本来就是这里既有的语言。
//
// 外壳照抄 `MarkHistoryDialog`（同一套 overlay / 卡片 / header / 可滚动主体），零新视觉语言。
// ⚠️ 数据**不从弹窗自己拉**：`items` 由设置页传进来（单一数据源），刷新只 emit 回去 ——
// 否则「卡里 3 条」和「弹窗里 20 条」会各说各话。
import type { DbBackupInfo } from '@shared/ipc-api'
import DbBackupList from './DbBackupList.vue'

defineProps<{ items: DbBackupInfo[] }>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'refresh'): void
  (e: 'restore', item: DbBackupInfo): void
}>()
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
    data-testid="db-backup-manager-overlay"
    @click.self="emit('close')"
  >
    <div
      class="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card-bg text-text-primary shadow-[var(--shadow-3)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="db-backup-manager-title"
      data-testid="db-backup-manager-dialog"
    >
      <header class="flex items-center gap-3 border-b border-border px-5 py-3">
        <h2 id="db-backup-manager-title" class="text-[15px] font-semibold tracking-tight">
          备份管理
        </h2>
        <span
          class="shrink-0 rounded-full bg-media-bg px-2 py-0.5 text-[11px] leading-none text-text-tertiary"
        >
          共 {{ items.length }} 份
        </span>
        <button
          type="button"
          class="ml-auto flex h-7 items-center rounded-badge px-2 text-[12px] text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
          data-testid="db-backup-manager-refresh"
          @click="emit('refresh')"
        >
          刷新
        </button>
        <button
          type="button"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-badge text-text-tertiary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
          aria-label="关闭"
          data-testid="db-backup-manager-close"
          @click="emit('close')"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-4" data-testid="db-backup-manager-list">
        <DbBackupList :items="items" @restore="emit('restore', $event)" />
      </div>
    </div>
  </div>
</template>
