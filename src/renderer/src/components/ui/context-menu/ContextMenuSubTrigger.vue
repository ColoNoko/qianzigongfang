<script setup lang="ts">
import { ContextMenuSubTrigger, useForwardProps, type ContextMenuSubTriggerProps } from 'reka-ui'
const props = defineProps<ContextMenuSubTriggerProps>()
const forwarded = useForwardProps(props)
</script>
<template><ContextMenuSubTrigger v-bind="forwarded" class="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-ui-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"><slot /><span class="ml-auto pl-4" aria-hidden="true">›</span></ContextMenuSubTrigger></template>
