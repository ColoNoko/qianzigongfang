<script setup lang="ts">
// 「时间线」抽屉（2026-10-03）—— 进度页工具条上那枚按钮点开，从**右侧**滑出。
//
// 为什么是抽屉不是弹窗：它跟列表是**同一件事的两个视角**（欠账 / 回顾），
// 遮罩下留着列表能让人随时切回来；而项目里既有的弹窗（台账 / 备份管理）都是"停下来干活"的模态，
// 语义不同。视觉语言仍照它们那一套（overlay + 卡片 + header + 可滚动主体），零新造。
//
// ⚠️ 数据**不从抽屉自己拉**：`events` 由进度页算好传进来（单一数据源 + 可单测），
// 抽屉只负责画。
// ⚠️ 徽标写的是「最近 N 次」不是「共 N 次」：进度页只传最近 80 条（真实库上标记
// 上千条，全量渲染没必要），写成"共"就是假话。
//
// ⚠️ 动效**不用 `<Transition>`**，用 `styles/index.css` 里那两个 animation 类
// （与页面淡入 `page-in` 同一套写法与 token）。原因见那边的注释：
// 早期版本把位移加在整个遮罩上，结果"背景 + 面板"一起滑 —— 中途左边会露出一条
// 没压暗的区域，看起来就是一道硬边（用户 2026-10-03 截图反馈的"切换痕迹"）。
// 现在：① 背景只做淡入（`drawer-backdrop-in`，快）② 面板只做位移（`drawer-panel-in`，稍慢）。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { WORK_MODE_LABELS } from '@shared/modes'
import { timelineDayLabel, type ProgressTimelineEvent } from '@shared/progress'

const props = withDefaults(
  defineProps<{
    open?: boolean
    events: ProgressTimelineEvent[]
    /** 一条事件都没有时的说明。 */
    emptyHint?: string
  }>(),
  { open: false, emptyHint: '还没有任何标记记录。' }
)

const emit = defineEmits<{ (e: 'close'): void }>()

/** 只算一次"现在"，避免同一屏里两条事件各算各的（跨零点会打架）。 */
const now = ref(Date.now())
/**
 * ⚠️ 日期文案走 `@shared/progress` 的 `timelineDayLabel`（按**自然日**算）——
 * 与数据分桶共用同一处"一天从哪儿开始"，否则会出现"分在两个桶里、却都显示今天"。
 */
const rows = computed(() =>
  props.events.map((event) => ({ ...event, day: timelineDayLabel(event.at, now.value) }))
)

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    v-if="open"
    class="drawer-backdrop-in fixed inset-0 z-50 flex justify-end bg-black/40"
    data-testid="progress-timeline-overlay"
    @click.self="emit('close')"
  >
    <div
      class="drawer-panel-in flex h-full w-[380px] max-w-[92vw] flex-col border-l border-border bg-card-bg text-text-primary shadow-[var(--shadow-3)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="progress-timeline-title"
      data-testid="progress-timeline-drawer"
    >
      <header class="flex items-center gap-3 border-b border-border px-5 py-3">
        <h2 id="progress-timeline-title" class="text-[15px] font-semibold tracking-tight">
          时间线
        </h2>
        <span
          class="shrink-0 rounded-full bg-media-bg px-2 py-0.5 text-[11px] leading-none text-text-tertiary"
        >
          最近 {{ events.length }} 次
        </span>
        <button
          type="button"
          class="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-badge text-text-tertiary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
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
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-testid="progress-timeline-list">
        <p v-if="rows.length === 0" class="py-8 text-center text-[12px] text-text-tertiary">
          {{ emptyHint }}
        </p>

        <div v-else class="flex flex-col gap-3">
          <div
            v-for="(row, index) in rows"
            :key="`${row.at}-${row.parentTitle}-${row.chapterNumber}-${row.mode}-${index}`"
            class="flex items-start gap-2.5"
            data-testid="progress-timeline-item"
          >
            <span
              class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
              :class="index === 0 ? 'bg-accent' : 'bg-border-strong'"
              aria-hidden="true"
            />
            <span class="w-14 shrink-0 text-[11px] leading-5 text-text-tertiary">
              {{ row.day }}
            </span>
            <span class="min-w-0 flex-1 text-[12px] leading-5">
              <span class="font-medium text-text-primary">{{ row.parentTitle }}</span>
              <span class="text-text-secondary"> · {{ row.chapterNumber }}</span>
              <span class="text-text-secondary">
                · {{ WORK_MODE_LABELS[row.mode] }}完成 {{ row.fileCount }} 张
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
