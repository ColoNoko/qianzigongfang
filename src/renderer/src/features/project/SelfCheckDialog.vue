<script setup lang="ts">
import { computed } from 'vue'
import type { SelfCheckPreviewResult } from '@shared/ipc-api'

const props = withDefaults(
  defineProps<{
    visible: boolean
    busy: boolean
    running: boolean
    preview: SelfCheckPreviewResult | null
    sourceRoot: string
    conflictActions: Record<string, 'skip' | 'second-version'>
    neverAsk: boolean
    silentSelfCheck: boolean
  }>(),
  {
    preview: null,
    sourceRoot: '',
    conflictActions: () => ({}),
    neverAsk: false,
    silentSelfCheck: false
  }
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pickDirectory'): void
  (e: 'runWithSource', remember: boolean): void
  (e: 'setConflictAction', folderPath: string, action: 'skip' | 'second-version'): void
  (e: 'update:neverAsk', value: boolean): void
  (e: 'confirm'): void
}>()

const candidates = computed(() => props.preview?.candidates ?? [])
const canDetect = computed(() => props.preview?.canDetect ?? false)
const hasConflict = computed(() =>
  candidates.value.some((candidate) => candidate.conflict === 'same-chapter')
)
const hasUnresolvedConflict = computed(() =>
  candidates.value.some(
    (candidate) =>
      candidate.conflict === 'same-chapter' && !props.conflictActions[candidate.folderPath]
  )
)

function onNeverAskChange(event: Event): void {
  emit('update:neverAsk', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
    data-testid="self-check-modal"
    @click.self="emit('close')"
  >
    <div
      class="max-h-[80vh] w-full max-w-lg overflow-auto rounded-xl border border-border bg-card-bg shadow-[var(--shadow-3)]"
    >
      <div class="flex items-center justify-between border-b border-border px-5 py-3">
        <h3 class="text-sm font-bold text-text-primary">刷新并检测新章节</h3>
        <button
          type="button"
          class="rounded px-2 py-0.5 text-text-tertiary hover:bg-card-bg-hover hover:text-text-primary disabled:opacity-40"
          :disabled="busy || running"
          aria-label="关闭"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <div class="space-y-4 px-5 py-4">
        <div v-if="busy || running" class="py-8 text-center text-sm text-text-secondary">
          正在检测并处理…
        </div>

        <template v-else-if="!preview || !canDetect">
          <div>
            <p class="text-sm text-text-secondary">
              {{ preview?.message || '无法自动确定父级目录，请手动选择一次。' }}
            </p>
            <div class="mt-3 flex flex-col gap-2">
              <button
                type="button"
                class="rounded-badge border border-border bg-card-bg px-3 py-2 text-sm text-text-primary transition-colors hover:bg-card-bg-hover"
                data-testid="pick-self-check-source"
                @click="emit('pickDirectory')"
              >
                {{ sourceRoot ? '重新选择目录…' : '选择目录…' }}
              </button>
              <p v-if="sourceRoot" class="break-all text-xs text-text-tertiary">
                {{ sourceRoot }}
              </p>
              <div v-if="sourceRoot" class="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-badge border border-border bg-card-bg px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary active:bg-card-bg-pressed"
                  data-testid="self-check-use-once"
                  @click="emit('runWithSource', false)"
                >
                  仅本次检测
                </button>
                <button
                  type="button"
                  class="rounded-badge bg-accent px-3 py-1.5 text-sm text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active"
                  data-testid="self-check-remember-source"
                  @click="emit('runWithSource', true)"
                >
                  记住此目录并检测
                </button>
              </div>
            </div>
          </div>
        </template>

        <template v-else>
          <div>
            <p class="text-sm text-text-primary">
              检测到 <strong>{{ candidates.length }}</strong> 个新章节。
            </p>
            <!-- 扫描目录必须可见。自动检测成功时以前**不显示**扫的是哪个目录，
                 所以"扫到了上一层分类目录"这件事可以一直瞒着用户 —— 那一话
                 的子项目分散在 无/有 两个目录里时就会踩到。 -->
            <ul
              v-if="preview?.sourceRoots?.length"
              class="mt-1 space-y-0.5"
              data-testid="self-check-roots"
            >
              <li
                v-for="root in preview.sourceRoots"
                :key="root"
                class="break-all text-xs text-text-tertiary"
              >
                {{ root }}<span v-if="preview.unreadableRoots?.includes(root)">（读不到）</span>
              </li>
            </ul>
          </div>

          <div
            class="max-h-64 space-y-2 overflow-auto rounded-lg border border-border bg-app-bg p-2"
          >
            <div
              v-for="candidate in candidates"
              :key="candidate.folderPath"
              class="rounded-md border border-border bg-card-bg p-2"
            >
              <div class="flex items-center justify-between gap-3">
                <span class="min-w-0 truncate text-sm font-medium text-text-primary">
                  {{ candidate.folderName }}
                </span>
                <span class="shrink-0 text-xs text-text-tertiary">
                  {{ candidate.chapterNumber || '未识别集数' }}
                </span>
              </div>

              <div v-if="candidate.conflict === 'same-chapter'" class="mt-2 space-y-1 text-xs">
                <p class="text-text-secondary">同父级下已存在该集数，请选择处理方式：</p>
                <label class="flex cursor-pointer items-center gap-2 text-text-primary">
                  <input
                    type="radio"
                    :name="`self-check-conflict-${candidate.folderPath}`"
                    :checked="conflictActions[candidate.folderPath] === 'second-version'"
                    data-testid="conflict-second-version"
                    @change="emit('setConflictAction', candidate.folderPath, 'second-version')"
                  />
                  导入为第二版本（章节号自动加后缀）
                </label>
                <label class="flex cursor-pointer items-center gap-2 text-text-primary">
                  <input
                    type="radio"
                    :name="`self-check-conflict-${candidate.folderPath}`"
                    :checked="conflictActions[candidate.folderPath] === 'skip'"
                    data-testid="conflict-skip"
                    @change="emit('setConflictAction', candidate.folderPath, 'skip')"
                  />
                  跳过
                </label>
              </div>
            </div>
          </div>

          <div
            v-if="hasUnresolvedConflict"
            class="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning"
          >
            还有同集数冲突未选择，请选择“导入为第二版本”或“跳过”。
          </div>

          <label
            v-if="!silentSelfCheck && !hasConflict"
            class="flex cursor-pointer items-center gap-2 text-xs text-text-secondary"
          >
            <input
              type="checkbox"
              :checked="neverAsk"
              data-testid="self-check-never-ask"
              @change="onNeverAskChange"
            />
            下次不再询问，直接导入无冲突新章节
          </label>
        </template>
      </div>

      <div
        v-if="!busy && !running && canDetect && candidates.length > 0"
        class="flex justify-end gap-2 border-t border-border px-5 py-3"
      >
        <button
          type="button"
          class="rounded-badge border border-border bg-card-bg px-4 py-1.5 text-sm text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary active:bg-card-bg-pressed"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          type="button"
          class="rounded-badge bg-accent px-4 py-1.5 text-sm text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="hasUnresolvedConflict"
          data-testid="confirm-self-check-import"
          @click="emit('confirm')"
        >
          导入
        </button>
      </div>
    </div>
  </div>
</template>
