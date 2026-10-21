<script setup lang="ts">
defineProps<{ name: string }>()
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <g v-if="name === 'dashboard'">
      <path class="icon-wash" d="M4.5 10.5 12 4l7.5 6.5V20h-15Z" />
      <path d="m3 11 7.7-6.7a2 2 0 0 1 2.6 0L21 11M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9M9.5 20v-6h5v6" />
    </g>
    <g v-else-if="name === 'project'">
      <path class="icon-wash" d="M3 9h18l-2 11H4Z" />
      <path d="M3 10V6a2 2 0 0 1 2-2h4l3 3h6a2 2 0 0 1 2 2M4 20h14a1.5 1.5 0 0 0 1.5-1.3L21 10H3l1 10Z" />
    </g>
    <g v-else-if="name === 'progress'">
      <path class="icon-wash" d="m7 19 5-5 5 5Z" />
      <path d="M6 3h12M6 21h12M7 3v4c0 2 3 3.5 5 5-2 1.5-5 3-5 5v4M17 3v4c0 2-3 3.5-5 5 2 1.5 5 3 5 5v4M9.5 7h5M10 18h4" />
    </g>
    <g v-else-if="name === 'achievements'">
      <path class="icon-wash" d="M7 4h10v5a5 5 0 0 1-10 0Z" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0ZM7 6H3v2a4 4 0 0 0 4 4M17 6h4v2a4 4 0 0 1-4 4M12 14v4M9 18h6l1 3H8l1-3Z" />
    </g>
    <g v-else-if="name === 'fonts'">
      <path d="m3 19 5.5-14L14 19M5 14h7M15 9h6M18 9v10M16 19h4" />
    </g>
    <g v-else-if="name === 'import'">
      <path class="icon-wash" d="M3 14h5l2 3h4l2-3h5v6H3Z" />
      <path d="M12 3v10m-4-4 4 4 4-4M4 13l-1 6a1.7 1.7 0 0 0 1.7 2h14.6a1.7 1.7 0 0 0 1.7-2l-1-6M3.5 15H8l2 3h4l2-3h4.5" />
    </g>
    <g v-else-if="name === 'settings'">
      <circle class="icon-wash" cx="12" cy="12" r="7" />
      <path d="m10 3-.6 2.3-2 .9L5.1 6 3 9.5l1.7 1.6v1.8L3 14.5 5.1 18l2.3-.2 2 .9L10 21h4l.6-2.3 2-.9 2.3.2 2.1-3.5-1.7-1.6v-1.8L21 9.5 18.9 6l-2.3.2-2-.9L14 3Z" />
      <circle cx="12" cy="12" r="3" />
    </g>
    <g v-else-if="name === 'mode'">
      <path d="M3 7h4m5 0h9M3 17h9m5 0h4" />
      <rect x="7" y="4" width="5" height="6" rx="2" />
      <rect x="12" y="14" width="5" height="6" rx="2" />
    </g>
    <g v-else-if="name === 'guide'">
      <path class="icon-wash" d="M4 4h5l3 2 3-2h5v15h-5l-3 2-3-2H4Z" />
      <path d="M12 6C9 4 6 3.5 3 4v15c3-.5 6 0 9 2 3-2 6-2.5 9-2V4c-3-.5-6 0-9 2Zm0 0v15M6 8l3 1M6 12l3 1M15 9l3-1M15 13l3-1" />
    </g>
    <g v-else-if="name === 'sun'">
      <circle class="icon-wash" cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" />
    </g>
    <g v-else-if="name === 'moon'">
      <path class="icon-wash" d="M10 3a8 8 0 0 0 11 11A9 9 0 1 1 10 3Z" />
      <path d="M10 3a8 8 0 0 0 11 11A9 9 0 1 1 10 3ZM17 3v4m-2-2h4" />
    </g>
  </svg>
</template>

<style scoped>
.icon-wash { fill: currentColor; stroke: none; opacity: var(--nav-icon-wash, .08); }
</style>
