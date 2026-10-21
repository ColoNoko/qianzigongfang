<script setup lang="ts">
import { Button } from '@renderer/components/ui/button'
defineProps<{ pages: number; chapters: number; ongoing: number; mode: string; modern?: boolean }>()
defineEmits<{ details: [] }>()
</script>
<template>
 <section class="home-stats" :class="{modern}" data-testid="dashboard-achievements">
  <div data-testid="dashboard-month-count"><p class="text-xs text-muted-foreground">本月{{ mode }}完成</p><p class="mt-2"><strong class="text-3xl font-semibold tabular-nums">{{ pages }}</strong><span class="ml-2 text-xs text-muted-foreground">页</span></p></div>
  <div><p class="text-xs text-muted-foreground">本月整话完成</p><p class="mt-2"><strong class="text-3xl font-semibold tabular-nums">{{ chapters }}</strong><span class="ml-2 text-xs text-muted-foreground">话</span></p></div>
  <div><p class="text-xs text-muted-foreground">正在{{ mode }}</p><p class="mt-2"><strong class="text-3xl font-semibold tabular-nums">{{ ongoing }}</strong><span class="ml-2 text-xs text-muted-foreground">话</span></p></div>
  <Button variant="ghost" size="sm" class="stats-link" @click="$emit('details')">查看成就 →</Button>
 </section>
</template>
<style scoped>
.home-stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)) auto; align-items:center; gap:24px; padding:20px 24px; border:1px solid var(--border); border-radius:12px; background:var(--card-bg); }
.modern strong {display:inline-block;animation:stat-enter .3s ease-out both;}
@keyframes stat-enter {from {opacity:.4;transform:translateY(4px);} to {opacity:1;transform:none;}}
@media(prefers-reduced-motion:reduce) {.modern strong {animation:none;}}
@container (max-width:640px) {.home-stats {gap:16px;padding:16px;} .stats-link {grid-column:1/-1;justify-self:end;} }
</style>
