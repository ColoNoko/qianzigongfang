<script setup lang="ts">
import type { ListboxFilterProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { Search } from "lucide-vue-next"
import { ListboxFilter, useForwardProps } from "reka-ui"
import { cn } from "@renderer/lib/utils"
import { useCommand } from "./context"

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<ListboxFilterProps & {
  class?: HTMLAttributes["class"]
}>()

const delegatedProps = reactiveOmit(props, "class")

const forwardedProps = useForwardProps(delegatedProps)

const { filterState } = useCommand()
</script>

<template>
  <div class="flex items-center border-b px-3 focus-within:ring-1 focus-within:ring-inset focus-within:ring-ring" cmdk-input-wrapper>
    <Search class="mr-2 h-4 w-4 shrink-0 opacity-50" />
    <ListboxFilter
      class="command-filter"
      v-bind="{ ...forwardedProps, ...$attrs }"
      v-model="filterState.search"
      auto-focus
      :class="cn('flex h-10 min-w-0 w-full rounded-none border-0 bg-transparent py-2 text-sm shadow-none outline-none focus-visible:outline-none focus-visible:ring-0 placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50', props.class)"
    />
  </div>
</template>

<style scoped>
/* Focus is drawn on the search row, including its icon. */
.command-filter:focus-visible { outline: none; box-shadow: none; }
</style>
