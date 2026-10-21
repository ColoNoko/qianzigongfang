<script setup lang="ts">
import { computed } from 'vue'
import { Maximize, Minimize } from 'lucide-vue-next'
import { Button } from '@renderer/components/ui/button'
import AppSelect from '@renderer/components/AppSelect.vue'
import ViewerZoomControls from './ViewerZoomControls.vue'

const props = defineProps<{
  pageNumber: number
  pageCount: number
  zoomRatio: number
  fullscreen: boolean
  fullscreenError: string
}>()
const emit = defineEmits<{
  pickPage: [page: number]
  'update:zoomRatio': [ratio: number]
  fullscreen: []
}>()
const pages = computed(() => Array.from({ length: props.pageCount }, (_, i) => ({ value: i + 1, label: String(i + 1) })))
</script>

<template>
  <div
    class="ml-auto flex max-w-full flex-wrap items-center justify-end gap-0.5 text-xs text-muted-foreground"
    data-testid="compare-image-controls"
    aria-label="图片调节"
    @pointerdown.stop
    @dblclick.stop
    @keydown.stop
    @wheel.stop
  >
    <span v-if="pageCount > 0 && pageNumber > 0" class="mr-1 whitespace-nowrap">页码：</span>
    <AppSelect v-if="pageCount > 0 && pageNumber > 0" class="w-16 shrink-0" :model-value="pageNumber" :options="pages" size="small" menu-width="trigger" test-id="compare-page-jump" aria-label="当前页码" @update:model-value="emit('pickPage', Number($event))" />
    <ViewerZoomControls :zoom-ratio="zoomRatio" @update:zoom-ratio="emit('update:zoomRatio', $event)" />
    <Button variant="ghost" size="icon-sm" data-testid="compare-fullscreen" :aria-label="fullscreen ? '退出全屏' : '全屏'" :title="fullscreenError || (fullscreen ? '退出全屏（Esc）' : '全屏')" :aria-pressed="fullscreen" @click="emit('fullscreen')"><Minimize v-if="fullscreen" class="size-4" /><Maximize v-else class="size-4" /></Button>
  </div>
</template>
