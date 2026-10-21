<script setup lang="ts">
import { Button as UiButton } from '@renderer/components/ui/button'
// EmptyState — centered card for empty/missing-data views.
// Replaces ad-hoc empty placeholders across Dashboard, Achievements, Project.
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Text-based icon glyph shown above the headline. */
    icon?: string
    /** Primary message describing the empty state. */
    headline: string
    /** Optional CTA button label. When omitted, no button renders. */
    ctaText?: string
    /** Optional CTA click handler. */
    ctaAction?: () => void
    /** Optional data-testid for the CTA button (test hook). */
    ctaTestId?: string
  }>(),
  {
    icon: '(╥_╥)',
    ctaText: undefined,
    ctaAction: undefined,
    ctaTestId: undefined
  }
)

const hasCta = computed(() => typeof props.ctaText === 'string' && props.ctaText.length > 0)
</script>

<template>
  <div
    class="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-lg border border-border bg-card-bg p-8 text-text-secondary shadow-[var(--shadow-1)]"
  >
    <!-- 颜文字放进一个强调色淡底圆里：纯灰大字号在一大片留白里像"报错"，
         给个柔和容器它才读起来像"这里暂时是空的"。 -->
    <div
      class="flex h-20 w-20 items-center justify-center rounded-full bg-primary-soft text-3xl text-accent"
      aria-hidden="true"
    >
      {{ icon }}
    </div>
    <p class="text-lg text-text-secondary">{{ headline }}</p>
    <UiButton variant="default" size="sm"
      v-if="hasCta"
      class="transition-colors"
      :data-testid="ctaTestId"
      @click="ctaAction?.()"
    >
      {{ ctaText }}
    </UiButton>
  </div>
</template>
