<script setup lang="ts">
// ProjectFormModal — Add/Manage/Delete modal form for a ChildProject.
// Pure presentational component: validates the folder path via
// window.comicType.stat on blur, then emits save/cancel/delete.
// Does NOT touch the registry — persistence is the parent's job.
// Task 5.1 of the work plan.
import { lastPathSegment } from '@shared/paths'
import { ref, computed, onMounted } from 'vue'
import {
  extractChapterNumber,
  isValidChapterNumber,
  normalizeChapterNumber,
  sanitizeChapterInput
} from '@shared/chapter'
import AppSelect, { type AppSelectOption } from './AppSelect.vue'

type Mode = 'add' | 'manage'

interface InitialData {
  parentTitle: string
  chapterNumber: string
  projectTitle: string
  folderPath: string
}

interface SavePayload {
  parentTitle: string
  chapterNumber: string
  projectTitle: string
  folderPath: string
}

const props = defineProps<{
  mode: Mode
  initialData?: InitialData
  existingParentTitles?: string[]
}>()

const emit = defineEmits<{
  (e: 'save', payload: SavePayload): void
  (e: 'cancel'): void
  (e: 'delete'): void
}>()

// --- Field state -----------------------------------------------------------
const folderPath = ref('')
const parentTitle = ref('')
const chapterNumber = ref('')
const projectTitle = ref('')
const parentChoice = ref('__new__')
const existingParents = computed(() =>
  [...new Set(props.existingParentTitles ?? [])].sort((a, b) =>
    a.localeCompare(b, 'zh-CN', { numeric: true })
  )
)
const parentOptions = computed<AppSelectOption[]>(() => [
  { value: '__new__', label: '新建漫画父级' },
  ...existingParents.value.map((title) => ({ value: title, label: title }))
])

// --- Validation state ------------------------------------------------------
// pathValid: null = not yet checked, true = stat ok, false = error.
const pathValid = ref<boolean | null>(null)
const pathError = ref('')
const pathChecking = ref(false)
const overlayPointerStarted = ref(false)

// Prefill when a caller supplies a path (the import page uses this for the
// optional "生成后导入项目" flow) and keep the existing manage behavior.
onMounted(() => {
  if (props.initialData) {
    folderPath.value = props.initialData.folderPath
    parentTitle.value = props.initialData.parentTitle
    chapterNumber.value = normalizeChapterNumber(props.initialData.chapterNumber)
    projectTitle.value = props.initialData.projectTitle
    // Pre-validate the supplied path so the save button is enabled immediately.
    void validatePath()
  }
})

// Autofocus the 集数 field in add mode.
const chapterInput = ref<HTMLInputElement | null>(null)
onMounted(() => {
  if (props.mode === 'add' && chapterInput.value) {
    chapterInput.value.focus()
  }
})

// --- Path validation -------------------------------------------------------
async function validatePath(): Promise<void> {
  if (!folderPath.value.trim()) {
    pathValid.value = false
    pathError.value = '路径不能为空'
    return
  }
  pathChecking.value = true
  try {
    await window.comicType.stat(folderPath.value.trim())
    pathValid.value = true
    pathError.value = ''
    inferChapterFromPath()
  } catch {
    pathValid.value = false
    pathError.value = '路径不可读或不存在'
  } finally {
    pathChecking.value = false
  }
}

function basename(absPath: string): string {
  return lastPathSegment(absPath)
}

function inferChapterFromPath(): void {
  if (chapterNumber.value) return
  chapterNumber.value = extractChapterNumber(basename(folderPath.value.trim()))
}

function onChapterInput(event: Event): void {
  chapterNumber.value = sanitizeChapterInput((event.target as HTMLInputElement).value)
}

// --- Browse button ---------------------------------------------------------
async function onBrowse(): Promise<void> {
  const picked = await window.comicType.pickDirectory()
  if (picked) {
    folderPath.value = picked
    await validatePath()
  }
}

// --- Save / Cancel / Delete ------------------------------------------------
const chapterValid = computed(() => isValidChapterNumber(chapterNumber.value))
const canSave = computed(
  () =>
    parentTitle.value.trim().length > 0 &&
    pathValid.value === true &&
    !pathChecking.value &&
    (chapterNumber.value === '' || chapterValid.value)
)

