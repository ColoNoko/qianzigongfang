<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import type { SheetVariants } from "./variants"
import { reactiveOmit } from "@vueuse/core"
import { X } from "lucide-vue-next"
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits,
} from "reka-ui"
import { ref } from 'vue'
import { cn } from "@renderer/lib/utils"
import { sheetVariants } from "./variants"

interface SheetContentProps extends DialogContentProps {
  class?: HTMLAttributes["class"]
  side?: SheetVariants["side"]; showClose?: boolean
}

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<SheetContentProps>()

const emits = defineEmits<DialogContentEmits>()

const delegatedProps = reactiveOmit(props, "class", "side", "showClose")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
const content = ref<any>()
const element = () => content.value?.$el ?? content.value
defineExpose({ focus: () => element()?.focus(), querySelector: (query: string) => element()?.querySelector(query), querySelectorAll: (query: string) => element()?.querySelectorAll(query) ?? [], contains: (target: Node) => element()?.contains(target) })
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
    />
    <DialogContent ref="content"
      :class="cn(sheetVariants({ side }), props.class)"
      v-bind="{ ...forwarded, ...$attrs }"
    >
      <slot />

      <DialogClose v-if="showClose !== false"
        class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary"
      >
        <X class="w-4 h-4" />
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
