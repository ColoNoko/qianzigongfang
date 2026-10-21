<script setup lang="ts">
import UiInput from '@renderer/components/ui/ControlInput.vue'
import { Button as UiButton } from '@renderer/components/ui/button'
// 缩放状态由预览父组件管理，原图与 PSD 共用。
import { computed, nextTick, ref } from 'vue'
import {
  parseZoomPercentInput,
  zoomIn,
  zoomOut,
  zoomPercentLabel
} from '@renderer/features/project/viewer-zoom'

const props = defineProps<{ zoomRatio: number }>()
const emit = defineEmits<{ (e: 'update:zoomRatio', ratio: number): void }>()

function setRatio(next: number): void {
  emit('update:zoomRatio', next)
}

const zoomPercent = computed(() => zoomPercentLabel(props.zoomRatio))
const zoomInputOpen = ref(false)
const zoomDraft = ref('')
const zoomInputRef = ref<HTMLInputElement | null>(null)

function onZoomIn(): void {
  setRatio(zoomIn(props.zoomRatio))
}

function onZoomOut(): void {
  setRatio(zoomOut(props.zoomRatio))
}

/** 「一键回默认」= 适应窗口 = 100%（和双击画面同一件事）。 */
function onZoomFit(): void {
  setRatio(1)
}

function openZoomInput(): void {
  zoomDraft.value = String(Math.round(props.zoomRatio * 100))
  zoomInputOpen.value = true
  void nextTick(() => {
    zoomInputRef.value?.focus()
    zoomInputRef.value?.select()
  })
}

/** 看不懂的输入（空、abc、负数）就当没发生 —— 界面保持原值，不静默改成别的数。 */
function commitZoomInput(): void {
  const parsed = parseZoomPercentInput(zoomDraft.value)
  if (parsed !== null) setRatio(parsed)
  zoomInputOpen.value = false
}

function cancelZoomInput(): void {
  zoomDraft.value = ''
  zoomInputOpen.value = false
}
</script>

<template>
  <div class="flex items-center gap-0.5 rounded-badge px-0.5" data-testid="compare-zoom-controls">
    <UiButton variant="ghost" size="sm"
      type="button"
      class="size-8 shrink-0 p-0"
      aria-label="缩小"
      title="缩小"
      data-testid="compare-zoom-out"
      @click="onZoomOut"
    >
      <svg
        class="h-[14px] w-[14px]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      >
        <circle cx="10.5" cy="10.5" r="6.5" />
        <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
        <line x1="15.5" y1="15.5" x2="20.5" y2="20.5" />
      </svg>
    </UiButton>

    <UiInput
      v-if="zoomInputOpen"
      ref="zoomInputRef"
      v-model="zoomDraft"
      class="h-5 w-[46px] rounded-badge border border-primary-border bg-app-bg px-1 text-center text-[11px] tabular-nums text-text-primary focus:outline-none"
      data-testid="compare-zoom-input"
      @keydown.enter="commitZoomInput"
      @keydown.esc.stop="cancelZoomInput"
      @blur="commitZoomInput"
    />
    <UiButton variant="ghost" size="sm"
      v-else
      type="button"
      class="h-5 min-w-[46px] rounded-badge px-1 text-[11px] tabular-nums text-text-primary transition-colors hover:bg-card-bg-hover"
      title="显示当前缩放倍数（100% = 整页刚好塞进窗口）；点一下可以直接输入"
      data-testid="compare-zoom-percent"
      @click="openZoomInput"
    >
      {{ zoomPercent }}
    </UiButton>

    <UiButton variant="ghost" size="sm"
      type="button"
      class="size-8 shrink-0 p-0"
      aria-label="放大"
      title="放大"
      data-testid="compare-zoom-in"
      @click="onZoomIn"
    >
      <svg
        class="h-[14px] w-[14px]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      >
        <circle cx="10.5" cy="10.5" r="6.5" />
        <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
        <line x1="10.5" y1="7.5" x2="10.5" y2="13.5" />
        <line x1="15.5" y1="15.5" x2="20.5" y2="20.5" />
      </svg>
    </UiButton>

    <span class="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />

    <UiButton variant="ghost" size="sm"
      type="button"
      class="size-8 shrink-0 p-0"
      aria-label="适应窗口"
      title="回到默认大小（适应窗口 = 100%）"
      data-testid="compare-zoom-fit"
      @click="onZoomFit"
    >
      <!-- 与"看图软件"同款：外框 + 四个内折角 + 中心实心圆（2026-09-27 按用户给的参照图换的） -->
      <svg
        class="h-[14px] w-[14px]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
        <path d="M5.8 8.8V5.8h3" />
        <path d="M15.2 5.8h3v3" />
        <path d="M18.2 15.2v3h-3" />
        <path d="M8.8 18.2h-3v-3" />
        <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      </svg>
    </UiButton>
  </div>
</template>
