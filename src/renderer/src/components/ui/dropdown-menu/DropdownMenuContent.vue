<script setup lang="ts">
import { DropdownMenuContent, DropdownMenuPortal, useForwardPropsEmits, type DropdownMenuContentProps, type DropdownMenuContentEmits } from 'reka-ui'
const props = defineProps<DropdownMenuContentProps>()
const emit = defineEmits<DropdownMenuContentEmits>()
const forwarded = useForwardPropsEmits(props, emit)
</script>
<template><DropdownMenuPortal><DropdownMenuContent v-bind="forwarded" class="z-50 min-w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"><slot /></DropdownMenuContent></DropdownMenuPortal></template>
