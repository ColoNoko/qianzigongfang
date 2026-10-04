<script lang="ts">
/**
 * 胶片条展开后的总高（px，含上下内边距与 1px 上边框）。
 *
 * 导出给 `CompareViewer` 用：右下角缩放控件要让位时，位置必须按**同一个数字**算 ——
 * 两处各写一个魔法数字迟早会对不上（方块一变大，"让位"就会变成"被压住"）。
 * 改方块尺寸时**必须同步这个数字**（下面 template 里的 `h-[88px]`）。
 */
export const STRIP_BAR_HEIGHT_PX = 104

/** 方块尺寸：2026-09-27 按用户反馈放大一轮（44×60 → 64×88），一眼能认出是哪一页。 */
export const STRIP_ITEM_CLASS = 'h-[88px] w-[64px]'
</script>

<script setup lang="ts">
// PreviewThumbStrip — 预览 / 对照状态底部那条"胶片"（照着看图软件的缩略图条做）。
//
// 数据来源是**上一级给的**（`Project.vue` 转手 `ProjectThumbList` 已经渲染好的那份内存缩略图）：
// 这里一张图都不重新生成、也不发任何 IPC —— 缩略图条卡不卡，全看这一条设计。
//
// 根元素自己就是 `absolute bottom-0`：调用方（工作台的内容区）直接往里一放就是"贴着底部"。
import { nextTick, onMounted, ref, watch } from 'vue'

export interface StripItem {
  /** 与 `comparePair.psd.absPath` 同一个键（翻页、重扫后仍然对得上）。 */
  id: string
  filename: string
  /** 第几张（1 起）：既当占位内容，也当右上角那个小数字。 */
  pageNumber: number
  thumbUrl: string | null
}

const props = defineProps<{ items: StripItem[]; activeId: string }>()

const emit = defineEmits<{
  (e: 'pick', id: string): void
  (e: 'close'): void
}>()

const trackRef = ref<HTMLDivElement | null>(null)

/**
 * 把当前这一张滚到条的正中间。
 *
 * 刻意**不用** `scrollIntoView`：它会把所有可滚的祖先一起挪（第八轮吸顶那次就被它坑过
 * `block:'nearest'`）。这里直接算 `scrollLeft`，只动这一条。
 */
function centerActive(): void {
  const track = trackRef.value
  if (!track) return
  const active = track.querySelector<HTMLElement>('[data-active="true"]')
  if (!active) return
  const target = active.offsetLeft - (track.clientWidth - active.offsetWidth) / 2
  track.scrollLeft = Math.max(0, target)
}

onMounted(centerActive)
watch(() => props.activeId, () => void nextTick(centerActive))
watch(
  () => props.items.length,
  () => void nextTick(centerActive)
)
</script>

<template>
  <div
    class="absolute inset-x-0 bottom-0 z-30 border-t border-border bg-card-bg"
    data-testid="viewer-thumb-strip"
  >
    <div class="flex items-center gap-2 px-2 py-1.5">
      <div
        ref="trackRef"
        class="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-0.5"
        data-testid="viewer-thumb-track"
      >
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          class="relative flex shrink-0 items-center justify-center overflow-hidden rounded-md border-2 bg-media-bg transition-colors hover:border-accent"
          :class="[
            STRIP_ITEM_CLASS,
            item.id === activeId ? 'border-selected-border' : 'border-border'
          ]"
          :data-active="item.id === activeId ? 'true' : 'false'"
          :title="item.filename"
          :aria-label="`第 ${item.pageNumber} 张：${item.filename}`"
          :aria-current="item.id === activeId ? 'true' : undefined"
          @click="emit('pick', item.id)"
        >
          <img
            v-if="item.thumbUrl"
            :src="item.thumbUrl"
            class="max-h-full max-w-full object-contain"
            :alt="item.filename"
            draggable="false"
          />
          <span v-else class="text-[12px] text-text-tertiary">{{ item.pageNumber }}</span>
          <!-- 页码：压一个实底小角标。用 --app-bg 而不是半透明 —— 半透明会让它在深浅两套主题下时浓时淡。 -->
          <span
            class="absolute bottom-0 right-0 rounded-tl-[4px] bg-app-bg px-1 py-px text-[11px] leading-none tabular-nums text-text-secondary"
          >
            {{ item.pageNumber }}
          </span>
        </button>
      </div>

      <button
        type="button"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-badge text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
        aria-label="收起缩略图条"
        title="收起缩略图条"
        data-testid="viewer-thumb-strip-collapse"
        @click="emit('close')"
      >
        <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </div>
  </div>
</template>
