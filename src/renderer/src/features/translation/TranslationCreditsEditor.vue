<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { formatTranslationCredits, type TranslationCredits } from '@shared/translation-credits'
import { Popover, PopoverTrigger, PopoverContent } from '@renderer/components/ui/popover'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
const props = defineProps<{ credits?: TranslationCredits; disabled?: boolean; mode?: string; prepare?: () => Promise<TranslationCredits> }>()
const emit = defineEmits<{ save: [credits: TranslationCredits, done: (error?: string) => void] }>()
const independent = computed(() => props.mode === 'typeset' || props.mode === 'supervised')
const open = ref(false)
const saving = ref(false)
const ready = ref(false)
const error = ref('')
const draft = reactive<TranslationCredits>({ translator: '', proofreader: '', combined: false })
const locked = computed(() => !independent.value && draft.combined)
const combinedForSave = computed(() => draft.combined && (!independent.value || draft.translator.trim() === draft.proofreader.trim()))
watch([locked, () => draft.translator], () => { if (locked.value) draft.proofreader = draft.translator })
async function changeOpen(value: boolean): Promise<void> {
  if (saving.value) return
  open.value = value
  if (!value) return
  error.value = ''
  ready.value = false
  saving.value = true
  try {
    Object.assign(draft, {source:'',typesetter:'',supervisor:'',translator:'',proofreader:'',combined:false}, props.prepare ? await props.prepare() : props.credits)
    if (draft.combined) draft.proofreader = draft.translator
    ready.value = true
  } catch (e) { error.value = String(e) }
  finally { saving.value = false }
}
async function copy(): Promise<void> {
  try { await navigator.clipboard.writeText(formatTranslationCredits({ ...draft, combined: combinedForSave.value })); error.value = '' }
  catch { error.value = '复制失败，请重试。' }
}
function save(): void {
  if (saving.value || props.disabled || !ready.value) return
  saving.value = true
  emit('save', { ...draft, initialized: true, combined: combinedForSave.value, proofreader: locked.value ? draft.translator : draft.proofreader }, message => {
    saving.value = false
    error.value = message ?? ''
    if (!message) open.value = false
  })
}
</script>
<template>
  <Popover :open="open" :modal="true" @update:open="changeOpen">
    <PopoverTrigger as-child><Button variant="outline" size="sm" :disabled="disabled" data-testid="translation-credits">署名</Button></PopoverTrigger>
    <PopoverContent class="w-96" align="start">
      <form class="flex flex-col gap-3" @submit.prevent="save">
        <div><h3 class="text-sm font-semibold">本话署名</h3><p class="text-xs text-muted-foreground">保存到当前译文 TXT，随文件保留。</p></div>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex flex-col gap-1 text-sm">图源<Input v-model="draft.source" maxlength="120" :disabled="saving" aria-label="图源署名" /></label>
          <label class="flex flex-col gap-1 text-sm">翻译<Input v-model="draft.translator" maxlength="120" :disabled="saving" aria-label="翻译署名" /></label>
          <label class="flex flex-col gap-1 text-sm">校对<Input :model-value="locked ? draft.translator : draft.proofreader" :disabled="locked || saving" maxlength="120" aria-label="校对署名" @update:model-value="draft.proofreader = String($event)" /></label>
          <label class="flex flex-col gap-1 text-sm">嵌字<Input v-model="draft.typesetter" maxlength="120" :disabled="saving" aria-label="嵌字署名" /></label>
          <label class="flex flex-col gap-1 text-sm">监修<Input v-model="draft.supervisor" maxlength="120" :disabled="saving" aria-label="监修署名" /></label>
        </div>
        <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
        <div class="flex items-center justify-end gap-2"><label v-if="!independent" class="flex items-center mr-auto gap-2 text-sm">翻校一体<Switch v-model="draft.combined" :disabled="saving" aria-label="翻校一体" /></label><Button v-if="independent" variant="outline" size="sm" class="mr-auto" :disabled="saving || !ready" @click="copy">一键复制</Button><Button variant="ghost" size="sm" :disabled="saving" @click="changeOpen(false)">取消</Button><Button type="submit" size="sm" :disabled="saving || disabled || !ready">{{ saving ? '保存中…' : '保存' }}</Button></div>
      </form>
    </PopoverContent>
  </Popover>
</template>
