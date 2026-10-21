<script setup lang="ts">
import { Info } from 'lucide-vue-next'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
withDefaults(defineProps<{ label?: string }>(), { label: '说明' })
</script>
<template>
  <Popover>
    <PopoverTrigger as-child><Button variant="ghost" size="icon" class="size-7 shrink-0" :aria-label="label"><Info /></Button></PopoverTrigger>
    <PopoverContent class="max-h-[min(480px,70vh)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto text-sm leading-relaxed" align="start"><slot /></PopoverContent>
  </Popover>
</template>
