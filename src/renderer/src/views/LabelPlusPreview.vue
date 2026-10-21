<script setup lang="ts">
import { Button as UiButton } from '@renderer/components/ui/button'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { LabelPlusPreviewPage, LabelPlusPreviewSessionInfo } from '@shared/labelplus-import'

const route = useRoute()
const sessionId = String(route.params.sessionId ?? '')
const session = ref<LabelPlusPreviewSessionInfo | null>(null)
const page = ref<LabelPlusPreviewPage | null>(null)
const loading = ref(true)
const error = ref('')
const index = ref(0)
let wheelLock = false

async function closeWindow(): Promise<void> {
  try {
    await window.comicType.closeCurrentWindow()
  } catch {
    window.close()
  }
}

async function loadPage(nextIndex: number): Promise<void> {
  if (!session.value) return
  const safeIndex = Math.max(0, Math.min(session.value.items.length - 1, nextIndex))
  loading.value = true
  error.value = ''
  try {
    const next = await window.comicType.getLabelPlusPreviewPage(sessionId, safeIndex)
    page.value = next
    index.value = next.index
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

function previous(): void {
  if (index.value > 0) void loadPage(index.value - 1)
}

function next(): void {
  if (session.value && index.value < session.value.items.length - 1) {
    void loadPage(index.value + 1)
  }
}

function onWheel(event: WheelEvent): void {
  if (wheelLock || Math.abs(event.deltaY) < 8) return
  event.preventDefault()
  wheelLock = true
  if (event.deltaY > 0) next()
  else previous()
  window.setTimeout(() => {
    wheelLock = false
  }, 180)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeWindow()
  } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
    event.preventDefault()
    previous()
  } else if (event.key === 'ArrowDown' || event.key === 'PageDown') {
    event.preventDefault()
    next()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  try {
    session.value = await window.comicType.getLabelPlusPreviewSession(sessionId)
    if (!session.value) throw new Error('预览会话不存在')
    index.value = session.value.initialIndex
    await loadPage(index.value)
  } catch (reason) {
    loading.value = false
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="flex h-screen flex-col bg-app-bg text-text-primary select-none"
    data-testid="labelplus-preview-window"
    @wheel="onWheel"
    @dblclick="closeWindow"
  >
    <header class="flex shrink-0 items-center justify-between border-b border-border bg-card-bg px-4 py-3">
      <div class="min-w-0">
        <h1 class="truncate text-sm font-bold">{{ session?.title || 'LabelPlus 预览' }}</h1>
        <p v-if="page" class="mt-1 truncate text-xs text-text-secondary">
          <span class="font-bold underline decoration-dashed underline-offset-2">{{ page.labelImageName }}</span>
          <span class="mx-1">·</span>{{ index + 1 }} / {{ page.total }}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <UiButton variant="outline" size="sm" type="button" class="" :disabled="index <= 0" @click="previous">上一页</UiButton>
        <UiButton variant="outline" size="sm" type="button" class="" :disabled="!session || index >= session.items.length - 1" @click="next">下一页</UiButton>
        <UiButton variant="default" size="sm" type="button" class="transition-colors" @click="closeWindow">关闭</UiButton>
      </div>
    </header>

    <main class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/10 p-4">
      <img v-if="page && !error" :src="page.dataUrl" :alt="page.labelImageName" class="max-h-full max-w-full object-contain" draggable="false" />
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-app-bg/60 text-sm text-text-secondary">加载预览中…</div>
      <div v-if="error" class="max-w-lg rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-center text-sm text-danger">{{ error }}</div>
    </main>
  </div>
</template>
