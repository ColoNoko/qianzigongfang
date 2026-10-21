<script setup lang="ts">
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import type { TranslationPaneMode } from '@shared/translation-review'
defineProps<{ mode: TranslationPaneMode }>()
const emit = defineEmits<{ 'update:mode': [mode: TranslationPaneMode] }>()
function update(value: unknown) {
  if (value === 'translate' || value === 'review') emit('update:mode', value)
}
</script>
<template>
  <ToggleGroup type="single" :model-value="mode" size="sm" variant="primary" aria-label="译文栏档位" data-testid="translation-mode-toggle" @update:model-value="update">
    <ToggleGroupItem value="translate" data-testid="translation-mode-translate">翻译</ToggleGroupItem>
    <ToggleGroupItem value="review" data-testid="translation-mode-review">校对</ToggleGroupItem>
  </ToggleGroup>
</template>
