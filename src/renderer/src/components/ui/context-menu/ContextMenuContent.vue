<script setup lang="ts">
import { ContextMenuContent, ContextMenuPortal, useForwardPropsEmits, type ContextMenuContentProps, type ContextMenuContentEmits } from 'reka-ui'
const props = defineProps<ContextMenuContentProps>()
const emit = defineEmits<ContextMenuContentEmits>()
const forwarded = useForwardPropsEmits(props, emit)
</script>
<template><ContextMenuPortal><ContextMenuContent v-bind="forwarded" class="z-50 min-w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"><slot /></ContextMenuContent></ContextMenuPortal></template>
