<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { ImageIcon } from 'lucide-vue-next'
import { getThumbnailService } from '@renderer/services/thumbnails'
import type { JpgPsdPair } from '@shared/types'
const props = defineProps<{ folder: string }>()
const owner = {}, service = getThumbnailService(), pair = shallowRef<JpgPsdPair | null>(null)
let revision = 0
watch(() => props.folder, async folder => {
  const token = ++revision; pair.value = null; service.release(owner)
  try {
    const source = await window.comicType.coverSource(folder)
    if (!source || token !== revision) return
    pair.value = source
    service.setVisible(owner,[pair.value])
  } catch { /* A missing cover must not prevent opening the project. */ }
}, {immediate:true})
const url = computed(() => pair.value ? service.state(pair.value).url : null)
onBeforeUnmount(() => { revision++; service.release(owner) })
</script>
<template><div class="home-cover overflow-hidden rounded-md bg-muted"><img v-if="url" :src="url" alt="" class="h-full w-full object-cover object-top" @error="pair && service.imageFailed(pair, url)" /><ImageIcon v-else class="size-6 text-muted-foreground" aria-hidden="true" /></div></template>
<style scoped>.home-cover { display:grid; place-items:center; flex-shrink:0; width:62px; height:86px; }</style>
