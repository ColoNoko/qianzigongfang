<script setup lang="ts">
// Native-event adapter for existing forms. Visual/interaction primitives are shadcn-vue.
import { computed, ref, useAttrs } from 'vue'
import { Input } from './input'
import { Checkbox } from './checkbox'
import { Slider } from './slider'
import { RadioGroup, RadioGroupItem } from './radio-group'
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ type?: string; modelValue?: string | number | boolean; value?: string | number; checked?: boolean; modelModifiers?: { number?: boolean; trim?: boolean } }>(), { checked: undefined, modelValue: undefined })
const emit = defineEmits<{
  'update:modelValue': [value: string | number | boolean]
  input: [event: Event]
  change: [event: Event]
}>()
const attrs = useAttrs()
const root = ref<any>()
const current = computed(() => props.modelValue ?? props.value ?? '')
const on = computed(() => props.checked ?? (props.type === 'radio' ? props.modelValue === props.value : Boolean(props.modelValue)))
function event(type: string, value: string | number | boolean): Event {
  const e = new Event(type, { bubbles: true })
  const target = { value: String(value), checked: Boolean(value), valueAsNumber: Number(value) }
  Object.defineProperties(e, { target: { value: target }, currentTarget: { value: target } })
  return e
}
function update(value: string | number | boolean, commit = true) {
  emit('update:modelValue', value)
  emit('input', event('input', value))
  if (commit) emit('change', event('change', value))
}
function inputValue(value: string | number) {
  if (props.modelModifiers?.trim && typeof value === 'string') value = value.trim()
  if (props.modelModifiers?.number && value !== '' && Number.isFinite(Number(value))) value = Number(value)
  emit('update:modelValue', value)
}
const element = () => root.value?.$el ?? root.value
defineExpose({ focus: () => element()?.focus(), select: () => element()?.select(), getBoundingClientRect: () => element()?.getBoundingClientRect() })
</script>
<template>
  <Checkbox v-if="type === 'checkbox'" ref="root" v-bind="attrs" :model-value="on" @update:model-value="update($event === true)" />
  <RadioGroup v-else-if="type === 'radio'" :model-value="on ? String(value) : ''" @update:model-value="update(value ?? '')">
    <RadioGroupItem ref="root" v-bind="attrs" :value="String(value)" />
  </RadioGroup>
  <Slider v-else-if="type === 'range'" ref="root" v-bind="attrs" :min="Number(attrs.min ?? 0)" :max="Number(attrs.max ?? 100)" :step="Number(attrs.step ?? 1)" :model-value="[Number(current)]" @update:model-value="update($event?.[0] ?? 0, false)" @value-commit="emit('change', event('change', $event[0]))" />
  <Input v-else ref="root" v-bind="attrs" :type="type || 'text'" :model-value="typeof current === 'boolean' ? '' : current" @update:model-value="inputValue" @input="emit('input', $event)" @change="emit('change', $event)" />
</template>
