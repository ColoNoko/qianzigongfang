<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { useThemeStore } from '@renderer/stores/theme'

const props = defineProps<{ open?: boolean; startWithEntry?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const theme = useThemeStore()
const frame = ref<HTMLIFrameElement>()
const revision = ref(0)
const loaded = ref(false)
const failed = ref(false)
const channel = 'hanhua-guide-host'
const storageKey = 'hanhua-guide-v2'
const tokenMap: Record<string, string> = {
  '--bg': '--bg', '--panel': '--bg-raised', '--ink': '--fg', '--muted': '--fg-muted',
  '--line': '--border', '--accent': '--primary', '--accent-ink': '--primary-fg',
  '--soft': '--primary-soft', '--subtle': '--hover-surface', '--ok': '--success', '--warn': '--warning'
}
function appearance() {
  const root = document.documentElement
  const style = getComputedStyle(root)
  return {
    theme: root.dataset.theme === 'dark' ? 'dark' : 'light',
    colors: Object.fromEntries(Object.entries(tokenMap).map(([key, token]) => [key, style.getPropertyValue(token).trim()]).filter(([, value]) => value))
  }
}
function send(type: string, extra: Record<string, unknown> = {}) {
  frame.value?.contentWindow?.postMessage({ channel, type, ...extra }, '*')
}
function savedState(): string | null {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) return saved
    const legacy = JSON.parse(localStorage.getItem('guide-read-topics') || '[]')
    if (!Array.isArray(legacy)) return null
    const quick = ['welcome', 'add', 'roles', 'view', 'finish', 'wrap', 'return']
    return JSON.stringify({ read: legacy.filter(id => typeof id === 'string').map(id => (quick.includes(id) ? 'quick/' : 'reference/') + id) })
  } catch { return null }
}
function initialize() { send('init', { ...appearance(), saved: savedState() }) }
function receive(event: MessageEvent) {
  if (!props.open || !frame.value?.contentWindow || event.source !== frame.value.contentWindow || event.data?.channel !== channel) return
  switch (event.data.type) {
    case 'ready': initialize(); break
    case 'loaded': loaded.value = true; break
    case 'error': failed.value = true; break
    case 'close': emit('close'); break
    case 'toggle-theme': theme.setTheme(theme.resolvedTheme === 'dark' ? 'light' : 'dark'); break
    case 'save':
      try {
        if (event.data.value === null) localStorage.removeItem(storageKey)
        else if (typeof event.data.value === 'string') {
          const value = JSON.parse(event.data.value)
          if (value && typeof value === 'object' && !Array.isArray(value)) localStorage.setItem(storageKey, event.data.value)
        }
      } catch { /* Reading/practice history is optional when local storage is unavailable. */ }
      break
  }
}
function reload() { loaded.value = false; failed.value = false; revision.value++ }
watch(() => props.open, open => { if (open) reload() })
let observer: MutationObserver | undefined
onMounted(() => {
  window.addEventListener('message', receive)
  observer = new MutationObserver(() => { void nextTick(() => send('appearance', appearance())) })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] })
})
onBeforeUnmount(() => { window.removeEventListener('message', receive); observer?.disconnect() })
</script>

<template>
  <Dialog :open="open" @update:open="value => !value && emit('close')">
    <DialogContent :show-close="false" class="guide-document block w-[calc(100vw-40px)] max-w-[1600px] gap-0 p-0 max-[700px]:w-[calc(100vw-16px)]" data-testid="guide-dialog">
      <DialogTitle class="sr-only">使用指引</DialogTitle>
      <DialogDescription class="sr-only">快速上手与功能查阅，练习使用独立示例数据。</DialogDescription>
      <iframe
        :key="revision"
        ref="frame"
        class="guide-frame"
        title="汉化工坊使用指引"
        data-testid="guide-frame"
        sandbox="allow-scripts"
        :src="`./guide/index.html#${startWithEntry ? 'reference/add' : 'quick/add'}`"
        @load="initialize"
      />
      <div v-if="!loaded" class="guide-loading" role="status">
        <span>{{ failed ? '指引加载失败' : '正在打开指引…' }}</span>
        <Button v-if="failed" variant="outline" size="sm" @click="reload">重新加载</Button>
      </div>
      <Button class="guide-close" variant="ghost" size="icon-sm" aria-label="关闭指引" data-testid="guide-close" @click="emit('close')"><X /></Button>
    </DialogContent>
  </Dialog>
</template>

<style>
.guide-document { width:calc(100vw - 40px); max-width:1600px; height:calc(100dvh - 64px); max-height:1000px; padding:0; gap:0; display:block; overflow:hidden; background:var(--bg-raised); border-color:var(--border); }
.guide-frame { display:block; width:100%; height:100%; border:0; }
.guide-close { position:absolute; right:12px; top:17px; }
.guide-loading { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:12px; background:var(--bg-raised); color:var(--fg-muted); }
@media(max-width:700px) { .guide-document { width:calc(100vw - 16px); height:calc(100dvh - 48px); } .guide-close { top:12px; right:10px; } }
</style>

