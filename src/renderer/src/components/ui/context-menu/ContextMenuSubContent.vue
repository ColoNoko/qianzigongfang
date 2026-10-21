<script setup lang="ts">
import { ContextMenuSubContent, ContextMenuPortal, useForwardPropsEmits, type ContextMenuSubContentProps, type ContextMenuSubContentEmits } from 'reka-ui'
const props = defineProps<ContextMenuSubContentProps>()
const emit = defineEmits<ContextMenuSubContentEmits>()
const forwarded = useForwardPropsEmits(props, emit)
</script>
<template><ContextMenuPortal><ContextMenuSubContent v-bind="forwarded" class="z-50 min-w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"><slot /></ContextMenuSubContent></ContextMenuPortal></template>
