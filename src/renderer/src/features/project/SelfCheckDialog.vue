<script setup lang="ts">
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import AppSelect from "@renderer/components/AppSelect.vue"
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { Button as UiButton } from '@renderer/components/ui/button'
import UiInput from '@renderer/components/ui/ControlInput.vue'
import { computed, ref } from 'vue'
import type {
  SelfCheckExistingChapter,
  SelfCheckPreviewResult,
  SelfCheckRenameHint
} from '@shared/ipc-api'
import { formatChapterNumber } from '@shared/chapter'
import { lastPathSegment } from '@shared/paths'

const props = withDefaults(
  defineProps<{
    visible: boolean
    busy: boolean
    running: boolean
    preview: SelfCheckPreviewResult | null
    sourceRoot: string
    conflictActions: Record<string, 'skip' | 'second-version'>
    neverAsk: boolean
    silentSelfCheck: boolean
    /** 「疑似改名」提示（R1）：候选路径 → 疑似就是那一话（指纹完全相同）。 */
    renameHints?: Record<string, SelfCheckRenameHint>
  }>(),
  {
    preview: null,
    sourceRoot: '',
    conflictActions: () => ({}),
    neverAsk: false,
    silentSelfCheck: false,
    renameHints: () => ({})
  }
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pickDirectory'): void
  (e: 'runWithSource', remember: boolean): void
  (e: 'setConflictAction', folderPath: string, action: 'skip' | 'second-version'): void
  (e: 'update:neverAsk', value: boolean): void
  (e: 'confirm'): void
  /** 「认领」：候选不是新章节，而是某一话改了名（只换 folderPath，标记不动）。 */
  (e: 'reclaim', folderPath: string, childId: string): void
  /** 「检查是不是改名」（R1）：逐个候选比对内容指纹。 */
  (e: 'detectRenames'): void
}>()

const candidates = computed(() => props.preview?.candidates ?? [])
const canDetect = computed(() => props.preview?.canDetect ?? false)
/** 因为"已经在库里登记过"而被跳过的目录数（它们不是新章节）。 */
const skippedPaths = computed(() => props.preview?.duplicatePaths ?? 0)

/**
 * 候选多到"不像一次正常新增"的门槛（2026-10-05 用户拍板取 20）。
 *
 * 依据是**现场**：2026-10-04 那次一次报出 **28 条**，全是别人的作品 ——
 * 扫描根被反推到了作品目录（分类层）那一层。数量本身是最便宜的信号：
 * 炸出几十条时，第一件该怀疑的就是"根选高了"。
 *
 * ⚠️ 它**只是提醒、绝不拦人**：首次登记一本新漫画时几十话完全合法，
 * 所以这一条**不许**去动导入按钮的 disabled（`SelfCheckDialog.spec.ts` 锁着这件事）。
 */
const MANY_CANDIDATES = 20
const manyCandidates = computed(() => candidates.value.length >= MANY_CANDIDATES)

const hasConflict = computed(() =>
  candidates.value.some((candidate) => candidate.conflict === 'same-chapter')
)
const hasUnresolvedConflict = computed(() =>
  candidates.value.some(
    (candidate) =>
      candidate.conflict === 'same-chapter' && !props.conflictActions[candidate.folderPath]
  )
)

const existingChapters = computed<SelfCheckExistingChapter[]>(
  () => props.preview?.existingChapters ?? []
)

// 「认领」小面板：同一时刻只开一个候选；选了人再确认。
const reclaimOpenFor = ref<string | null>(null)
const reclaimChildId = ref('')

/** 既有话在下拉里的文案：集数 · 标题（+ "目录不在"这条最重要的线索）。 */
function chapterLabel(chapter: SelfCheckExistingChapter): string {
  const title = chapter.projectTitle || lastPathSegment(chapter.folderPath)
  const head = `${formatChapterNumber(chapter.chapterNumber)} · ${title}`
  return chapter.missing ? `${head}（目录不在）` : head
}

