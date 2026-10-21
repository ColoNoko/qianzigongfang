<script setup lang="ts">
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@renderer/components/ui/alert-dialog'
import { Button } from '@renderer/components/ui/button'
withDefaults(defineProps<{ visible: boolean; message: string; currentLabel?: string }>(), { currentLabel: '' })
const emit = defineEmits<{ reload: []; force: []; close: [] }>()
</script>
<template>
  <AlertDialog :open="visible" @update:open="value => { if (!value) emit('close') }">
    <AlertDialogContent data-testid="translation-conflict">
      <AlertDialogHeader>
        <AlertDialogTitle>这个 txt 被别处改过了</AlertDialogTitle>
        <AlertDialogDescription data-testid="translation-conflict-message">{{ message }}</AlertDialogDescription>
      </AlertDialogHeader>
      <p v-if="currentLabel" class="text-xs text-muted-foreground">{{ currentLabel }}</p>
      <p class="text-xs text-muted-foreground">尚未写入，可以取消并保留当前草稿。</p>
      <AlertDialogFooter class="flex-wrap">
        <Button variant="ghost" @click="emit('close')">取消</Button>
        <Button variant="outline" data-testid="translation-conflict-reload" @click="emit('reload')">重新读取（丢掉我的改动）</Button>
        <Button variant="destructive" data-testid="translation-conflict-force" @click="emit('force')">强制覆盖（丢掉对方改动）</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
