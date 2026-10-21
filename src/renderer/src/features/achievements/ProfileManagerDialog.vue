<script setup lang="ts">
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { Button as UiButton } from '@renderer/components/ui/button'
import UiInput from '@renderer/components/ui/ControlInput.vue'
// ProfileManagerDialog —— 「档案管理」（需求一：导出 + 对比档案的增删改）。
//
// 一个弹窗管两件事（2026-10-05 用户看图后拍板的方案 A）：
//   · 我的档案：昵称 + 主职责 + 「导出我的成就」（低频动作不必常驻页头）；
//   · 对比档案：导入进来的他人档案（重命名 / 删除）。
//
// 铁律：这里只碰 `achievementCompare` store 的档案列表，绝不碰自己的成就数据。
import { ref, watch } from 'vue'
import AppSelect from '@renderer/components/AppSelect.vue'
import { useAchievementCompareStore } from '@renderer/stores/achievementCompare'
import { useToastStore } from '@renderer/stores/toast'
import { WORK_MODE_LABELS, WORK_MODE_OPTIONS } from '@shared/modes'
import type { ImportedAchievementProfile } from '@shared/achievement-profile'
import type { WorkMode } from '@shared/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const compare = useAchievementCompareStore()
const toast = useToastStore()

const nickname = ref('')
const duty = ref<string>('')
const busy = ref(false)
const error = ref('')
const successPath = ref('')
const editingId = ref('')
const editingName = ref('')
const importingDb = ref(false)

const dutyOptions = [{ value: '', label: '不填' }, ...WORK_MODE_OPTIONS]

watch(
  () => props.open,
  (open) => {
    if (open) {
      nickname.value = ''
      duty.value = compare.selfDuty ?? ''
      error.value = ''
      successPath.value = ''
    }
    editingId.value = ''
    editingName.value = ''
  }
)

function dutyLabel(profile: ImportedAchievementProfile): string {
  return profile.duty ? WORK_MODE_LABELS[profile.duty] : '未填'
}

/**
 * 从**对方的数据库文件**导入（老版本 / 0.4.0 之类的分支没有导出功能时的通路）：
 * 只读地读他的成绩，不动他的项目、也不碰你自己的数据。
 */
async function importFromDatabase(): Promise<void> {
  if (importingDb.value) return
  importingDb.value = true
  try {
    const result = await compare.importFromDatabase()
    if (result.status === 'imported') {
      toast.addToast({
        type: result.warning ? 'warning' : 'success',
        message: result.warning ?? `已导入「${result.profile.name}」（可在下面重命名）`
      })
    } else if (result.status === 'error') {
      toast.addToast({ type: 'error', message: result.message })
    }
  } finally {
    importingDb.value = false
  }
}

async function exportMine(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  successPath.value = ''
  try {
    const result = await compare.exportMine(
      nickname.value.trim(),
      (duty.value || null) as WorkMode | null
    )
    if (result.status === 'saved') {
      successPath.value = result.path
      toast.addToast({ type: 'success', message: `已导出到 ${result.path}` })
    } else if (result.status === 'error') {
      error.value = result.message
    }
  } finally {
    busy.value = false
  }
}

function startRename(profile: ImportedAchievementProfile): void {
  editingId.value = profile.id
  editingName.value = profile.name
}

async function saveRename(profile: ImportedAchievementProfile): Promise<void> {
  const saved = await compare.renameProfile(profile.id, editingName.value)
  editingId.value = ''
  editingName.value = ''
  toast.addToast(
    saved
      ? { type: 'success', message: '已重命名' }
      : { type: 'error', message: '重命名没能写进本地，请重试' }
  )
}

async function removeProfile(profile: ImportedAchievementProfile): Promise<void> {
  const saved = await compare.removeProfile(profile.id)
  if (editingId.value === profile.id) {
    editingId.value = ''
    editingName.value = ''
  }
  toast.addToast(
    saved
      ? { type: 'success', message: `已删除「${profile.name}」` }
      : { type: 'error', message: '删除没能写进本地，请重试' }
  )
}
</script>

