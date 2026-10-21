<script setup lang="ts">
import { WORK_MODE_LABELS } from '@shared/modes'
import type { WorkMode } from '@shared/types'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
defineProps<{ modelValue: WorkMode; modes: WorkMode[]; disabled?: boolean; label?: string; reselect?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [mode: WorkMode] }>()
function update(value: unknown) { if (typeof value === 'string' && value in WORK_MODE_LABELS) emit('update:modelValue', value as WorkMode) }
</script>
<template>
  <span v-if="modes.length === 1" class="text-sm font-medium text-muted-foreground">{{ WORK_MODE_LABELS[modes[0]] }}</span>
  <ToggleGroup v-else type="single" variant="outline" size="sm" :model-value="modelValue" :disabled="disabled" :aria-label="label || '工作模式'" @update:model-value="update">
    <ToggleGroupItem v-for="mode in modes" :key="mode" :value="mode" @click="reselect && mode === modelValue && emit('update:modelValue', mode)">{{ WORK_MODE_LABELS[mode] }}</ToggleGroupItem>
  </ToggleGroup>
</template>
