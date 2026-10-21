<script setup lang="ts">
import { Button as UiButton } from '@renderer/components/ui/button'
// 备份列表的**行渲染唯一出处**（第二十三轮）。
//
// 卡片摆「最新 3 条」、弹窗摆「全部」—— 两处是同一份东西，所以只该有一份渲染代码
// （第十八轮 `.settings-title` 那次的教训：一套规则抄两遍，改一处必漏另一处）。
// 「显示几条」是**调用点**的决定，本组件不认识那个数字。
import { formatDateTime, formatMegabytes } from '@shared/format'
import type { DbBackupInfo } from '@shared/ipc-api'

defineProps<{ items: DbBackupInfo[] }>()

const emit = defineEmits<{ (e: 'restore', item: DbBackupInfo): void }>()

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'auto':
      return '自动'
    case 'delivery':
      return '交付前'
    case 'before-restore':
      return '还原前'
    case 'unknown':
      return '来源不明'
    default:
      return '手动'
  }
}

function timeText(at: number): string {
  return formatDateTime(at)
}
</script>

<template>
  <ul v-if="items.length > 0" class="mt-3 flex flex-col gap-1.5" data-testid="db-backup-list">
    <li
      v-for="item in items"
      :key="item.path"
      class="flex items-center gap-2 rounded-lg border border-border bg-app-bg px-3 py-2"
      data-testid="db-backup-item"
    >
      <span class="shrink-0 text-[12px] tabular-nums text-text-secondary">
        {{ timeText(item.at) }}
      </span>
      <span
        class="shrink-0 rounded-full bg-media-bg px-2 py-0.5 text-[11px] leading-none text-text-tertiary"
      >
        {{ reasonLabel(item.reason) }}
      </span>
      <span class="min-w-0 flex-1 truncate text-[12px] text-text-tertiary" :title="item.file">
        {{ item.rows?.['project_memory_files'] ?? 0 }} 条标记记录
      </span>
      <span class="shrink-0 text-[12px] tabular-nums text-text-tertiary">
        {{ formatMegabytes(item.bytes) }} MB
      </span>
      <UiButton variant="outline" size="sm"
        type="button"
        class="shrink-0 transition-colors"
        :data-testid="`db-backup-restore-${item.reason}`"
        @click="emit('restore', item)"
      >
        还原标记
      </UiButton>
    </li>
  </ul>
  <p v-else class="mt-3 text-xs text-text-tertiary" data-testid="db-backup-empty">
    还没有备份。点一次「立即备份」，以后就有回程票了。
  </p>
</template>
