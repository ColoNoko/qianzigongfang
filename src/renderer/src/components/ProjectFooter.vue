<script setup lang="ts">
// ProjectFooter — thin wrapper around FooterBar for the Project workspace.
//
// Task 4.5 wires the workspace store's `progress` getter into the footer.
// This component exists so Project.vue can mount a single `<ProjectFooter
// :progress="..." />` without coupling directly to FooterBar's prop shape.
// It carries no logic of its own; all rendering is delegated to FooterBar.
//
// The `progress` prop is the `ChapterProgress` from the store getter (or any
// caller-supplied value of the same shape). When the store is the source,
// pass `workspaceStore.progress` so the footer updates reactively on
// `setActiveChild` / `clearActiveChild`.
//
// `mode` selects the label ("嵌字进度" / "翻译进度" / …) and defaults to
// typeset so existing callers keep the historical wording.
import type { ChapterProgress, WorkMode } from '@shared/types'
import FooterBar from './FooterBar.vue'

defineProps<{ progress: ChapterProgress; mode?: WorkMode }>()
</script>

<template>
  <FooterBar :progress="progress" :mode="mode" />
</template>