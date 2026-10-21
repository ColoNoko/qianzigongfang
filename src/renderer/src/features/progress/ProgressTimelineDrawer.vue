<script setup lang="ts">
import { STATISTICS_TIME_LABELS } from '@shared/statistics-time'
import { Sheet, SheetContent, SheetTitle } from '@renderer/components/ui/sheet'
import { Button as UiButton } from '@renderer/components/ui/button'
/**
 * 「时间线」抽屉（2026-10-05 从并行分支 T8 移植的**分组版**）。
 *
 * 与旧版的差别只有一件事，但观感差很多：旧版是"一条 = 某天 × 某话 × 某职责"的**摊平列表**
 * （一本漫画一天做了 12 话就是 12 行）；现在按 **某天 × 某漫画 × 某职责** 合并成一组，
 * 组里用原生 `<details>/<summary>` 展开各话明细 —— 例如「老师的人偶 / 监修完成 · 合集 12 集 · 130 张」。
 *
 * 口径与分组全在 `@shared/progress`（`groupTimelineEvents`，纯函数、有单测）；
 * 抽屉只负责画。数据**不从抽屉自己拉**（`events` 由进度页算好传进来）。
 * 职责四色（蓝嵌字 / 绿翻译 / 琥珀校对 / 紫监修）配「嵌、翻、校、监」文字标志 ——
 * 不靠颜色单独区分；深浅主题各有一套可读色。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { WORK_MODES, WORK_MODE_LABELS, WORK_MODE_SHORT_LABELS } from '@shared/modes'
import {
  groupTimelineEvents,
  timelineDayLabel,
  type ProgressTimelineEvent,
  type ProgressTimelineGroup
} from '@shared/progress'
import InfoHint from '@renderer/components/InfoHint.vue'

const props = withDefaults(
  defineProps<{
    open?: boolean
    events: ProgressTimelineEvent[]
    emptyHint?: string
  }>(),
  { open: false, emptyHint: '还没有任何标记记录。' }
)
const emit = defineEmits<{ (e: 'close'): void }>()
const now = ref(Date.now())
const panel = ref<HTMLElement>()
let opener: HTMLElement | null = null
const groups = computed(() => groupTimelineEvents(props.events))
const days = computed(() => {
  const result = new Map<number, ProgressTimelineGroup[]>()
  for (const group of groups.value) {
    const rows = result.get(group.day) ?? []
    rows.push(group)
    result.set(group.day, rows)
  }
  return [...result].map(([at, rows]) => ({ at, rows, label: timelineDayLabel(at, now.value) }))
})
watch(
  () => props.open,
  async (open) => {
    if (open) {
      now.value = Date.now()
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      panel.value
        ?.querySelector<HTMLButtonElement>('[data-testid="progress-timeline-close"]')
        ?.focus()
    } else opener?.focus()
  },
  { immediate: true }
)
function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') emit('close')
  if (event.key !== 'Tab') return
  const controls = [
    ...(panel.value?.querySelectorAll<HTMLElement>('button, summary, [tabindex="0"]') ?? [])
  ].filter((element) => element.getClientRects().length > 0)
  const first = controls[0],
    last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (props.open) opener?.focus()
})
</script>

<template>
  <Sheet :open="true" @update:open="!$event && (emit('close'))" v-if="open">
    <SheetContent
      ref="panel"
      class="drawer-panel-in timeline-panel flex h-full w-[480px] max-w-[92vw] flex-col border-l border-border bg-card-bg text-text-primary shadow-[var(--shadow-3)]"
      data-testid="progress-timeline-drawer"
     :show-close="false" :aria-describedby="undefined">
      <header class="flex items-center gap-2 border-b border-border px-5 py-3">
        <SheetTitle class="text-[15px] font-semibold">时间线</SheetTitle>
        <InfoHint label="时间线统计说明"
          >同一天、同一漫画、同一职责合并展示，点击记录展开章节明细。张数按所选统计日期归属汇总；合集集数表示当天涉及的章节数，不代表这些章节已全部完成。实线连接当日记录，虚线分隔日期。最多显示最近
          80 组。</InfoHint
        >
        <span class="text-xs text-text-secondary">最近 {{ groups.length }} 组</span>
        <UiButton variant="ghost" size="sm"
          type="button"
          class="ml-auto flex w-7 shrink-0 items-center justify-center transition-colors"
          aria-label="关闭"
          data-testid="progress-timeline-close"
          @click="emit('close')"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </UiButton>
      </header>
      <div
        class="flex flex-wrap gap-x-4 gap-y-2 border-b border-border px-5 py-3 text-xs"
        aria-label="职责图例"
      >
        <span
          v-for="mode in WORK_MODES"
          :key="mode"
          :data-mode="mode"
          class="timeline-role flex items-center gap-1.5"
        >
          <span class="role-mini" aria-hidden="true">{{ WORK_MODE_SHORT_LABELS[mode] }}</span
          >{{ WORK_MODE_LABELS[mode] }}
        </span>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-testid="progress-timeline-list">
        <p v-if="!days.length" class="py-8 text-center text-sm text-text-secondary">
          {{ emptyHint }}
        </p>
        <section v-for="day in days" :key="day.at" class="timeline-day" :aria-label="day.label">
          <h3 class="mb-2 flex items-center gap-2 text-xs font-semibold text-text-secondary">
            <span class="day-node" aria-hidden="true" />{{ day.label }}
            <span class="font-normal text-text-tertiary">{{
              new Date(day.at).toLocaleDateString('zh-CN')
            }}</span>
          </h3>
          <div class="timeline-track">
            <details
              v-for="row in day.rows"
              :key="row.key"
              class="timeline-record timeline-role"
              :data-mode="row.mode"
              data-testid="progress-timeline-item"
            >
              <summary class="timeline-summary">
                <span class="role-node" aria-hidden="true">{{
                  WORK_MODE_SHORT_LABELS[row.mode]
                }}</span>
                <span class="sr-only">{{ day.label }} </span>
                <span class="min-w-0 flex-1">
                  <span class="block break-words text-sm font-semibold text-text-primary">{{
                    row.parentTitle
                  }}</span>
                  <span class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span class="role-label">{{ WORK_MODE_LABELS[row.mode] }}完成</span>
                    <span class="text-text-secondary">{{
                      row.chapters.length > 1
                        ? `合集 ${row.chapters.length} 集`
                        : row.chapters[0].chapterNumber
                    }}</span>
                    <span class="font-semibold tabular-nums text-text-primary"
                      >{{ row.fileCount }} 张</span
                    >
                  </span>
                </span>
                <svg
                  class="timeline-chevron"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  aria-hidden="true"
                >
                  <path d="m6 3 5 5-5 5" />
                </svg>
              </summary>
              <ul class="chapter-details" aria-label="章节明细">
                <li
                  v-for="(chapter, index) in row.chapters"
                  :key="chapter.childId ?? index"
                  class="flex min-w-0 justify-between gap-3 py-1 text-xs"
                >
                  <span class="break-words text-text-secondary">{{ chapter.chapterNumber }}<span class="ml-2 text-[10px] text-muted-foreground">{{ chapter.timeSources?.map(source => STATISTICS_TIME_LABELS[source]).join(' / ') }}{{ chapter.chapterCompleted ? ' · 本话完成' : '' }}</span></span>
                  <span class="shrink-0 tabular-nums text-text-primary"
                    >{{ chapter.fileCount }} 张</span
                  >
                </li>
              </ul>
            </details>
          </div>
        </section>
      </div>
    </SheetContent>
  </Sheet>
</template>

<style scoped>
/* 四色取自 tokens.css 的 `--role-*`（2026-10-05）：侧栏的职责胶囊要用同一套色，
   所以色值收成 token、这里只留"哪个模式用哪个 token"。
   日/夜两档由 token 自己切换 —— 原来那 4 条 `:global([data-theme='dark'] ...)` 覆盖随之删掉。 */
