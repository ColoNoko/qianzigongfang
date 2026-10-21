<script setup lang="ts">
import { Button } from '@renderer/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@renderer/components/ui/card'
import EmptyState from '@renderer/components/EmptyState.vue'
import WorkModeSegments from '@renderer/components/WorkModeSegments.vue'
import HomeRecentCard from '@renderer/features/dashboard/HomeRecentCard.vue'
import HomeQueue from '@renderer/features/dashboard/HomeQueue.vue'
import HomeStats from '@renderer/features/dashboard/HomeStats.vue'
import { useDashboard } from '@renderer/features/dashboard/useDashboard'
const {store, achievements, settings, modeLabel, recent, inProgress, pending, completed, empty, open, all, add, details} = useDashboard()
</script>
<template>
 <div class="home-page h-full overflow-y-auto bg-app-bg text-foreground">
  <div class="home-inner page-layout flex flex-col gap-6">
   <header class="view-heading"><div><h1 class="view-title">工作概览</h1><p class="view-description">接着上次的进度，把这一话完成。</p></div><WorkModeSegments :model-value="achievements.selectedMode" :modes="settings.enabledWorkModes" label="统计模式" data-testid="dashboard-mode-select" @update:model-value="achievements.setSelectedMode" /></header>

    <EmptyState v-if="store.error" :headline="`加载项目失败：${store.error}`" cta-text="重试" :cta-action="() => store.loadProjects()" cta-test-id="dashboard-retry-cta" />
    <EmptyState v-else-if="empty" headline="从第一部漫画开始" cta-text="添加漫画" :cta-action="add" cta-test-id="add-project-cta" />
    <p v-else-if="store.loading && !recent.length" class="py-16 text-center text-muted-foreground" role="status">正在读取项目…</p>
   <template v-else>
    <HomeStats :pages="achievements.currentMonthTotal" :chapters="achievements.currentMonthProjectCount" :ongoing="inProgress.length" :mode="modeLabel" @details="details" />
    <section data-testid="recent-projects"><div class="mb-3 flex items-center justify-between gap-3"><h2 class="text-sm font-semibold">继续上次工作</h2><Button variant="ghost" size="sm" @click="all">全部项目 →</Button></div><div class="recent-grid"><HomeRecentCard v-for="item in recent" :key="item.child.id" :item="item" @open="open(item)" /></div></section>
    <section class="home-columns" data-testid="status-overview-section">
     <Card class="home-panel" data-testid="ongoing-section"><CardHeader class="pb-2"><CardTitle class="flex items-center justify-between text-base">进行中的章节<span class="text-xs font-normal text-muted-foreground">{{ inProgress.length }} 话</span></CardTitle></CardHeader><CardContent><HomeQueue :items="inProgress" kind="progress" :limit="3" @open="open" /></CardContent></Card>
     <div class="flex min-w-0 flex-col gap-4">
      <Card class="home-panel" data-testid="completed-section"><CardHeader class="pb-2"><CardTitle class="text-sm">最近完成</CardTitle></CardHeader><CardContent><HomeQueue :items="completed" kind="completed" :limit="3" @open="open" /></CardContent></Card>
      <Card class="home-panel" data-testid="pending-section"><CardHeader class="pb-2"><CardTitle class="flex items-center justify-between text-sm">尚未开始 · {{ modeLabel }}<span class="text-xs font-normal text-muted-foreground">{{ pending.length }} 话</span></CardTitle></CardHeader><CardContent><HomeQueue :items="pending" kind="pending" :limit="3" @open="open" /></CardContent></Card>
     </div>
    </section>
   </template>
  </div>
 </div>
</template>
<style scoped>
.home-page {container-type:inline-size;}
.recent-grid {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}
.home-columns {display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);gap:20px;align-items:start;}
.home-panel {border-color:var(--border);box-shadow:none;min-width:0;}
@container (max-width:950px) {.recent-grid {grid-template-columns:repeat(2,minmax(0,1fr));}}
@container (max-width:700px) {.recent-grid,.home-columns {grid-template-columns:minmax(0,1fr);}}
</style>
