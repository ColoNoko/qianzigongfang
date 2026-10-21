<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Toaster } from './ui/sonner'
import { useToastStore } from '@renderer/stores/toast'
import 'vue-sonner/style.css'
const store = useToastStore()
const shown = new Map<string, string>()
watch(() => store.toasts.slice(), items => {
  for (const item of items) if (shown.get(item.id) !== `${item.type}:${item.message}`) {
    shown.set(item.id, `${item.type}:${item.message}`)
    toast[item.type](item.message, { id: item.id, duration: Infinity, onDismiss: () => store.removeToast(item.id), class: 'font-bold', action: { label: '关闭', onClick: () => store.removeToast(item.id) } })
  }
  for (const id of shown.keys()) if (!items.some(item => item.id === id)) { toast.dismiss(id); shown.delete(id) }
}, { immediate: true })
onBeforeUnmount(() => { for (const id of shown.keys()) toast.dismiss(id) })
</script>
<template><Toaster position="top-center" rich-colors :expand="false" /></template>
