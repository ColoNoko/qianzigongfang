<script setup lang="ts">
import { Button } from '@renderer/components/ui/button'
import { MapPinPlus } from 'lucide-vue-next'
defineProps<{ addFrameMode?: boolean }>()
const emit = defineEmits<{ 'update:addFrameMode': [value: boolean] }>()
</script>
<template>
  <Button :variant="addFrameMode ? 'secondary' : 'ghost'" size="sm" :aria-pressed="!!addFrameMode" :aria-label="addFrameMode ? '关闭新增框' : '开启新增框'" :data-active="addFrameMode ? 'true' : 'false'" title="标点工具：左键添加框内，右键添加框外；图上 Tab 切换" data-testid="translation-add-frame-toggle" @click="emit('update:addFrameMode', !addFrameMode)">
    <MapPinPlus data-icon="inline-start" />标点
  </Button>
</template>
