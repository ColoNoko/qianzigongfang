<script setup lang="ts">
import { ContextMenuItem, useForwardPropsEmits, type ContextMenuItemProps, type ContextMenuItemEmits } from 'reka-ui'
const props = defineProps<ContextMenuItemProps>()
const emit = defineEmits<ContextMenuItemEmits>()
const forwarded = useForwardPropsEmits(props, emit)
</script>
<template><ContextMenuItem v-bind="forwarded" class="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-ui-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"><slot /></ContextMenuItem></template>
