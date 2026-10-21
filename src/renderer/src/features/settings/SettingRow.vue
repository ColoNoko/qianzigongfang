<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>
<template>
  <div class="setting-row">
    <div class="min-w-0">
      <p class="text-sm font-medium text-foreground">{{ title }}</p>
      <p v-if="description" class="mt-1 max-w-[44ch] text-xs leading-relaxed text-muted-foreground">{{ description }}</p>
      <slot name="description" />
    </div>
    <div class="setting-controls"><slot /></div>
  </div>
</template>
<style scoped>
.setting-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:16px 28px; padding:16px 0; }
.setting-row + .setting-row { border-top:1px solid var(--border); }
.setting-controls { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:8px; max-width:100%; min-width:0; }
@container (max-width:620px) { .setting-row { grid-template-columns:minmax(0,1fr); gap:10px; } .setting-controls { justify-content:flex-start; } }
</style>
