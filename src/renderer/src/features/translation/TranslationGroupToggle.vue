<script setup lang="ts">
import { computed } from 'vue'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { Badge } from '@renderer/components/ui/badge'
const props = defineProps<{ index: number; groups: string[]; value: string }>()
const emit = defineEmits<{ change: [group: string] }>()
const choices = computed(() => props.groups.slice(0, 2).map(group => group.trim()))
const switchable = computed(() => choices.value.length === 2 && choices.value.includes(props.value.trim()))
function update(value: unknown) {
  if (typeof value === 'string' && choices.value.includes(value) && value !== props.value) emit('change', value)
}
</script>
<template>
  <ToggleGroup v-if="switchable" type="single" :model-value="value" size="sm" variant="outline" :data-testid="'translation-group-' + index" :data-group="value" aria-label="译文分组" @update:model-value="update">
    <ToggleGroupItem v-for="group in choices" :key="group" :value="group">{{ group }}</ToggleGroupItem>
  </ToggleGroup>
  <Badge v-else variant="outline" :data-testid="'translation-group-' + index" :data-group="value">{{ value }}</Badge>
</template>