<template>
  <Dialog :open="true" @update:open="!$event && (emit('close'))" v-if="open">
    <DialogContent
      class="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card-bg text-text-primary shadow-[var(--shadow-3)]"
      data-testid="achievement-profiles-dialog"
     :show-close="false" :aria-describedby="undefined">
      <header class="flex items-center gap-3 border-b border-border px-5 py-3">
        <DialogTitle class="text-[15px] font-semibold tracking-tight">
          档案管理
        </DialogTitle>
        <span
          class="shrink-0 rounded-full bg-media-bg px-2 py-0.5 text-[11px] leading-none text-text-tertiary"
        >
          对比档案 {{ compare.profileCount }} 份
        </span>
        <UiButton variant="ghost" size="sm"
          type="button"
          class="ml-auto flex w-7 shrink-0 items-center justify-center transition-colors"
          aria-label="关闭"
          data-testid="achievement-profiles-close"
          @click="emit('close')"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </UiButton>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <!-- 我的档案：导出（低频动作收进这里，页头不再常驻一颗导出按钮） -->
        <section data-testid="archive-mine-section">
          <div class="mb-2 flex flex-wrap items-baseline gap-2">
            <h3 class="text-[13px] font-semibold text-text-primary">我的档案</h3>
            <span class="text-[11px] text-text-tertiary">
              只含昵称与四模式数字账，不含项目名和路径
            </span>
          </div>

          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <UiInput
                v-model="nickname"
                type="text"
                maxlength="40"
                placeholder="昵称（可留空）"
                class="h-9 min-w-0 flex-1 rounded-badge border border-border bg-app-bg px-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
                data-testid="archive-nickname"
              />
              <div class="w-32 shrink-0">
                <AppSelect
                  :model-value="duty"
                  :options="dutyOptions"
                  size="small"
                  test-id="archive-duty"
                  @change="duty = String($event)"
                />
              </div>
            </div>
            <div class="flex items-center gap-2">
              <UiButton variant="default" size="sm"
                type="button"
                class="shrink-0 transition-colors disabled:opacity-40"
                :disabled="busy"
                data-testid="archive-export-confirm"
                @click="exportMine"
              >
                {{ busy ? '导出中…' : '导出我的成就' }}
              </UiButton>
              <p
                v-if="error"
                class="min-w-0 flex-1 truncate text-[12px] text-danger"
                :title="error"
                data-testid="archive-export-error"
              >
                {{ error }}
              </p>
              <p
                v-else-if="successPath"
                class="min-w-0 flex-1 truncate text-[12px] text-text-tertiary"
                :title="successPath"
                data-testid="archive-export-success"
              >
                已导出到 {{ successPath }}
              </p>
            </div>
          </div>
        </section>

        <!-- 对比档案 -->
        <section class="mt-5 border-t border-hairline pt-4" data-testid="archive-profiles-section">
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <h3 class="text-[13px] font-semibold text-text-primary">对比档案</h3>
            <UiButton variant="outline" size="sm"
              type="button"
              class="ml-auto shrink-0 transition-colors disabled:opacity-40"
              :disabled="importingDb"
              data-testid="archive-import-db"
              @click="importFromDatabase"
            >
              {{ importingDb ? '读取中…' : '从数据库文件导入' }}
            </UiButton>
          </div>
          <p class="mb-2 text-[11px] leading-relaxed text-text-tertiary">
            对方没装这个功能（老版本 / 0.4.0 等分支）？让他把
            <code class="rounded bg-app-bg px-1 py-0.5">data\database\qianzi-gongfang.sqlite</code>
            拷给你，用这个按钮导入——只读他的成绩，不动他的项目，也不碰你自己的数据。
          </p>

          <p
            v-if="compare.profiles.length === 0"
            class="rounded-lg border border-border bg-app-bg px-3 py-6 text-center text-[13px] text-text-tertiary"
            data-testid="achievement-profiles-empty"
          >
            还没有导入任何档案。
          </p>

          <ul v-else class="flex flex-col gap-2">
            <li
              v-for="profile in compare.profiles"
              :key="profile.id"
              class="flex items-center gap-2 rounded-lg border border-border bg-app-bg px-3 py-2"
              data-testid="achievement-profile-item"
            >
              <template v-if="editingId === profile.id">
                <UiInput
                  v-model="editingName"
                  type="text"
                  maxlength="40"
                  class="h-8 min-w-0 flex-1 rounded-badge border border-border bg-card-bg px-2 text-[13px] text-text-primary outline-none focus:border-accent"
                  data-testid="achievement-profile-rename-input"
                  @keydown.enter="saveRename(profile)"
                  @keydown.escape="editingId = ''"
                />
                <UiButton variant="default" size="sm"
                  type="button"
                  class="shrink-0"
                  data-testid="achievement-profile-rename-save"
                  @click="saveRename(profile)"
                >
                  保存
                </UiButton>
                <UiButton variant="ghost" size="sm"
                  type="button"
                  class="shrink-0"
                  @click="editingId = ''"
                >
                  取消
                </UiButton>
              </template>
              <template v-else>
                <span class="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                  {{ profile.name }}
                </span>
                <span
                  class="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] leading-none text-accent"
                  data-testid="achievement-profile-duty"
                >
                  {{ dutyLabel(profile) }}
                </span>
                <UiButton variant="ghost" size="sm"
                  type="button"
                  class="shrink-0 transition-colors"
                  :data-testid="`achievement-profile-rename-${profile.id}`"
                  @click="startRename(profile)"
                >
                  重命名
                </UiButton>
                <UiButton variant="destructive" size="sm"
                  type="button"
                  class="shrink-0 transition-colors"
                  :data-testid="`achievement-profile-delete-${profile.id}`"
                  @click="removeProfile(profile)"
                >
                  删除
                </UiButton>
              </template>
            </li>
          </ul>
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>
