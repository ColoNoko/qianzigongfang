<script setup lang="ts">
/**
 * 引导里"一块文字"的渲染（2026-10-03 抽出）。
 *
 * 为什么单独一个文件：第 1 页的要点要**一屏一条、左右翻**，同一块文字因此会被渲染两次
 * （常规页渲染整列；翻页页把"当前那一条"渲染进滑块里）。三层长相只能有一处 ——
 * 抄两份必然漂（这正是本仓库反复吃过的亏）。
 */
import GuideArt from './GuideArt.vue'
import type { GuideBlock } from './guide-pages'

defineProps<{ block: GuideBlock }>()
</script>

<template>
  <div data-testid="guide-block">
    <div class="flex gap-2 leading-relaxed" data-testid="guide-block-body">
      <span
        v-if="block.kind === 'point'"
        class="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
        aria-hidden="true"
      />
      <div class="min-w-0 flex-1 space-y-1">
        <span
          v-if="block.label"
          class="inline-block rounded-badge bg-primary-soft px-1.5 py-0.5 text-[12px] font-medium leading-snug text-accent"
          data-testid="guide-block-label"
        >
          {{ block.label }}
        </span>
        <p
          class="text-[13px]"
          :class="block.kind === 'lead' ? 'text-text-secondary' : 'text-text-primary'"
          data-testid="guide-block-text"
        >
          {{ block.text }}
        </p>
        <p
          v-if="block.note"
          class="text-[12px] text-text-tertiary"
          data-testid="guide-block-note"
        >
          {{ block.note }}
        </p>
      </div>
    </div>

    <GuideArt v-for="artId in block.arts ?? []" :key="artId" :art="artId" class="mt-3" />

    <!-- 左右并排那组（用户 2026-10-04：两张图左右排列，各占一半、各自居中）。
         图本身仍是"自然宽度"（`w-fit`），这里只负责给它们一半的位置。 -->
    <div
      v-if="block.artsRow && block.artsRow.length > 0"
      class="mt-3 flex items-start justify-center gap-3"
      data-testid="guide-arts-row"
    >
      <div
        v-for="artId in block.artsRow"
        :key="artId"
        class="flex min-w-0 flex-1 justify-center"
      >
        <GuideArt :art="artId" />
      </div>
    </div>
  </div>
</template>
