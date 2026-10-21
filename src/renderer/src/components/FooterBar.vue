<script setup lang="ts">
// FooterBar — 24px progress strip rendered inside its parent container.
// Shows the chapter progress for the currently selected work mode as a fill
// over a grey track, with centered text:
//
//   嵌字进度 <n>/<m>     (mode = typeset, the default)
//   翻译进度 <n>/<m>     (mode = translated, …)
//
// Edge cases:
//   pct === null (total === 0) → grey track only, text "无文件"
//   pct === 0                  → grey track only, full verbatim text
//   pct > 0                    → fill width = pct%, text remains theme text color
import { computed } from 'vue'
import { Progress } from './ui/progress'
import type { ChapterProgress, WorkMode } from '@shared/types'
import { WORK_MODE_LABELS } from '@shared/modes'

const props = withDefaults(
  defineProps<{ progress: ChapterProgress; mode?: WorkMode }>(),
  // Defaulting to typeset keeps the historical "嵌字进度 n/m" label for every
  // caller that does not know about modes.
  { mode: 'typeset' }
)

// Whether the accent fill should render (only when there is actual progress).
// When false the bar is a flat grey track.
const hasFill = computed(() => (props.progress.pct ?? 0) > 0)

// Inline width style for the accent overlay — pct% of the track width.

// Centered label. The "无文件" fallback only applies when there are no PSDs
// at all (pct === null).
const label = computed(() => {
  const { done, total, pct } = props.progress
  if (pct === null) return '无文件'
  return `${WORK_MODE_LABELS[props.mode]}进度 ${done}/${total}`
})
</script>

<template>
  <div class="flex h-full w-full items-center gap-3" role="status" :aria-label="label">
    <!-- 注意：本文件的注释必须留在根元素**里面** —— 根节点前面挂一个注释节点会让
         组件变成多根 fragment，wrapper.classes() 直接返回 []（这条踩过一次）。 -->
    <!-- 布局是"标签在左、胶囊条在右"。旧版把「嵌字进度 n/m」居中压在**实心填充色**
         上：进度一旦超过约 20%，两端字符就落到填充上，实测对比度只有 2.51:1（日间）
         / 2.78:1（夜间）—— 越接近完成越看不清。文字移出条外后是 14.6:1 / 10.9:1，
         且组件对外文案（`嵌字进度 3/7`，FooterBar.spec 是 toBe）一个字节都没变：
         条本身没有文字。 -->
    <span
      class="shrink-0 whitespace-nowrap text-[12px] leading-none"
      :class="hasFill ? 'text-text-primary' : 'text-text-tertiary'"
    >
      {{ label }}
    </span>

    <!-- 轨道（中性底，永远不用强调色）+ 完成色填充 -->
    <Progress :model-value="progress.pct ?? 0" :aria-label="label" class="h-1.5 min-w-0 flex-1 bg-media-bg" />
  </div>
</template>