/** 有"目录不在"的旧话时才值得检查改名（那是改名的形状）。 */
const hasMissingChapters = computed(() =>
  existingChapters.value.some((chapter) => chapter.missing === true)
)

function renameHintOf(folderPath: string): SelfCheckRenameHint | undefined {
  return props.renameHints?.[folderPath]
}

/** 点提示上的"就是它"：把认领面板打开并预选那一话（**仍要用户点确认**）。 */
function applyRenameHint(folderPath: string): void {
  const hint = renameHintOf(folderPath)
  if (!hint) return
  reclaimOpenFor.value = folderPath
  reclaimChildId.value = hint.childId
}

function toggleReclaim(folderPath: string): void {
  reclaimOpenFor.value = reclaimOpenFor.value === folderPath ? null : folderPath
  reclaimChildId.value = ''
}

function confirmReclaim(folderPath: string): void {
  if (!reclaimChildId.value) return
  emit('reclaim', folderPath, reclaimChildId.value)
  reclaimOpenFor.value = null
  reclaimChildId.value = ''
}

function onNeverAskChange(event: Event): void {
  emit('update:neverAsk', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <Dialog :open="true" @update:open="!$event && (emit('close'))" v-if="visible">
    <DialogContent
      class="max-h-[80vh] w-full max-w-lg overflow-auto rounded-xl border border-border bg-card-bg shadow-[var(--shadow-3)]"
     :show-close="false" :aria-describedby="undefined">
      <div class="flex items-center justify-between border-b border-border px-5 py-3">
        <DialogTitle class="text-sm font-bold text-text-primary">刷新并检测新章节</DialogTitle>
        <UiButton variant="ghost" size="sm"
          type="button"
          class="disabled:opacity-40"
          :disabled="busy || running"
          aria-label="关闭"
          @click="emit('close')"
        >
          ✕
        </UiButton>
      </div>

      <div class="space-y-4 px-5 py-4">
        <div v-if="busy || running" class="py-8 text-center text-sm text-text-secondary">
          正在检测并处理…
        </div>

        <template v-else-if="!preview || !canDetect">
          <div>
            <p class="text-sm text-text-secondary">
              {{ preview?.message || '无法自动确定父级目录，请手动选择一次。' }}
            </p>
            <div class="mt-3 flex flex-col gap-2">
              <UiButton variant="outline" size="sm"
                type="button"
                class="transition-colors"
                data-testid="pick-self-check-source"
                @click="emit('pickDirectory')"
              >
                {{ sourceRoot ? '重新选择目录…' : '选择目录…' }}
              </UiButton>
              <p v-if="sourceRoot" class="break-all text-xs text-text-tertiary">
                {{ sourceRoot }}
              </p>
              <div v-if="sourceRoot" class="mt-2 flex flex-wrap gap-2">
                <UiButton variant="outline" size="sm"
                  type="button"
                  class="transition-colors"
                  data-testid="self-check-use-once"
                  @click="emit('runWithSource', false)"
                >
                  仅本次检测
                </UiButton>
                <UiButton variant="default" size="sm"
                  type="button"
                  class="transition-colors"
                  data-testid="self-check-remember-source"
                  @click="emit('runWithSource', true)"
                >
                  记住此目录并检测
                </UiButton>
              </div>
            </div>
          </div>
        </template>

        <template v-else>
          <div>
            <p class="text-sm text-text-primary">
              检测到 <strong>{{ candidates.length }}</strong> 个新章节。
            </p>
            <!-- 扫描目录必须可见。自动检测成功时以前**不显示**扫的是哪个目录，
                 所以"扫到了上一层分类目录"这件事可以一直瞒着用户 —— 那一话
                 的子项目分散在 无/有 两个目录里时就会踩到。 -->
            <ul
              v-if="preview?.sourceRoots?.length"
              class="mt-1 space-y-0.5"
              data-testid="self-check-roots"
            >
              <li
                v-for="root in preview.sourceRoots"
                :key="root"
                class="break-all text-xs text-text-tertiary"
              >
                {{ root }}<span v-if="preview.unreadableRoots?.includes(root)">（读不到）</span>
              </li>
            </ul>
            <!-- 被跳过的已登记目录要说一声（2026-10-05）。以前只报"检测到 N 个新章节"，
                 用户看不到"另外还有 3 个目录因为已登记被跳过"，也就没法判断
                 "这次到底看全了没有"。一个都没跳过时整句不出现。 -->
            <p
              v-if="skippedPaths > 0"
              class="mt-1 text-xs text-text-tertiary"
              data-testid="self-check-skipped"
            >
              已跳过 <strong>{{ skippedPaths }}</strong> 个已登记的目录（它们不是新章节）
            </p>
          </div>

          <!-- 数量反常的提醒（2026-10-05）。它**只是提醒**：不禁用导入、不改任何判定 ——
               上次的教训正是"用启发式替用户做决定"，这里只把可疑之处摆到人眼前。 -->
          <div
            v-if="manyCandidates"
            class="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning"
            data-testid="self-check-many-candidates"
          >
            候选有
            <strong>{{ candidates.length }}</strong> 条，数量不太寻常。请先核对上面的扫描目录：
            若它落在了"作品 / 分类"那一层（而不是各话所在的那一层），这里就会把别的作品当成新章节。
            确认无误再导入。
          </div>

          <!-- 只有在"有目录不在的旧话"时才给这个按钮：那才是改名的形状；
               没有它时点了什么也检测不出来，不如不显示（免得像坏了）。 -->
          <div v-if="hasMissingChapters" class="flex items-center gap-2 text-xs">
            <UiButton variant="outline" size="sm"
              type="button"
              class="transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="busy"
              data-testid="detect-renames"
              @click="emit('detectRenames')"
            >
              检查是不是改名（比对内容指纹）
            </UiButton>
            <span class="text-text-tertiary"
              >有 {{ existingChapters.filter((c) => c.missing).length }} 话的目录不在</span
            >
          </div>

          <div
            class="max-h-64 space-y-2 overflow-auto rounded-lg border border-border bg-app-bg p-2"
          >
            <div
              v-for="candidate in candidates"
              :key="candidate.folderPath"
              class="rounded-md border border-border bg-card-bg p-2"
            >
              <div class="flex items-center justify-between gap-3">
                <span class="min-w-0 truncate text-sm font-medium text-text-primary">
                  {{ candidate.folderName }}
                </span>
                <span class="shrink-0 text-xs text-text-tertiary">
                  {{ candidate.chapterNumber || '未识别集数' }}
                </span>
              </div>

              <div v-if="candidate.conflict === 'same-chapter'" class="mt-2 space-y-1 text-xs">
                <p class="text-text-secondary">同父级下已存在该集数，请选择处理方式：</p>
                <!-- 2026-10-05：把"撞上的是哪一话"摆出来（标题 + 它自己的路径）。
                     ⚠️ 只报事实 —— 集数相同**不等于**同一话：同一个父级里可能有
                     两套命名（`… - 姐煩19` / `… - 戀上19`）或多部作品共用数字，
                     只有用户判得出来。程序不替他下结论。 -->
                <div
                  v-if="candidate.existingChapterTitle"
                  class="rounded border border-border bg-app-bg px-2 py-1.5"
                  data-testid="conflict-existing"
                >
                  <p class="text-text-secondary">
                    已存在：<span class="text-text-primary">{{
                      candidate.existingChapterTitle
                    }}</span>
                  </p>
                  <p
                    v-if="candidate.existingChapterPath"
                    class="mt-0.5 break-all text-[11px] leading-4 text-text-tertiary"
                  >
                    {{ candidate.existingChapterPath }}
                  </p>
                </div>
                <RadioGroup :model-value="conflictActions[candidate.folderPath]" @update:model-value="emit('setConflictAction', candidate.folderPath, $event as 'second-version' | 'skip')">
                <label class="flex cursor-pointer items-center gap-2 text-text-primary">
                  <RadioGroupItem
                    value="second-version"
                    data-testid="conflict-second-version"
                  />
                  导入为第二版本（章节号自动加后缀）
                </label>
                <label class="flex cursor-pointer items-center gap-2 text-text-primary">
                  <RadioGroupItem
                    value="skip"
                    data-testid="conflict-skip"
                  />
                  跳过
                </label>
                </RadioGroup>
              </div>

              <!-- 疑似改名（2026-10-05，R1）：内容指纹与某个"目录不在"的旧话**完全相同**。
                   只报事实、不猜名字；点"就是它"只是把认领面板**预填**，仍要用户确认。 -->
              <div
                v-if="renameHintOf(candidate.folderPath)"
                class="mt-2 rounded border border-warning/30 bg-warning-soft px-2 py-1.5 text-xs text-warning"
                data-testid="rename-hint"
              >
                <p>
                  疑似是
                  <strong>{{ renameHintOf(candidate.folderPath)?.chapterTitle }}</strong> 改名了
                  （内容完全相同）
                </p>
                <UiButton variant="outline" size="sm"
                  type="button"
                  class="mt-1 transition-colors"
                  data-testid="rename-hint-apply"
                  @click="applyRenameHint(candidate.folderPath)"
                >
                  就是它，去认领
                </UiButton>
              </div>

              <!-- 认领（2026-10-05，R2）：本地文件夹改过名时，这条候选其实是某一话换了门牌。
                   只换 folderPath —— childId / 集数 / 标记历史 / 进度都不动。 -->
              <div class="mt-2 text-xs">
                <UiButton variant="outline" size="sm"
                  type="button"
                  class="transition-colors"
                  data-testid="reclaim-toggle"
                  @click="toggleReclaim(candidate.folderPath)"
                >
                  这不是新章节，它是…
                </UiButton>
                <div
                  v-if="reclaimOpenFor === candidate.folderPath"
                  class="mt-1 space-y-1 rounded border border-border bg-app-bg px-2 py-1.5"
                  data-testid="reclaim-panel"
                >
                  <p class="text-text-secondary">
                    它其实是本父级已有的哪一话？（本地文件夹改过名就用这里）
                  </p>
                  <AppSelect v-model="reclaimChildId" :options="existingChapters.map(chapter => ({ value: chapter.id, label: chapterLabel(chapter) }))" test-id="reclaim-select" />
                  <p class="text-[11px] leading-4 text-text-tertiary">
                    只把那一话的门牌号换成这个文件夹；集数、标记历史、进度都不动。
                  </p>
                  <div class="flex justify-end">
                    <UiButton variant="default" size="sm"
                      type="button"
                      class="transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                      :disabled="!reclaimChildId"
                      data-testid="reclaim-confirm"
                      @click="confirmReclaim(candidate.folderPath)"
                    >
                      确认认领
                    </UiButton>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="hasUnresolvedConflict"
            class="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning"
          >
            还有同集数冲突未选择，请选择“导入为第二版本”或“跳过”。
          </div>

          <label
            v-if="!silentSelfCheck && !hasConflict"
            class="flex cursor-pointer items-center gap-2 text-xs text-text-secondary"
          >
            <UiInput
              type="checkbox"
              :checked="neverAsk"
              data-testid="self-check-never-ask"
              @change="onNeverAskChange"
            />
            下次不再询问，直接导入无冲突新章节
          </label>
        </template>
      </div>

      <div
        v-if="!busy && !running && canDetect && candidates.length > 0"
        class="flex justify-end gap-2 border-t border-border px-5 py-3"
      >
        <UiButton variant="outline" size="sm"
          type="button"
          class="transition-colors"
          @click="emit('close')"
        >
          取消
        </UiButton>
        <UiButton variant="default" size="sm"
          type="button"
          class="transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="hasUnresolvedConflict"
          data-testid="confirm-self-check-import"
          @click="emit('confirm')"
        >
          导入
        </UiButton>
      </div>
    </DialogContent>
  </Dialog>
</template>
