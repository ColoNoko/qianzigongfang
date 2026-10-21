<script setup lang="ts">
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import { ArrowUpRight } from 'lucide-vue-next'
import { formatChapterNumber } from '@shared/chapter'
import type { HomeChapter } from './useDashboard'
import HomeCover from './HomeCover.vue'
defineProps<{ item: HomeChapter; featured?: boolean; embedded?: boolean }>()
defineEmits<{ open: [] }>()
</script>
<template>
  <Button variant="ghost" class="home-recent group h-auto min-w-0 justify-start whitespace-normal text-left" :class="[featured ? 'featured' : 'p-3', embedded ? 'embedded' : 'border border-border bg-card']" data-testid="recent-project-card" @click="$emit('open')">
    <HomeCover :folder="item.child.folderPath" />
    <span class="flex min-w-0 flex-1 flex-col gap-2">
      <span class="truncate text-base font-semibold" :title="item.parent.title">{{ item.parent.title }}</span>
      <span class="truncate text-xs font-normal text-muted-foreground">{{ formatChapterNumber(item.child.chapterNumber) }} · {{ item.child.projectTitle }}</span>
      <span class="flex items-center justify-between gap-2 text-xs"><span class="tabular-nums">{{ item.progress.done }} / {{ item.progress.total }} 页</span><span class="font-normal text-muted-foreground">{{ item.progress.total ? `${Math.round(item.progress.pct ?? 0)}%` : '等待扫描' }}</span></span>
      <Progress :model-value="item.progress.pct ?? 0" class="h-1" aria-label="章节进度" />
      <span v-if="featured" class="mt-1 flex items-center gap-2 text-sm text-primary">继续工作 <ArrowUpRight class="size-4" /></span>
    </span>
  </Button>
</template>
<style scoped>
.home-recent { gap:16px; width:100%; transition:border-color .2s,background-color .2s; }
.home-recent:hover { border-color:var(--primary); }
.embedded { border:0; }
.featured { padding:24px; gap:24px; }
.featured :deep(.home-cover) { width:126px; height:174px; }
@container (max-width:520px) { .featured {padding:16px; gap:16px;} .featured :deep(.home-cover) {width:88px;height:128px;} }
</style>
