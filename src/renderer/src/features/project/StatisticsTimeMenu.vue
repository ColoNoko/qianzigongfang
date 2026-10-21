<script setup lang="ts">
import { ref } from 'vue'
import { Check } from 'lucide-vue-next'
import { ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent, ContextMenuItem, ContextMenuGroup } from '@renderer/components/ui/context-menu'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import type { WorkMode } from '@shared/types'
import { STATISTICS_TIME_LABELS, type StatisticsTimeSource, type StatisticsTimeTarget } from '@shared/statistics-time'
import { useAchievementsStore } from '@renderer/stores/achievements'
import { useToastStore } from '@renderer/stores/toast'
const props = defineProps<{ target: StatisticsTimeTarget; mode: WorkMode }>()
const source = ref<StatisticsTimeSource>('mark'), date = ref(''), busy = ref(false), manual = ref(false), opened = ref(false)
const toast = useToastStore(), achievements = useAchievementsStore()
async function load(value: boolean) {
  opened.value = value
  if (!value) { manual.value = false; return }
  try { source.value = await window.comicType.statisticsTimeGet(props.target, props.mode) } catch (error) { toast.addToast({type:'error',message:String(error)}) }
}
async function apply(next: StatisticsTimeSource) {
  if (busy.value) return
  busy.value = true
  try {
    const result = await window.comicType.statisticsTimeSet({...props.target, mode:props.mode, source:next, date:date.value})
    source.value = next
    await achievements.refresh()
    window.dispatchEvent(new Event('statistics-time-changed'))
    toast.addToast({type:result.fallback ? 'warning':'success',message:`已更新统计时间：${result.changed} 张${result.fallback ? `；${result.fallback} 张文件不可用，保留标记时间` : ''}`})
    opened.value = false
  } catch (error) { toast.addToast({type:'error',message:String(error)}) }
  finally { busy.value = false }
}
</script>
<template>
  <ContextMenuSub :open="opened" @update:open="load">
    <ContextMenuSubTrigger data-testid="statistics-time-trigger">统计时间…</ContextMenuSubTrigger>
    <ContextMenuSubContent :collision-padding="8">
      <ContextMenuGroup>
        <ContextMenuItem v-for="key in (['mark','file','manual'] as const)" :key="key" :disabled="busy" @select.prevent="key === 'manual' ? manual = true : apply(key)">
          <Check class="mr-2 size-3" :class="source === key ? 'opacity-100' : 'opacity-0'" />{{ STATISTICS_TIME_LABELS[key] }}
        </ContextMenuItem>
      </ContextMenuGroup>
      <div v-if="manual" class="flex w-56 flex-col gap-2 border-t border-border p-2" @keydown.stop>
        <Input v-model="date" type="date" aria-label="统计归属日期" />
        <Button size="sm" :disabled="busy || !date" @click="apply('manual')">应用日期</Button>
      </div>
    </ContextMenuSubContent>
  </ContextMenuSub>
</template>
