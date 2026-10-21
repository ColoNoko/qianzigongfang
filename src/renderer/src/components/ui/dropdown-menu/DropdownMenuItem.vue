<script setup lang="ts">
import { DropdownMenuItem, useForwardPropsEmits, type DropdownMenuItemProps, type DropdownMenuItemEmits } from 'reka-ui'
const props = defineProps<DropdownMenuItemProps>()
const emit = defineEmits<DropdownMenuItemEmits>()
const forwarded = useForwardPropsEmits(props, emit)
</script>
<template><DropdownMenuItem v-bind="forwarded" class="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-ui-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"><slot /></DropdownMenuItem></template>
