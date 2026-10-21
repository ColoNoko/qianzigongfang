<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import SettingRow from './SettingRow.vue'
const props = defineProps<{ title: string; description: string; value: string; field: string }>()
const emit = defineEmits<{ browse: []; save: [path: string] }>()
const opened = ref(false), draft = ref(''), status = ref('未配置')
let generation = 0
watch(() => props.value, async value => {
  draft.value = value
  const token = ++generation
  if (!value) { status.value = '未配置'; return }
  status.value = '检查中…'
  try {
    const info = await window.comicType.stat(value)
    if (token === generation) status.value = info.isFile ? '已配置' : '文件不存在'
  } catch { if (token === generation) status.value = '文件不可用' }
}, { immediate: true })
function open(value: boolean) { opened.value = value; draft.value = props.value }
function save(value: string) { emit('save', value); opened.value = false }
</script>
<template>
  <SettingRow :title="title" :description="description">
    <template #description><p v-if="value" class="mt-1 max-w-[42ch] truncate text-xs text-muted-foreground" :title="value">{{ value.split(/[\\/]/).pop() }}</p></template>
    <span class="text-xs text-muted-foreground" role="status">{{ status }}</span>
    <Button variant="outline" size="sm" :data-testid="`tool-browse-${field}`" @click="emit('browse')">{{ value ? '更换' : '选择文件' }}</Button>
    <Popover :open="opened" @update:open="open">
      <PopoverTrigger as-child><Button variant="ghost" size="sm" :aria-label="`${title}更多选项`">更多</Button></PopoverTrigger>
      <PopoverContent align="end" class="w-80 max-w-[calc(100vw-2rem)]">
        <label :for="`tool-${field}`" class="text-sm font-medium">{{ title }}路径</label>
        <Input :id="`tool-${field}`" v-model="draft" class="mt-3" :data-testid="`tool-path-${field}`" spellcheck="false" @keydown.enter="save(draft)" />
        <div class="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" :disabled="!value" :data-testid="`tool-clear-${field}`" @click="save('')">清除配置</Button>
          <Button variant="outline" size="sm" @click="opened = false">取消</Button>
          <Button size="sm" @click="save(draft)">保存</Button>
        </div>
      </PopoverContent>
    </Popover>
  </SettingRow>
</template>