function onSave(): void {
  if (!canSave.value) return
  emit('save', {
    parentTitle: parentTitle.value.trim(),
    chapterNumber: normalizeChapterNumber(chapterNumber.value),
    projectTitle: projectTitle.value,
    folderPath: folderPath.value.trim()
  })
}

function onParentChoice(value: string | number): void {
  parentChoice.value = String(value)
  if (parentChoice.value !== '__new__') parentTitle.value = parentChoice.value
}

function onCancel(): void {
  emit('cancel')
}

function onOverlayClick(): void {
  if (overlayPointerStarted.value) emit('cancel')
  overlayPointerStarted.value = false
}

function onDelete(): void {
  emit('delete')
}
</script>

<template>
  <!-- Modal overlay -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    @pointerdown.self="overlayPointerStarted = true"
    @click.self="onOverlayClick"
  >
    <!-- Card -->
    <div
      class="w-full max-w-lg rounded-xl border border-border bg-card-bg p-6 text-text-primary shadow-[var(--shadow-3)]"
    >
      <!-- Title -->
      <h2 class="mb-4 text-lg font-bold text-accent">
        {{ mode === 'add' ? '添加项目' : '管理项目' }}
      </h2>

      <!-- Form fields -->
      <div class="space-y-4">
        <!-- 1. 项目所在文件夹路径 -->
        <div>
          <label class="mb-1 block text-sm text-text-secondary">项目所在文件夹路径</label>
          <div class="flex gap-2">
            <input
              v-model="folderPath"
              type="text"
              class="flex-1 rounded-badge border border-border bg-app-bg px-3 py-2 text-text-primary outline-none focus:border-accent"
              @blur="validatePath"
            />
            <button
              class="rounded-badge bg-accent px-4 py-2 text-sm text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active"
              @click="onBrowse"
            >
              浏览
            </button>
          </div>
          <p v-if="pathError" class="mt-1 text-sm text-danger">{{ pathError }}</p>
        </div>

        <!-- 2. 漫画名称(父级) -->
        <div>
          <label class="mb-1 block text-sm text-text-secondary">漫画名称(父级)</label>
          <AppSelect
            v-if="mode === 'add' && existingParents.length > 0"
            class="mb-2 w-full"
            :model-value="parentChoice"
            :options="parentOptions"
            test-id="existing-parent-select"
            @update:model-value="onParentChoice"
          />
          <input
            v-model="parentTitle"
            type="text"
            :disabled="mode === 'add' && parentChoice !== '__new__'"
            class="w-full rounded-badge border border-border bg-app-bg px-3 py-2 text-text-primary outline-none focus:border-accent"
          />
        </div>

        <!-- 3. 集数 -->
        <div>
          <label class="mb-1 block text-sm text-text-secondary">集数</label>
          <input
            ref="chapterInput"
            v-model="chapterNumber"
            type="text"
            inputmode="text"
            class="w-full rounded-badge border border-border bg-app-bg px-3 py-2 text-text-primary outline-none focus:border-accent"
            @input="onChapterInput"
          />
          <p v-if="chapterNumber && !chapterValid" class="mt-1 text-sm text-danger">
            集数可填写数字、小数或中文
          </p>
        </div>

        <!-- 4. 项目标题 -->
        <div>
          <label class="mb-1 block text-sm text-text-secondary">项目标题</label>
          <input
            v-model="projectTitle"
            type="text"
            class="w-full rounded-badge border border-border bg-app-bg px-3 py-2 text-text-primary outline-none focus:border-accent"
          />
        </div>
      </div>

      <!-- Action row -->
      <div class="mt-6 flex justify-end gap-2">
        <!-- Delete: only in manage mode -->
        <button
          v-if="mode === 'manage'"
          class="rounded-badge border border-danger px-4 py-2 text-sm text-danger transition-colors hover:bg-danger hover:text-danger-fg"
          @click="onDelete"
        >
          删除
        </button>
        <button
          class="rounded-badge border border-border px-4 py-2 text-sm text-text-primary transition-colors hover:bg-card-bg-hover"
          @click="onCancel"
        >
          取消
        </button>
        <button
          class="rounded-badge bg-accent px-4 py-2 text-sm text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canSave"
          @click="onSave"
        >
          保存
        </button>
      </div>
    </div>
  </div>
</template>
