<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { confirmation, settleConfirmation } from '@renderer/services/confirm'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from './ui/alert-dialog'
onBeforeUnmount(() => settleConfirmation(false))
</script>
<template>
  <AlertDialog :open="!!confirmation" @update:open="!$event && settleConfirmation(false)">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>确认操作</AlertDialogTitle>
        <AlertDialogDescription class="whitespace-pre-line">{{ confirmation?.message }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="settleConfirmation(false)">取消</AlertDialogCancel>
        <AlertDialogAction @click.capture="settleConfirmation(true)">确认</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
