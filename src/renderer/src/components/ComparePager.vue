<script setup lang="ts">
import { Button as UiButton } from '@renderer/components/ui/button'
/**
 * 切页按钮的一枚（P1.1，2026-10-07 抽成组件）。
 *
 * ## 为什么抽出来
 *
 * 这一批要在**两处**用同一枚按钮：
 * · **原图栏**里（`CompareImagePane`）—— 上一页贴本栏左缘、下一页贴本栏右缘（**翻 / 校**态）；
 * · **PSD 栏最右缘**（`CompareViewer`）—— 只在**嵌 / 监**态出现的那枚「下一页」。
 *
 * 本仓的规矩是"**同一条规则只允许一处实现**"：所以标记、可访问名、隐身时不吃鼠标、
 * 键盘聚焦看得见 —— 这些都是**一份**，两处都引用它，而不是各抄一遍。
 *
 * ## 三条不许退的既有保证
 *
 * 1. **平时隐身**（`opacity-0`）+ **`pointer-events-none`**：否则看不见的按钮会吃掉图上的拖拽平移；
 * 2. **键盘 Tab 到它照样显示**（`focus-visible:opacity-100`）—— 键盘用户能看见自己停在哪；
 * 3. **是 40px 圆钮、贴所在容器的边**（位置由调用方给 class：`left-2` / `right-2`）。
 */
withDefaults(
  defineProps<{
    /** `previous` = 上一页（左向箭头）；`next` = 下一页。 */
    kind: 'previous' | 'next'
    /** 鼠标是否在这一枚所属的"显隐区"里。false ⇒ 隐身且不吃鼠标。 */
    visible?: boolean
    /** 定位类 —— 由调用方给（`absolute left-2 top-1/2` 那一套在这里统一）。 */
    positionClass?: string
    /** 给用例用的 testid；两处各不同（否则"点的是哪一枚"会歧义）。 */
    testId?: string
  }>(),
  {
    visible: false,
    positionClass: '',
    testId: ''
  }
)

const emit = defineEmits<{ (e: 'go', kind: 'previous' | 'next'): void }>()

const ARROW: Record<'previous' | 'next', { d: string; label: string }> = {
  previous: { d: 'M15 18l-6-6 6-6', label: '上一页（键盘 ←）' },
  next: { d: 'M9 6l6 6-6 6', label: '下一页（键盘 →）' }
}
</script>

<template>
  <UiButton variant="ghost" size="sm"
    type="button"
    class="absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card-bg text-text-secondary opacity-0 shadow-[var(--shadow-2)] transition-opacity duration-200 hover:bg-card-bg-hover hover:text-text-primary focus-visible:opacity-100"
    :class="[positionClass, visible ? 'opacity-100' : 'pointer-events-none']"
    :data-testid="testId"
    :aria-label="ARROW[kind].label"
    @click="emit('go', kind)"
  >
    <svg
      class="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path :d="ARROW[kind].d" />
    </svg>
  </UiButton>
</template>
