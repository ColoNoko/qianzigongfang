<script setup lang="ts">
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { Button as UiButton } from '@renderer/components/ui/button'
import UiInput from '@renderer/components/ui/ControlInput.vue'
// ProjectFormModal — Add/Manage/Delete modal form for a ChildProject.
// Validates the folder path on blur via window.comicType.stat，并额外用
// window.comicType.projectGetTree()（**只读**）挡住"选到了别的章节的上级目录"
// （2026-10-04 现场），然后 emit save/cancel/delete。
// 仍然不**写**注册表 —— persistence is the parent's job.
// Task 5.1 of the work plan.
import { isStrictlyInside, lastPathSegment } from '@shared/paths'
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  extractChapterNumber,
  isValidChapterNumber,
  normalizeChapterNumber,
  sanitizeChapterInput
} from '@shared/chapter'
import AppSelect, { type AppSelectOption } from './AppSelect.vue'
import { PROJECT_FORM_HINTS } from './project-form-hints'

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
  saving?: boolean
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
const dialog = ref<HTMLElement | null>(null)
const previousFocus = document.activeElement as HTMLElement | null
onMounted(() => {
  if (props.mode === 'add' && chapterInput.value) {
    chapterInput.value.focus()
  } else {
    dialog.value?.querySelector<HTMLInputElement>('input')?.focus()
  }
})
onBeforeUnmount(() => previousFocus?.focus())

function onDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
  }
  if (event.key !== 'Tab') return
  const controls = Array.from(dialog.value?.querySelectorAll<HTMLElement>(
    ':is(button, input, [tabindex="0"]):not(:disabled)'
  ) ?? []).filter((element) => !element.closest('[popover]') && element.tabIndex >= 0)
  const first = controls[0]
  const last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

// --- Path validation -------------------------------------------------------
/**
 * 这个路径是不是**某个已登记章节目录的严格祖先**（2026-10-04 现场，2026-10-05 收编）。
 *
 * 为什么要有它：那种路径一旦存进去，"刷新并检测新章节"会把**同级作品**当成这一话的
 * 新章节报出来。现场两条实测：
 *   · 把 6卷 的路径改成了 `…\老师的人偶（米饭`（= 5卷/6卷 的父目录）
 *     ⇒ 反推出来的根爬到 `…\嵌字`，一次报出 15 条**别人的作品**；
 *   · `白沙水族馆` 的路径本身是对的，但 `dirname` 落在分类层 `…\翻译` ⇒ 7 条误报
 *     （那一条这里拦不住，由主进程的"容器层不自动推导"兜住）。
 *
 * ⚠️ 判据是 `@shared/paths` 的 `isStrictlyInside`（**严格**在内部：等于自己不算）——
 *    与主进程那边的容器层判定用的是**同一处**实现（2026-10-05 收敛）。
 *    这里原本自己写了一份"归一化后比字符串前缀"的版本。两把尺子各写一遍的代价不是好看：
 *    哪天只改一边，就会出现"录入放行、推导报错"（或反过来）—— 本仓库在职责胶囊、
 *    配对键上都吃过这个亏。跨盘 / 大小写 / NFC / 尾斜杠统一由那一处处理。
 * ⚠️ 判据刻意**只用路径关系**，不用"像不像章节"的启发式 —— 那类启发式正是本次 bug 的来源。
 * ⚠️ 读不到项目树时**不拦**：校验环节出问题，不该变成"存不了项目"。
 */
async function isAncestorOfRegisteredChild(target: string): Promise<boolean> {
  try {
    const tree = await window.comicType.projectGetTree()
    for (const parent of tree) {
      for (const child of parent.children) {
        if (isStrictlyInside(target, child.folderPath)) return true
      }
    }
  } catch {
    return false
  }
  return false
}

