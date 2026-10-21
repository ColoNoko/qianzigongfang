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
import { useSettingsStore } from '@renderer/stores/settings'
import { Button as UiButton } from '@renderer/components/ui/button'
// PreviewThumbStrip — 预览 / 对照状态底部那条"胶片"（照着看图软件的缩略图条做）。
//
// 图片由宿主的共享缩略图服务提供；滚动时报告可见项与附近项，复用网格缓存。
// 组件自己不读取或解码文件。
//
// 根元素自己就是 `absolute bottom-0`：调用方（工作台的内容区）直接往里一放就是"贴着底部"。
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'

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
  (e: 'visible', ids: string[], nearby: string[]): void
  (e: 'imageError', id: string, url: string): void
  (e: 'pick', id: string): void
  (e: 'close'): void
}>()

const settings = useSettingsStore()
const trackWidth = ref(0)
const itemWidth = computed(() => {
  const target = { 小: 64, 中: 88, 大: 112 }[settings.thumbSizeValid]
  const width = trackWidth.value || target
  const count = Math.max(1, Math.floor((width + 8) / (target + 8)))
  return (width - (count - 1) * 8) / count
})
watch(() => settings.thumbSizeValid, () => void nextTick(centerActive))
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
  reportVisible()
}

let observer: ResizeObserver | undefined
function reportVisible(): void {
  const track = trackRef.value
  if (!track) return
  trackWidth.value = track.clientWidth
  const left = track.scrollLeft,
    right = left + track.clientWidth
  const buttons = Array.from(track.children) as HTMLElement[]
  const visible: string[] = [],
    nearby: string[] = []
  buttons.forEach((button, i) => {
    if (button.offsetLeft + button.offsetWidth >= left && button.offsetLeft <= right)
      visible.push(props.items[i].id)
    else if (
      button.offsetLeft + button.offsetWidth >= left - 144 &&
      button.offsetLeft <= right + 144
    )
      nearby.push(props.items[i].id)
  })
  emit('visible', visible, nearby)
}
onMounted(() => {
  centerActive()
  if (typeof ResizeObserver !== 'undefined' && trackRef.value) {
    observer = new ResizeObserver(reportVisible)
    observer.observe(trackRef.value)
  }
})
onBeforeUnmount(() => {
  observer?.disconnect()
  emit('visible', [], [])
})
watch(
  () => props.activeId,
  () => void nextTick(centerActive)
)
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
        @scroll="reportVisible"
        class="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-0.5"
        data-testid="viewer-thumb-track"
      >
        <UiButton variant="outline" size="sm"
          v-for="item in items"
          :key="item.id"
          type="button"
          class="relative flex shrink-0 items-center justify-center overflow-hidden transition-colors"
          :class="[

            item.id === activeId ? 'border-selected-border' : 'border-border'
          ]"
          :style="{ width: itemWidth + 'px', height: Math.round(itemWidth * 1.35) + 'px' }"
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
            @error="emit('imageError', item.id, item.thumbUrl!)"
          />
          <span v-else class="text-[12px] text-text-tertiary">{{ item.pageNumber }}</span>
          <!-- 页码：压一个实底小角标。用 --app-bg 而不是半透明 —— 半透明会让它在深浅两套主题下时浓时淡。 -->
          <span
            class="absolute bottom-0 right-0 rounded-tl-[4px] bg-app-bg px-1 py-px text-[11px] leading-none tabular-nums text-text-secondary"
          >
            {{ item.pageNumber }}
          </span>
        </UiButton>
      </div>

      <UiButton variant="ghost" size="sm"
        type="button"
        class="flex w-6 shrink-0 items-center justify-center transition-colors"
        aria-label="收起缩略图条"
        title="收起缩略图条"
        data-testid="viewer-thumb-strip-collapse"
        @click="emit('close')"
      >
        <svg
          class="h-[18px] w-[18px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </UiButton>
    </div>
  </div>
</template>
