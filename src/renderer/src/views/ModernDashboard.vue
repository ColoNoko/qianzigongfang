<script setup lang="ts">
import { Button } from '@renderer/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@renderer/components/ui/card'
import EmptyState from '@renderer/components/EmptyState.vue'
import WorkModeSegments from '@renderer/components/WorkModeSegments.vue'
import HomeRecentCard from '@renderer/features/dashboard/HomeRecentCard.vue'
import HomeQueue from '@renderer/features/dashboard/HomeQueue.vue'
import HomeStats from '@renderer/features/dashboard/HomeStats.vue'
import { useDashboard } from '@renderer/features/dashboard/useDashboard'
import HomeGreeting from '@renderer/features/dashboard/HomeGreeting.vue'
const {store, achievements, settings, modeLabel, recent, inProgress, pending, completed, empty, open, all, add, details} = useDashboard()
</script>
<template>
 <div class="home-page h-full overflow-y-auto bg-app-bg text-foreground">
  <div class="page-layout flex flex-col gap-5">
   <Card class="status-module"><CardContent class="greeting-row p-5"><HomeGreeting /><div class="mode-switch"><WorkModeSegments :model-value="achievements.selectedMode" :modes="settings.enabledWorkModes" label="统计模式" data-testid="dashboard-mode-select" @update:model-value="achievements.setSelectedMode" /></div></CardContent></Card>

    <EmptyState v-if="store.error" :headline="`加载项目失败：${store.error}`" cta-text="重试" :cta-action="() => store.loadProjects()" cta-test-id="dashboard-retry-cta" />
    <EmptyState v-else-if="empty" headline="从第一部漫画开始" cta-text="添加漫画" :cta-action="add" cta-test-id="add-project-cta" />
    <p v-else-if="store.loading && !recent.length" class="py-16 text-center text-muted-foreground" role="status">正在读取项目…</p>
   <template v-else>
    <HomeStats modern :pages="achievements.currentMonthTotal" :chapters="achievements.currentMonthProjectCount" :ongoing="inProgress.length" :mode="modeLabel" @details="details" />
    <section class="modern-recent" data-testid="recent-projects">
     <Card v-if="recent[0]" class="status-module flex flex-col"><CardHeader class="px-5 pb-2 pt-5"><CardTitle class="text-base font-bold">继续上次工作</CardTitle></CardHeader><CardContent class="flex flex-1 flex-col justify-center px-3 pb-3"><HomeRecentCard :item="recent[0]" featured embedded @open="open(recent[0])" /></CardContent></Card>
     <Card class="status-module"><CardHeader class="flex-row items-center justify-between gap-3 px-5 pb-2 pt-4"><CardTitle class="text-base font-bold">最近访问</CardTitle><Button variant="ghost" size="sm" @click="all">全部项目 →</Button></CardHeader><CardContent class="flex flex-col divide-y divide-border px-3 pb-3"><HomeRecentCard v-for="item in recent.slice(1)" :key="item.child.id" :item="item" embedded @open="open(item)" /><p v-if="recent.length < 2" class="px-2 py-6 text-sm text-muted-foreground">打开其他章节后，会出现在这里。</p></CardContent></Card>
    </section>
    <section class="modern-bottom" data-testid="status-overview-section">
     <Card class="status-module ongoing-module" data-testid="ongoing-section"><CardHeader class="px-4 pb-2 pt-4"><CardTitle class="flex items-center justify-between gap-2 text-base font-bold"><span>接下来</span><span class="text-xs font-normal text-muted-foreground">{{ inProgress.length }} 话进行中</span></CardTitle></CardHeader><CardContent class="px-3 pb-3"><HomeQueue :items="inProgress" kind="progress" :limit="3" @open="open" /></CardContent></Card>
      <Card class="status-module" data-testid="completed-section"><CardHeader class="px-4 pb-2 pt-4"><CardTitle class="text-base font-bold">最近完成</CardTitle></CardHeader><CardContent class="px-4 pb-2"><HomeQueue :items="completed" kind="completed" :limit="3" @open="open" /></CardContent></Card>
      <Card class="status-module" data-testid="pending-section"><CardHeader class="px-4 pb-2 pt-4"><CardTitle class="flex items-center justify-between gap-3 text-base font-bold"><span>尚未开始 · {{ modeLabel }}</span><span class="text-xs font-normal text-muted-foreground">{{ pending.length }} 话</span></CardTitle></CardHeader><CardContent class="px-4 pb-2"><HomeQueue :items="pending" kind="pending" :limit="3" @open="open" /></CardContent></Card>
    </section>
   </template>
  </div>
 </div>
</template>
<style scoped>
.home-page {container-type:inline-size;}
.greeting-row {display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:stretch;}
.mode-switch {padding-top:22px;}
.modern-recent {display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:24px;align-items:stretch;}
.modern-bottom {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:stretch;}
.status-module {min-width:0;border-color:var(--border);box-shadow:none;}
@container (max-width:960px) {.modern-bottom {grid-template-columns:repeat(2,minmax(0,1fr));}.ongoing-module {grid-column:1/-1;}}
@container (max-width:800px) {.modern-recent {grid-template-columns:minmax(0,1fr);}}
@container (max-width:600px) {.modern-bottom {grid-template-columns:minmax(0,1fr);}}
@container (max-width:640px) {.greeting-row {grid-template-columns:minmax(0,1fr);gap:0;}.mode-switch {padding-top:0;}}
</style>