async function validatePath(): Promise<void> {
  if (!folderPath.value.trim()) {
    pathValid.value = false
    pathError.value = ''
    return
  }
  pathChecking.value = true
  try {
    const target = folderPath.value.trim()
    // 两个只读检查**并行**发出。别改成串行 —— 那会多一次往返，实测会把"保存"按钮
    // 多禁用一拍（既有用例按 tick 数卡着这一点）。
    const [, isAncestor] = await Promise.all([
      window.comicType.stat(target),
      isAncestorOfRegisteredChild(target)
    ])
    if (isAncestor) {
      pathValid.value = false
      pathError.value = '这是别的章节的上级目录，请选到「话」那一层'
      return
    }
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
    !props.saving &&
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



function onDelete(): void {
  emit('delete')
}
</script>

<template>
  <!-- Modal overlay -->
  <Dialog :open="true" @update:open="!$event && (emit('cancel'))">
    <!-- Card -->
    <DialogContent
      ref="dialog"
      class="max-h-[calc(100dvh-2rem)] overflow-y-auto w-full max-w-lg rounded-xl border border-border bg-card-bg p-6 text-text-primary shadow-[var(--shadow-3)]"
      @keydown="onDialogKeydown"
     :show-close="false" :aria-describedby="undefined">
      <!-- Title -->
      <DialogTitle class="mb-4 text-lg font-bold text-accent">
        {{ mode === 'add' ? '添加项目' : '管理项目' }}
      </DialogTitle>

      <!-- Form fields -->
      <div class="space-y-4">
        <!-- 1. 项目所在文件夹路径 -->
        <div>
          <!-- 必填星号只挂在**真正卡住保存**的那两项上（与 `canSave` 逐条对应）：
               路径（校验通过）与漫画名称(父级)（非空）。清单在
               `project-form-hints.ts` 的 PROJECT_FORM_REQUIRED，一处定义。
               星号本身对读屏隐藏，必填语义走 input 的 aria-required。 -->
          <label for="project-form-folderPath" class="mb-1 block text-sm text-text-secondary"
            >项目所在文件夹路径<span
              class="ml-0.5 text-danger"
              data-testid="required-mark"
              aria-hidden="true"
              >*</span
            ></label
          >
          <div class="flex gap-2">
            <UiInput
              id="project-form-folderPath"
              v-model="folderPath"
              type="text"
              :placeholder="PROJECT_FORM_HINTS.folderPath"
              aria-required="true"
              class="h-9 min-w-0 flex-1 rounded-badge border border-border bg-app-bg px-3 text-sm text-text-primary outline-none focus:border-accent"
              @blur="validatePath"
            />
            <UiButton variant="default" size="sm"
              class="transition-colors"
              @click="onBrowse"
            >
              浏览
            </UiButton>
          </div>
          <p v-if="pathError" class="mt-1 text-sm text-danger">{{ pathError }}</p>
        </div>

        <!-- 2. 漫画名称(父级) -->
        <div>
          <label for="project-form-parentTitle" class="mb-1 block text-sm text-text-secondary"
            >漫画名称(父级)<span
              class="ml-0.5 text-danger"
              data-testid="required-mark"
              aria-hidden="true"
              >*</span
            ></label
          >
          <AppSelect
            v-if="mode === 'add' && existingParents.length > 0"
            class="mb-2 w-full"
            :model-value="parentChoice"
            :options="parentOptions"
            test-id="existing-parent-select"
            @update:model-value="onParentChoice"
          />
          <UiInput
            id="project-form-parentTitle"
              v-model="parentTitle"
            type="text"
            :placeholder="PROJECT_FORM_HINTS.parentTitle"
            aria-required="true"
            :disabled="mode === 'add' && parentChoice !== '__new__'"
            class="h-9 w-full rounded-badge border border-border bg-app-bg px-3 text-sm text-text-primary outline-none focus:border-accent"
          />
        </div>

        <!-- 3. 集数 -->
        <div>
          <label for="project-form-chapterNumber" class="mb-1 block text-sm text-text-secondary">集数</label>
          <UiInput
            ref="chapterInput"
            id="project-form-chapterNumber"
              v-model="chapterNumber"
            type="text"
            inputmode="text"
            :placeholder="PROJECT_FORM_HINTS.chapterNumber"
            class="h-9 w-full rounded-badge border border-border bg-app-bg px-3 text-sm text-text-primary outline-none focus:border-accent"
            @input="onChapterInput"
          />
          <p v-if="chapterNumber && !chapterValid" class="mt-1 text-sm text-danger">
            集数可填写数字、小数或中文
          </p>
        </div>

        <!-- 4. 项目标题 -->
        <div>
          <label for="project-form-projectTitle" class="mb-1 block text-sm text-text-secondary">项目标题</label>
          <UiInput
            id="project-form-projectTitle"
              v-model="projectTitle"
            type="text"
            :placeholder="PROJECT_FORM_HINTS.projectTitle"
            class="h-9 w-full rounded-badge border border-border bg-app-bg px-3 text-sm text-text-primary outline-none focus:border-accent"
          />
        </div>
      </div>

      <!-- Action row -->
      <div class="mt-6 flex justify-end gap-2">
        <!-- Delete: only in manage mode -->
        <UiButton variant="destructive" size="sm"
          v-if="mode === 'manage'"
          class="transition-colors"
          @click="onDelete"
        >
          删除
        </UiButton>
        <UiButton variant="outline" size="sm"
          class="transition-colors"
          @click="onCancel"
        >
          取消
        </UiButton>
        <UiButton variant="default" size="sm"
          class="transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canSave"
          @click="onSave"
        >
          {{ saving ? '保存中…' : '保存' }}
        </UiButton>
      </div>
    </DialogContent>
  </Dialog>
</template>
