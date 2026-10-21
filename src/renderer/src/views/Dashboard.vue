<script setup lang="ts">
import DefaultDashboard from './DefaultDashboard.vue'
import ModernDashboard from './ModernDashboard.vue'
import { useSettingsStore } from '@renderer/stores/settings'
const settings = useSettingsStore()
</script>
<template>
  <div class="flex h-full min-h-0 flex-col bg-app-bg">
    <ModernDashboard v-if="settings.homeStyle === 'modern'" class="min-h-0 flex-1" />
    <DefaultDashboard v-else class="min-h-0 flex-1" />
  </div>
</template>
