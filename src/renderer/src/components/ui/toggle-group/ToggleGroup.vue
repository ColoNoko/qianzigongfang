<script setup lang="ts">
import type { VariantProps } from "class-variance-authority"
import type { ToggleGroupRootEmits, ToggleGroupRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import type { toggleVariants } from "@renderer/components/ui/toggle"
import { reactiveOmit } from "@vueuse/core"
import { ToggleGroupRoot, useForwardPropsEmits } from "reka-ui"
import { provide } from "vue"
import { cn } from "@renderer/lib/utils"

type ToggleGroupVariants = VariantProps<typeof toggleVariants>

const props = defineProps<ToggleGroupRootProps & {
  class?: HTMLAttributes["class"]
  variant?: ToggleGroupVariants["variant"]
  size?: ToggleGroupVariants["size"]
}>()
const emits = defineEmits<ToggleGroupRootEmits>()

provide("toggleGroup", {
  variant: props.variant,
  size: props.size,
})

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <ToggleGroupRoot v-slot="slotProps" v-bind="forwarded" :class="cn('inline-flex w-fit max-w-full flex-wrap items-center justify-start gap-0 rounded-md border border-input bg-muted p-0.5', props.class)">
    <slot v-bind="slotProps" />
  </ToggleGroupRoot>
</template>