.timeline-role {
  --role-color: var(--role-supervised);
}
.timeline-role[data-mode='typeset'] {
  --role-color: var(--role-typeset);
}
.timeline-role[data-mode='translated'] {
  --role-color: var(--role-translated);
}
.timeline-role[data-mode='proofread'] {
  --role-color: var(--role-proofread);
}
.role-mini,
.role-node {
  color: var(--role-color);
  border: 1px solid currentColor;
  background: var(--card-bg);
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
/* ⚠️ 圆角一律走 token（2026-10-07）：这里是全仓最后一处 scoped 字面量圆角。
   四个里三个有等价 token（8px = --radius-md，6px = --radius-badge），
   19px 的小徽标从 5px 归到 --radius-badge(6px)（差 1px，肉眼不可分）。
   `border-radius: 50%` 保留 —— 那是"画成圆"的几何，不是圆角档位，没有对应 token。 */
.role-mini {
  width: 19px;
  height: 19px;
  border-radius: var(--radius-badge);
  font-size: 10px;
}
.role-node {
  position: absolute;
  left: -39px;
  top: 8px;
  width: 27px;
  height: 27px;
  border-radius: var(--radius-md);
  font-size: 12px;
}
.role-label {
  color: var(--role-color);
  font-weight: 600;
}
.day-node {
  width: 9px;
  height: 9px;
  margin-left: 9px;
  margin-right: 10px;
  border: 2px solid var(--text-tertiary);
  /* 见文件上方那段注释：50% 是"画成圆"，不归圆角档位管辖。 */
  border-radius: 50%;
  background: var(--card-bg);
}
.timeline-day + .timeline-day {
  position: relative;
  margin-top: 16px;
}
.timeline-day + .timeline-day::before {
  content: '';
  position: absolute;
  left: 13px;
  top: -16px;
  height: 12px;
  border-left: 1px dashed var(--border-strong);
}
.timeline-track {
  margin-left: 13px;
  padding-left: 24px;
  border-left: 2px solid var(--border-strong);
}
.timeline-record {
  position: relative;
  padding-bottom: 4px;
}
.timeline-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: var(--radius-badge);
  list-style: none;
  cursor: pointer;
}
.timeline-summary::-webkit-details-marker {
  display: none;
}
.timeline-summary:hover {
  background: var(--card-bg-hover);
}
.timeline-summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.timeline-chevron {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-tertiary);
}
.timeline-record[open] .timeline-chevron {
  transform: rotate(90deg);
}
.chapter-details {
  margin: 0 8px;
  padding: 0 0 2px 12px;
  border-left: 1px dashed var(--role-color);
}
</style>
