<script setup lang="ts">
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import { formatChapterNumber } from '@shared/chapter'
import type { HomeChapter } from './useDashboard'
defineProps<{ items: HomeChapter[]; kind: 'progress' | 'pending' | 'completed'; limit: number }>()
defineEmits<{ open: [item: HomeChapter] }>()
const date = (at: number | null) => at ? new Date(at).toLocaleDateString('zh-CN') : '未记录日期'
</script>
<template>
 <div class="home-queue"><ul v-if="items.length" class="flex flex-col divide-y divide-border">
  <li v-for="item in items.slice(0,3)" :key="item.child.id">
   <Button variant="ghost" class="h-auto w-full min-w-0 justify-start gap-4 whitespace-normal px-3 py-3 text-left" @click="$emit('open',item)">
    <span class="flex min-w-0 flex-1 flex-col gap-1"><span class="truncate text-sm font-medium" :title="item.parent.title">{{ item.parent.title }}</span><span class="truncate text-xs font-normal text-muted-foreground">{{ formatChapterNumber(item.child.chapterNumber) }} · {{ item.child.projectTitle }}</span></span>
    <span class="flex w-28 shrink-0 flex-col items-end gap-2 text-xs font-normal tabular-nums">
      <template v-if="kind === 'progress'"><span>还剩 {{ item.progress.total-item.progress.done }} 页</span><Progress :model-value="item.progress.pct ?? 0" class="h-1 w-24" aria-label="章节进度" /></template>
      <template v-else-if="kind === 'completed'"><span>{{ item.progress.total }} 页</span><span class="text-muted-foreground">{{ date(item.completedAt) }}</span></template>
      <span v-else class="text-muted-foreground">{{ item.progress.total ? `${item.progress.total} 页` : '暂无页面' }}</span>
    </span>
   </Button>
  </li>
 </ul>
 <p v-else class="py-6 text-sm text-muted-foreground">{{ kind === 'progress' ? '还没有进行中的章节，可以从最近项目开始。' : kind === 'completed' ? '完成一话后，会在这里留下记录。' : '当前没有尚未开始的章节。' }}</p>
</div>
</template>

<style scoped>.home-queue{height:210px;overflow:hidden}.home-queue li{height:70px}.home-queue li :deep(button){height:100%}.home-queue>p{height:100%;display:flex;align-items:center;justify-content:center;padding:20px 8px;text-align:center}</style>