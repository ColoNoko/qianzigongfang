import { computed, onUnmounted, ref, watch } from 'vue'
import type { SystemFontInfo } from '@shared/ipc-api'
import type { Ref, ComputedRef } from 'vue'

export function useFontVirtualList(
  cardSize: Ref<'large' | 'medium' | 'small'>,
  visibleFonts: ComputedRef<SystemFontInfo[]>
) {
  const listElement = ref<HTMLElement>()

  const scrollTop = ref(0)

  const listWidth = ref(900)

  const listHeight = ref(600)

  let listObserver: ResizeObserver | undefined

  watch(listElement, (element) => {
    listObserver?.disconnect()
    if (!element || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      listWidth.value = element.clientWidth - 24
      listHeight.value = element.clientHeight
    }
    measure()
    listObserver = new ResizeObserver(measure)
    listObserver.observe(element)
  })

  const columns = computed(() => {
    const maximum = cardSize.value === 'small' ? 4 : cardSize.value === 'medium' ? 3 : 2
    const minimum = cardSize.value === 'small' ? 190 : cardSize.value === 'medium' ? 240 : 300
    return Math.max(1, Math.min(maximum, Math.floor((listWidth.value + 12) / (minimum + 12))))
  })

  const rowHeight = computed(
    () => (cardSize.value === 'small' ? 160 : cardSize.value === 'medium' ? 192 : 224) + 12
  )

  const startRow = computed(() => Math.max(0, Math.floor(scrollTop.value / rowHeight.value) - 2))

  const virtualStart = computed(() => startRow.value * columns.value)

  const virtualEnd = computed(
    () => virtualStart.value + columns.value * (Math.ceil(listHeight.value / rowHeight.value) + 4)
  )

  const virtualFonts = computed(() =>
    visibleFonts.value.slice(virtualStart.value, virtualEnd.value)
  )
  onUnmounted(() => listObserver?.disconnect())
  return { listElement, scrollTop, columns, rowHeight, startRow, virtualEnd, virtualFonts }
}
