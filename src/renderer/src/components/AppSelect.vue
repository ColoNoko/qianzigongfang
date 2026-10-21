<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ChevronsUpDown } from 'lucide-vue-next'
import { Button } from './ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command'
export interface AppSelectOption { value: string | number; label: string; disabled?: boolean }
const props = withDefaults(defineProps<{ modelValue: string | number; options: AppSelectOption[]; testId?: string; size?: 'small' | 'medium'; searchable?: boolean; searchPlaceholder?: string }>(), { testId: '', size: 'medium', searchable: false, searchPlaceholder: '搜索…' })
const emit = defineEmits<{ 'update:modelValue': [value: string | number]; change: [value: string | number] }>()
const opened = ref(false)
const selected = computed(() => props.options.find(option => String(option.value) === String(props.modelValue)))
function choose(value: unknown) {
  const option = props.options.find(option => String(option.value) === String(value))
  if (!option || option.disabled) return
  emit('update:modelValue', option.value)
  emit('change', option.value)
  opened.value = false
}
</script>
<template>
  <div :data-testid="testId || undefined" class="min-w-0">
    <Popover v-if="searchable" v-model:open="opened">
      <PopoverTrigger as-child>
        <Button variant="outline" :size="size === 'small' ? 'sm' : 'default'" role="combobox" :aria-expanded="opened" class="w-full justify-between" :data-testid="testId ? `${testId}-trigger` : undefined">
          <span class="truncate">{{ selected?.label || '请选择' }}</span><ChevronsUpDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent class="w-[var(--reka-popover-trigger-width)] min-w-48 p-0" align="start">
        <Command>
          <CommandInput :placeholder="searchPlaceholder" :data-testid="testId ? `${testId}-search` : undefined" />
          <CommandList><CommandEmpty>没有匹配项</CommandEmpty><CommandGroup>
            <CommandItem v-for="option in options" :key="String(option.value)" :value="option.label" :disabled="option.disabled" :data-testid="testId ? `${testId}-option-${option.value}` : undefined" @select="choose(option.value)">
              <Check :class="String(option.value) === String(modelValue) ? 'opacity-100' : 'opacity-0'" /><span>{{ option.label }}</span>
            </CommandItem>
          </CommandGroup></CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    <Select v-else :model-value="`option:${modelValue}`" @update:model-value="choose(String($event).slice(7))">
      <SelectTrigger :class="size === 'small' ? 'h-8' : ''" :data-testid="testId ? `${testId}-trigger` : undefined"><SelectValue placeholder="请选择" /></SelectTrigger>
      <SelectContent><SelectGroup>
        <SelectItem v-for="option in options" :key="String(option.value)" :value="`option:${option.value}`" :disabled="option.disabled" :data-testid="testId ? `${testId}-option-${option.value}` : undefined">{{ option.label }}</SelectItem>
      </SelectGroup></SelectContent>
    </Select>
  </div>
</template>
