<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import type { ButtonVariants } from "./variants"
import { ref } from 'vue'
import { Primitive } from "reka-ui"
import { cn } from "@renderer/lib/utils"
import { buttonVariants } from "./variants"

interface Props extends PrimitiveProps {
  variant?: ButtonVariants["variant"]
  size?: ButtonVariants["size"]
  class?: HTMLAttributes["class"]
}

const props = withDefaults(defineProps<Props>(), {
  as: "button",
})
const root = ref<any>()
const element = () => root.value?.$el ?? root.value
defineExpose({ focus: () => element()?.focus(), contains: (target: Node) => element()?.contains(target), getBoundingClientRect: () => element()?.getBoundingClientRect() })
</script>

<template>
  <Primitive ref="root"
    :type="as === 'button' ? 'button' : undefined"
    :as="as"
    :as-child="asChild"
    :class="cn(buttonVariants({ variant, size }), props.class)"
  >
    <slot />
  </Primitive>
</template>
