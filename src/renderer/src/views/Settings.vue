<script setup lang="ts">
// Settings — global appearance, thumbnail size, sorting and data migration.
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore, PLAY_INTERVAL_OPTIONS } from '@renderer/stores/settings'
import { useThemeStore } from '@renderer/stores/theme'
import { useToastStore } from '@renderer/stores/toast'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import { useProjectStore } from '@renderer/stores/project'
import { useAchievementsStore } from '@renderer/stores/achievements'
import type { ThumbSize } from '@renderer/components/ThumbGrid.vue'
import type { ThemeColorSettings, ThemeMode } from '@renderer/stores/theme'
import type { ChildSortOrder } from '@shared/chapter'
import { derivePhotoshopPath } from '@renderer/features/project/card-action'
import MarkHistoryDialog from '@renderer/features/project/MarkHistoryDialog.vue'
import RestoreMarksDialog from '@renderer/features/project/RestoreMarksDialog.vue'
import DiagnosticsDialog from '@renderer/features/project/DiagnosticsDialog.vue'
import DbBackupList from '@renderer/features/settings/DbBackupList.vue'
import BackupManagerDialog from '@renderer/features/settings/BackupManagerDialog.vue'
import type { DbBackupInfo, MarkWriteBackResult } from '@shared/ipc-api'
import type { UpdateManifest } from '@shared/update'

const APP_NAME = '汉化工坊'
/**
 * 版本号来自构建期注入的 `__APP_VERSION__`（真源 = `package.json`）。
 * ⚠️ 这里**不许**再写版本号字面量 —— 以前写死在这儿，改版本时最容易漏的就是它。
 */
const APP_VERSION = __APP_VERSION__
const APP_DESCRIPTION = '嵌字 / 翻译 / 校对 / 监修 —— 一条线走完'

const thumbSizes: readonly ThumbSize[] = ['大', '中', '小'] as const
const childSortOrders: ReadonlyArray<{ value: ChildSortOrder; label: string }> = [
  { value: 'ascending', label: '正序' },
  { value: 'descending', label: '倒序' }
]
const themeModes: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
  { value: 'system', label: '跟随系统' }
]
const colorPresets: ReadonlyArray<ThemeColorSettings & { label: string }> = [
  // 第一项就是默认出厂配色（见 stores/theme.ts 的 DEFAULT_THEME_COLORS）。
  { label: '紫雾', hue: 262, saturation: 58, neutralSaturation: 8 },
  { label: '参考蓝', hue: 222, saturation: 70, neutralSaturation: 12 },
  { label: '工坊绿', hue: 145, saturation: 68, neutralSaturation: 10 },
  { label: '暖橙', hue: 32, saturation: 82, neutralSaturation: 10 },
  { label: '玫红', hue: 335, saturation: 74, neutralSaturation: 10 }
]
const settingsStore = useSettingsStore()
const themeStore = useThemeStore()
const toast = useToastStore()
const workspace = useProjectWorkspace()
const projectStore = useProjectStore()
const achievements = useAchievementsStore()
const {
  thumbSize: selectedThumb,
  childSortOrder,
  silentSelfCheck,
  labelPlusFxPath,
  photoshopPath,
  typesetImportScript,
  skipPsFallbackPrompt,
  playIntervalMs,
  autoBackup
} = storeToRefs(settingsStore)
const { theme: selectedTheme, hue, saturation, neutralSaturation } = storeToRefs(themeStore)
const importingLegacyData = ref(false)
const activeHueColor = computed(() => `hsl(${hue.value} ${saturation.value}% 50%)`)

onMounted(() => {
  void settingsStore.loadSettings()
})

function onThumbChange(size: ThumbSize): void {
  settingsStore.setThumbSize(size)
}

function onChildSortOrderChange(order: ChildSortOrder): void {
  settingsStore.setChildSortOrder(order)
}

function onPlayIntervalChange(ms: number): void {
  settingsStore.setPlayIntervalMs(ms)
}

// --- 数据安全：备份 / 还原 / 标记记录（第十四轮）--------------------------------
/**
 * 设置页只摆**最新几条**备份（第二十三轮）—— 保留策略是主进程的 `KEEP_BACKUPS = 20`，
 * 全摆出来迟早是 20 行（约 880px），会把设置页长期撑长。其余进「备份管理」弹窗。
 */
const CARD_BACKUP_PREVIEW = 3
const backups = ref<DbBackupInfo[]>([])
const visibleBackups = computed(() => backups.value.slice(0, CARD_BACKUP_PREVIEW))
const backupManagerVisible = ref(false)
const backingUp = ref(false)
const backupMessage = ref('')
/**
 * 「检查更新」（2026-10-04）。
 *
 * 只做"发现 + 引导下载"：查到新版就显示版本号/说明/去下载；查不到（断网、超时、
 * 清单坏了）只淡淡说一句 —— 检查更新失败不是用户的问题，绝不能弹错或卡住页面。
 * 下载地址**只来自清单**（远端数据），界面不许自己拼 URL。
 */
const updateChecking = ref(false)
const updateStatusText = ref('')
const updateManifest = ref<UpdateManifest | null>(null)

async function onCheckUpdate(): Promise<void> {
  if (updateChecking.value) return
  updateChecking.value = true
  updateStatusText.value = ''
  updateManifest.value = null
  try {
    const result = await window.comicType.checkForUpdate()
    if (result.status === 'update-available') {
      updateManifest.value = result.manifest
      updateStatusText.value = `发现新版本 v${result.manifest.version}（当前 v${result.currentVersion}）：${result.manifest.notes}`
    } else if (result.status === 'up-to-date') {
      updateStatusText.value = `已是最新版本（v${result.currentVersion}）`
    } else {
      updateStatusText.value = '检查失败，稍后再试'
    }
  } catch {
    // 理论上不会走到（主进程那边永远不抛）—— 真走到了也只说一句，不冒泡
    updateStatusText.value = '检查失败，稍后再试'
  } finally {
    updateChecking.value = false
  }
}

/** 去下载：走既有的 openExternal 通道（它自带协议白名单）。 */
async function onOpenDownload(): Promise<void> {
  const url = updateManifest.value?.url
  if (!url) return
  await window.comicType.openExternal(url)
}

const markHistoryVisible = ref(false)
const diagnosticsVisible = ref(false)
const restoreOpen = ref(false)
const restoreTarget = ref<DbBackupInfo | null>(null)

async function refreshBackups(): Promise<void> {
  try {
    backups.value = await window.comicType.dbBackupList()
  } catch {
    backups.value = []
  }
}

async function onBackupNow(): Promise<void> {
  backingUp.value = true
  backupMessage.value = ''
  try {
    const info = await window.comicType.dbBackupCreate('manual')
    const files = info.rows?.['project_memory_files'] ?? 0
    backupMessage.value = `已备份：${info.file}（${files} 条标记记录）`
    toast.addToast({ type: 'success', message: '已备份当前数据' })
    await refreshBackups()
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    backupMessage.value = `备份失败：${message}`
    toast.addToast({ type: 'error', message: `备份失败：${message}` })
  } finally {
    backingUp.value = false
  }
}

/** 打开备份文件夹：没有备份就先做一份（否则"打开"会指向一个不存在的目录）。 */
async function onRevealBackups(): Promise<void> {
  try {
    if (backups.value.length === 0) await onBackupNow()
    const sample = backups.value[0]?.path
    if (!sample) return
    const separator = sample.includes('\\') ? '\\' : '/'
    const folder = sample.split(/[\\/]/).slice(0, -1).join(separator)
    const result = await window.comicType.openPath(folder)
    if (!result.ok) toast.addToast({ type: 'error', message: result.message || '打开文件夹失败' })
  } catch (reason) {
    toast.addToast({
      type: 'error',
      message: `打开备份文件夹失败：${reason instanceof Error ? reason.message : String(reason)}`
    })
  }
}

function onAutoBackupChange(event: Event): void {
  settingsStore.setAutoBackup((event.target as HTMLInputElement).checked)
}

function openRestore(backup: DbBackupInfo): void {
  restoreTarget.value = backup
  restoreOpen.value = true
}

async function onMarksRestored(result: MarkWriteBackResult): Promise<void> {
  restoreOpen.value = false
  // 还原会先自动备份一份当前库（safetyBackup），所以列表要刷新
  void result
  await refreshBackups()
}

function onDialogToast(payload: { type: 'success' | 'warning' | 'error'; message: string }): void {
  toast.addToast(payload)
}

onMounted(() => {
  void refreshBackups()
})

function onSilentSelfCheckChange(event: Event): void {
  settingsStore.setSilentSelfCheck((event.target as HTMLInputElement).checked)
}

/** The three configurable external tools, rendered from one description. */
type ToolField = 'translation' | 'photoshop' | 'importScript'

const TOOL_FIELD_APPLY: Record<ToolField, (path: string) => void> = {
  translation: (path) => settingsStore.setLabelPlusFxPath(path),
  photoshop: (path) => settingsStore.setPhotoshopPath(path),
  importScript: (path) => settingsStore.setTypesetImportScript(path)
}

const toolFields = computed(() => [
  {
    key: 'translation' as ToolField,
    label: '翻译 / 校对工具',
    hint: '翻译、校对模式下「去翻译」所启动的程序（例如 LabelPlusFX.exe）。',
    placeholder: '例如 D:\\…\\LabelPlusFX\\LabelPlusFX.exe',
    value: labelPlusFxPath.value
  },
  {
    key: 'photoshop' as ToolField,
    label: 'Photoshop 程序',
    hint: '监修模式（该话没有 PSD 时）与译文导入流程使用；选中 .jsx 后若此处为空，会尝试自动推导。',
    placeholder: '例如 E:\\…\\Adobe Photoshop 2026\\Photoshop.exe',
    value: photoshopPath.value
  },
  {
    key: 'importScript' as ToolField,
    label: '译文导入 / PSD 生成工具（.jsx）',
    hint: '嵌字模式遇到没有 PSD 的话数时，在 Photoshop 里运行该脚本生成 PSD。',
    placeholder: '例如 E:\\…\\Presets\\Scripts\\译文 .jsx',
    value: typesetImportScript.value
  }
])

/**
 * Picking the .jsx also pre-fills Photoshop, because the script lives at
 * `<PS root>\Presets\Scripts\`. The derived path is only accepted when it
 * really exists, and never overwrites a path the user already set.
 */
async function onPickToolPath(field: ToolField): Promise<void> {
  const kind = field === 'importScript' ? 'script' : 'executable'
  const picked = await window.comicType.pickToolFile(kind)
  if (!picked) return
  TOOL_FIELD_APPLY[field](picked)

  if (field !== 'importScript' || photoshopPath.value.trim()) return
  const derived = derivePhotoshopPath(picked)
  if (!derived) return
  try {
    const info = await window.comicType.stat(derived)
    if (info.isFile) settingsStore.setPhotoshopPath(derived)
  } catch {
    // Derivation is a convenience only — a miss leaves the field for the user.
  }
}

function onClearToolPath(field: ToolField): void {
  TOOL_FIELD_APPLY[field]('')
}

/** Manual edits go through the store so validation/normalisation stays in one place. */
function onToolPathInput(field: ToolField, event: Event): void {
  TOOL_FIELD_APPLY[field]((event.target as HTMLInputElement).value)
}

function onSkipPsFallbackChange(event: Event): void {
  settingsStore.setSkipPsFallbackPrompt((event.target as HTMLInputElement).checked)
}

function rangeValue(event: Event): number {
  return Number((event.target as HTMLInputElement).value)
}

function isPresetActive(preset: ThemeColorSettings): boolean {
  return (
    hue.value === preset.hue &&
    saturation.value === preset.saturation &&
    neutralSaturation.value === preset.neutralSaturation
  )
}

async function importLegacyJson(): Promise<void> {
  if (importingLegacyData.value) return
  importingLegacyData.value = true
  try {
    const result = await window.comicType.importLegacyJson()
    if (result.canceled) return
    await Promise.all([
      settingsStore.loadSettings(),
      themeStore.initTheme(),
      workspace.reloadPsdStatusOverrides()
    ])
    // The dashboard store may enrich and persist imported project counters.
    // Reload the workspace afterwards so both views receive the same snapshot.
    await projectStore.loadProjects()
    await workspace.loadParents()
    void achievements.refresh()

    if (result.importedFiles > 0) {
      toast.addToast({
        type: 'success',
        message: `已导入 ${result.importedFiles} 个文件：新增 ${result.projectsAdded} 个项目，恢复 ${result.memoryProjectsImported} 个项目状态、${result.fontRecordsImported} 条字体记录`
      })
    }
    if (result.warnings.length > 0) {
      toast.addToast({
        type: 'warning',
        message: `有 ${result.skippedFiles} 个文件未导入：${result.warnings.join('；')}`
      })
    }
  } catch (error) {
    toast.addToast({
      type: 'error',
      message: `旧数据导入失败：${error instanceof Error ? error.message : String(error)}`
    })
  } finally {
    importingLegacyData.value = false
  }
}
</script>

<template>
  <div class="page-in min-h-full bg-app-bg p-6 text-text-primary">
    <h1 class="mb-6 text-xl font-semibold tracking-tight text-text-primary">设置</h1>

    <div class="flex flex-col gap-7">
      <!-- 分组一：界面与预览 —— 分组标题在组的最上面，下面是它包含的两块 -->
      <div class="flex flex-col gap-3">
        <h2 class="settings-group">界面与预览</h2>
        <!-- 全局外观与色彩 + 三个一行的小设置 -->
        <section
          data-testid="settings-color-section"
          class="rounded-lg border border-border bg-card-bg p-5 shadow-[var(--shadow-1)]"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 class="settings-title">全局外观与色彩</h3>
              <p class="settings-desc">
                基于根目录 index.html
                的设计令牌统一生成主色、中性色和状态色，调整后立即应用到全部页面。
              </p>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-badge border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-accent hover:bg-card-bg-hover hover:text-text-primary"
              data-testid="theme-colors-reset"
              @click="themeStore.resetColorSettings()"
            >
              恢复默认
            </button>
          </div>

          <div class="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.7fr)]">
            <div class="space-y-5">
              <div>
                <span class="mb-2 block text-xs font-medium text-text-secondary">外观模式</span>
                <div
                  class="inline-flex overflow-hidden rounded-badge border border-border bg-app-bg"
                >
                  <button
                    v-for="mode in themeModes"
                    :key="mode.value"
                    type="button"
                    class="px-4 py-2 text-xs font-medium transition-colors"
                    :class="
                      selectedTheme === mode.value
                        ? 'bg-accent text-text-on-accent'
                        : 'text-text-secondary hover:bg-card-bg-hover hover:text-text-primary'
                    "
                    :data-testid="`theme-mode-${mode.value}`"
                    @click="themeStore.setTheme(mode.value)"
                  >
                    {{ mode.label }}
                  </button>
                </div>
              </div>

              <div>
                <span class="mb-2 block text-xs font-medium text-text-secondary">色彩预设</span>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="preset in colorPresets"
                    :key="preset.label"
                    type="button"
                    class="flex items-center gap-2 rounded-badge border px-3 py-2 text-xs transition-colors hover:bg-card-bg-hover"
                    :class="
                      isPresetActive(preset)
                        ? 'border-accent bg-selected-bg text-accent'
                        : 'border-border text-text-secondary'
                    "
                    :data-testid="`theme-preset-${preset.hue}`"
                    @click="themeStore.setColorSettings(preset)"
                  >
                    <span
                      class="h-3.5 w-3.5 rounded-full border border-border"
                      :style="{
                        backgroundColor: `hsl(${preset.hue} ${preset.saturation}% 50%)`
                      }"
                      aria-hidden="true"
                    />
                    {{ preset.label }}
                  </button>
                </div>
              </div>

              <div class="grid gap-4 md:grid-cols-3">
                <label class="block text-xs text-text-secondary" for="theme-hue">
                  <span class="mb-2 flex items-center justify-between gap-2">
                    <span>色相</span>
                    <output class="font-medium text-text-primary">{{ hue }}°</output>
                  </span>
                  <input
                    id="theme-hue"
                    type="range"
                    min="0"
                    max="360"
                    step="1"
                    :value="hue"
                    class="w-full cursor-pointer accent-accent"
                    data-testid="theme-hue-slider"
                    @input="themeStore.setHue(rangeValue($event))"
                  />
                </label>

                <label class="block text-xs text-text-secondary" for="theme-saturation">
                  <span class="mb-2 flex items-center justify-between gap-2">
                    <span>主色饱和度</span>
                    <output class="font-medium text-text-primary">{{ saturation }}%</output>
                  </span>
                  <input
                    id="theme-saturation"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    :value="saturation"
                    class="w-full cursor-pointer accent-accent"
                    data-testid="theme-saturation-slider"
                    @input="themeStore.setSaturation(rangeValue($event))"
                  />
                </label>

                <label class="block text-xs text-text-secondary" for="theme-neutral-saturation">
                  <span class="mb-2 flex items-center justify-between gap-2">
                    <span>中性色染色</span>
                    <output class="font-medium text-text-primary">{{ neutralSaturation }}%</output>
                  </span>
                  <input
                    id="theme-neutral-saturation"
                    type="range"
                    min="0"
                    max="30"
                    step="1"
                    :value="neutralSaturation"
                    class="w-full cursor-pointer accent-accent"
                    data-testid="theme-neutral-saturation-slider"
                    @input="themeStore.setNeutralSaturation(rangeValue($event))"
                  />
                </label>
              </div>
            </div>

            <div class="rounded-lg border border-border bg-app-bg p-4" data-testid="theme-preview">
              <div class="mb-3 flex items-center justify-between gap-3">
                <span class="text-xs font-medium text-text-secondary">实时预览</span>
                <span class="flex items-center gap-2 text-xs text-text-tertiary">
                  <span
                    class="h-3 w-3 rounded-full border border-border"
                    :style="{ backgroundColor: activeHueColor }"
                  />
                  H {{ hue }} / S {{ saturation }}
                </span>
              </div>
              <div class="grid grid-cols-4 gap-2">
                <span class="h-10 rounded-md bg-primary" title="主色" />
                <span class="h-10 rounded-md bg-primary-hover" title="主色悬停" />
                <span class="h-10 rounded-md bg-success" title="成功" />
                <span class="h-10 rounded-md bg-warning" title="警告" />
              </div>
              <div class="mt-3 rounded-md border border-border bg-card-bg p-3">
                <p class="text-sm font-semibold text-text-primary">汉化工坊</p>
                <p class="mt-1 text-xs text-text-secondary">
                  卡片、文字、边框与选中状态共享同一套主题。
                </p>
                <button
                  type="button"
                  class="mt-3 rounded-badge bg-accent px-3 py-1.5 text-xs font-medium text-text-on-accent"
                >
                  主色按钮
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- 界面与预览：三件"一格就够"的小设置并排一行 -->
        <div class="grid gap-3 sm:grid-cols-3" data-testid="settings-quick-row">
          <section
            data-testid="settings-thumb-section"
            class="rounded-lg border border-border bg-card-bg p-4 shadow-[var(--shadow-1)]"
          >
            <h3 class="settings-title" title="缩略图网格与底部胶片条里方块的大小。">缩略图大小</h3>
            <div class="mt-3 flex flex-wrap gap-1.5">
              <label v-for="size in thumbSizes" :key="size" class="settings-choice">
                <input
                  type="radio"
                  name="thumbSize"
                  :value="size"
                  :checked="selectedThumb === size"
                  :data-testid="`thumb-radio-${size}`"
                  class="sr-only"
                  @change="onThumbChange(size)"
                />
                <span
                  class="settings-radio"
                  :class="
                    selectedThumb === size ? 'border-accent bg-accent' : 'border-border bg-card-bg'
                  "
                  aria-hidden="true"
                >
                  <span
                    v-if="selectedThumb === size"
                    class="h-1.5 w-1.5 rounded-full bg-text-on-accent"
                  />
                </span>
                <span class="text-text-primary">{{ size }}</span>
              </label>
            </div>
            <p class="settings-hint">网格与胶片条的方块大小</p>
          </section>

          <section
            data-testid="settings-child-sort-section"
            class="rounded-lg border border-border bg-card-bg p-4 shadow-[var(--shadow-1)]"
          >
            <h3 class="settings-title" title="中文和自定义集数始终排列在数字集数之后。">
              集数排序
            </h3>
            <div class="mt-3 flex flex-wrap gap-1.5">
              <label v-for="option in childSortOrders" :key="option.value" class="settings-choice">
                <input
                  type="radio"
                  name="childSortOrder"
                  :value="option.value"
                  :checked="childSortOrder === option.value"
                  :data-testid="`child-sort-radio-${option.value}`"
                  class="sr-only"
                  @change="onChildSortOrderChange(option.value)"
                />
                <span
                  class="settings-radio"
                  :class="
                    childSortOrder === option.value
                      ? 'border-accent bg-accent'
                      : 'border-border bg-card-bg'
                  "
                  aria-hidden="true"
                >
                  <span
                    v-if="childSortOrder === option.value"
                    class="h-1.5 w-1.5 rounded-full bg-text-on-accent"
                  />
                </span>
                <span class="text-text-primary">{{ option.label }}</span>
              </label>
            </div>
            <p class="settings-hint">中文、自定义集数排在数字之后</p>
          </section>

          <section
            data-testid="settings-play-section"
            class="rounded-lg border border-border bg-card-bg p-4 shadow-[var(--shadow-1)]"
          >
            <h3
              class="settings-title"
              title="大图预览 / 对照视图里点页脚那个 ▶ 时，隔多久翻到下一张。计时从「这一张显示好」才开始算，所以慢的 PSD 不会变成一路看加载动画。"
            >
              播放间隔
            </h3>
            <div class="mt-3 flex flex-wrap gap-1.5">
              <label
                v-for="option in PLAY_INTERVAL_OPTIONS"
                :key="option.value"
                class="settings-choice"
              >
                <input
                  type="radio"
                  name="playInterval"
                  :value="option.value"
                  :checked="playIntervalMs === option.value"
                  :data-testid="`play-interval-radio-${option.value}`"
                  class="sr-only"
                  @change="onPlayIntervalChange(option.value)"
                />
                <span
                  class="settings-radio"
                  :class="
                    playIntervalMs === option.value
                      ? 'border-accent bg-accent'
                      : 'border-border bg-card-bg'
                  "
                  aria-hidden="true"
                >
                  <span
                    v-if="playIntervalMs === option.value"
                    class="h-1.5 w-1.5 rounded-full bg-text-on-accent"
                  />
                </span>
                <span class="text-text-primary">{{ option.label }}</span>
              </label>
            </div>
            <p class="settings-hint">点页脚 ▶ 时生效，从「这一张显示好」起算</p>
          </section>
        </div>
      </div>

      <!-- 分组二：外部工具（工作流核心，配错「去X」就废，提到最前） -->
      <div class="flex flex-col gap-3">
        <h2 class="settings-group">外部工具</h2>

        <!-- 外部工具 -->
        <section
          data-testid="settings-tool-section"
          class="rounded-lg border border-border bg-card-bg p-5 shadow-[var(--shadow-1)]"
        >
          <h3 class="settings-title">外部工具</h3>
          <p class="settings-desc">
            缩略图与对照视图上的「去X」按钮按当前模式调用这里的程序：翻译 / 校对 →
            LabelPlusFX；嵌字（该话尚无 PSD 时）→ 在 Photoshop 里运行译文导入脚本；监修 →
            Photoshop。
          </p>

          <div class="space-y-4">
            <div v-for="field in toolFields" :key="field.key">
              <label
                class="mb-1 block text-[12px] font-medium text-text-primary"
                :for="`tool-${field.key}`"
              >
                {{ field.label }}
              </label>
              <div class="flex flex-nowrap items-center gap-1.5">
                <input
                  :id="`tool-${field.key}`"
                  :value="field.value"
                  :data-testid="`tool-path-${field.key}`"
                  type="text"
                  spellcheck="false"
                  :placeholder="field.placeholder"
                  class="h-8 min-w-0 flex-1 rounded-badge border border-border bg-transparent px-2 text-[13px] text-text-primary transition-colors placeholder:text-text-tertiary focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  @change="onToolPathInput(field.key, $event)"
                />
                <button
                  type="button"
                  :data-testid="`tool-browse-${field.key}`"
                  class="h-8 shrink-0 rounded-badge bg-accent px-2.5 text-[13px] font-medium text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  @click="onPickToolPath(field.key)"
                >
                  浏览…
                </button>
                <button
                  type="button"
                  :data-testid="`tool-clear-${field.key}`"
                  class="h-8 shrink-0 rounded-badge border bg-transparent px-2.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  :class="
                    field.value
                      ? 'border-border text-text-secondary hover:border-danger hover:bg-danger hover:text-danger-fg'
                      : 'cursor-not-allowed border-border text-text-tertiary'
                  "
                  :disabled="!field.value"
                  @click="onClearToolPath(field.key)"
                >
                  清除
                </button>
              </div>
              <p class="mt-1 text-[11px] leading-4 text-text-tertiary">{{ field.hint }}</p>
            </div>
          </div>

          <label
            class="mt-4 flex cursor-pointer items-center gap-3 border-t border-border pt-4 text-sm text-text-primary"
          >
            <input
              type="checkbox"
              :checked="skipPsFallbackPrompt"
              data-testid="skip-ps-fallback-toggle"
              class="sr-only"
              @change="onSkipPsFallbackChange"
            />
            <span
              class="flex h-5 w-9 shrink-0 items-center rounded-full border border-border transition-colors"
              :class="skipPsFallbackPrompt ? 'bg-accent' : 'bg-border-strong'"
              aria-hidden="true"
            >
              <span
                class="h-4 w-4 transform rounded-full bg-text-on-accent shadow transition-transform"
                :class="skipPsFallbackPrompt ? 'translate-x-4' : 'translate-x-0.5'"
              />
            </span>
            <span>嵌字缺少 PSD 且未配置译文导入工具时不再提示，直接打开 Photoshop</span>
          </label>
        </section>
      </div>

      <!-- 分组三：导入与自检 -->
      <div class="flex flex-col gap-3">
        <h2 class="settings-group">导入与自检</h2>
        <div class="grid gap-3 sm:grid-cols-2" data-testid="settings-import-check-row">
          <!-- 父级自检 -->
          <section
            data-testid="settings-self-check-section"
            class="rounded-lg border border-border bg-card-bg p-5 shadow-[var(--shadow-1)]"
          >
            <h3
              class="settings-title"
              title="开启后，点击父级行的「刷新并检测新章节」时将跳过确认弹窗直接导入未冲突的新章节；同集数冲突仍需要单独选择。"
            >
              父级自检
            </h3>
            <label class="mt-3 flex cursor-pointer items-center gap-3 text-sm text-text-primary">
              <input
                type="checkbox"
                :checked="silentSelfCheck"
                data-testid="silent-self-check-toggle"
                class="sr-only"
                @change="onSilentSelfCheckChange"
              />
              <span
                class="flex h-5 w-9 items-center rounded-full border border-border transition-colors"
                :class="silentSelfCheck ? 'bg-accent' : 'bg-border-strong'"
                aria-hidden="true"
              >
                <span
                  class="h-4 w-4 transform rounded-full bg-text-on-accent shadow transition-transform"
                  :class="silentSelfCheck ? 'translate-x-4' : 'translate-x-0.5'"
                />
              </span>
              <span>静默导入新增章节</span>
            </label>
            <p class="settings-hint">刷新父级时跳过确认弹窗；同集数冲突仍需单独选</p>
          </section>
          <!-- 旧数据导入 -->
          <section
            data-testid="settings-import-section"
            class="rounded-lg border border-border bg-card-bg p-5 shadow-[var(--shadow-1)]"
          >
            <h3
              class="settings-title"
              title="支持汉化工坊 SQLite 数据库（.sqlite / .sqlite3 / .db）与三类 JSON，可一次多选；应用会自动识别并安全合并，不覆盖现有项目名称与集数。"
            >
              导入旧版数据
            </h3>
            <button
              type="button"
              class="mt-3 rounded-badge bg-accent px-4 py-2 text-sm font-medium text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="importingLegacyData"
              data-testid="import-legacy-json"
              @click="importLegacyJson"
            >
              {{ importingLegacyData ? '导入中…' : '选择数据导入' }}
            </button>
            <p class="settings-hint">
              旧数据在旧程序旁的 data 目录里：数据库 data\database\qianzi-gongfang.sqlite，更老的
              JSON 在 data\config\ 下（memory.json、font-manager.json）。
            </p>
            <p class="settings-hint">自动识别并安全合并，不覆盖现有名称与集数</p>
          </section>
        </div>
      </div>

      <!-- 分组四：数据安全 -->
      <div class="flex flex-col gap-3">
        <h2 class="settings-group">数据安全</h2>

        <!-- 数据安全 -->
        <section
          data-testid="settings-data-safety-section"
          class="rounded-lg border border-border bg-card-bg p-5 shadow-[var(--shadow-1)]"
        >
          <h3
            class="settings-title"
            title="备份是一致性快照（含未合并的写入），放在 data/backups/，只保留最近 20 份。"
          >
            数据安全
          </h3>
          <p class="settings-desc">标记是手工活，丢了没法重做。这里给三样兜底。</p>
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="h-8 rounded-badge bg-accent px-3 text-[13px] font-medium text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="backingUp"
              data-testid="db-backup-now"
              @click="onBackupNow"
            >
              {{ backingUp ? '备份中…' : '立即备份' }}
            </button>
            <button
              type="button"
              class="h-8 rounded-badge border border-border bg-card-bg px-3 text-[13px] text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
              data-testid="mark-history-open"
              @click="markHistoryVisible = true"
            >
              标记记录
            </button>
            <button
              type="button"
              class="h-8 rounded-badge border border-border bg-card-bg px-3 text-[13px] text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
              data-testid="db-backup-reveal"
              @click="onRevealBackups"
            >
              打开备份文件夹
            </button>
            <button
              type="button"
              class="h-8 rounded-badge border border-border bg-card-bg px-3 text-[13px] text-text-secondary transition-colors hover:bg-card-bg-hover hover:text-text-primary"
              data-testid="diagnostics-open"
              @click="diagnosticsVisible = true"
            >
              诊断
            </button>
            <label
              class="flex cursor-pointer items-center gap-2 rounded-badge px-2 py-1 text-[13px] text-text-secondary transition-colors hover:bg-card-bg-hover"
            >
              <input
                type="checkbox"
                :checked="autoBackup"
                data-testid="auto-backup-toggle"
                class="accent-[var(--accent)]"
                @change="onAutoBackupChange"
              />
              启动时自动备份（每 12 小时最多一份）
            </label>
          </div>
          <p
            v-if="backupMessage"
            class="mt-2 text-xs text-text-secondary"
            data-testid="db-backup-message"
          >
            {{ backupMessage }}
          </p>
          <DbBackupList :items="visibleBackups" @restore="openRestore" />
          <div v-if="backups.length > CARD_BACKUP_PREVIEW" class="mt-2 flex justify-end">
            <button
              type="button"
              class="rounded-badge px-1 text-[12px] text-text-secondary transition-colors hover:text-accent"
              data-testid="db-backup-open-all"
              @click="backupManagerVisible = true"
            >
              全部 {{ backups.length }} 条 ›
            </button>
          </div>
        </section>
      </div>

      <!-- 关于（单独一张卡片，不再套分组标题 —— 它自己就是标题） -->
      <section
        data-testid="settings-about-section"
        class="rounded-lg border border-border bg-card-bg p-5 shadow-[var(--shadow-1)]"
      >
        <h3 class="settings-title">关于</h3>

        <!-- 品牌头卡（2026-10-04 照参照图重做）：图标 + 名称 + 定位语 + 版本·渠道 -->
        <div class="mt-3 flex items-center gap-4 rounded-lg bg-media-bg p-4">
          <div
            class="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-active text-xl font-bold text-text-on-accent"
            aria-hidden="true"
          >
            汉
          </div>
          <div class="min-w-0">
            <p class="text-[17px] font-semibold leading-tight text-text-primary">{{ APP_NAME }}</p>
            <p class="mt-1 text-xs text-text-secondary">{{ APP_DESCRIPTION }}</p>
            <p class="mt-1 text-[11px] text-text-tertiary">
              版本
              <span data-testid="about-version">{{ APP_VERSION }}</span>
              · 文件夹版 / 单文件版
            </p>
          </div>
        </div>

        <!-- 检查更新（2026-10-04）：只"发现 + 引导下载"，不自动替换。
             整宽浅底按钮照参照图语言：bg-primary-soft + 主色字，hover 走 primary-soft-hover。 -->
        <button
          type="button"
          class="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-badge bg-primary-soft text-sm font-medium text-accent transition-colors hover:bg-[var(--primary-soft-hover)] active:bg-[var(--primary-soft-strong)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="update-check"
          :disabled="updateChecking"
          @click="onCheckUpdate"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
          {{ updateChecking ? '正在检查…' : '检查更新' }}
        </button>

        <div class="mt-3 flex flex-col gap-2">
          <div class="flex items-center gap-3">
            <button
              v-if="updateManifest"
              type="button"
              class="rounded-badge bg-accent px-3 py-1.5 text-sm font-semibold text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              data-testid="update-download"
              @click="onOpenDownload"
            >
              去下载
            </button>
          </div>
          <p class="text-xs leading-5 text-text-tertiary" data-testid="update-status">
            {{ updateStatusText }}
          </p>
          <p class="text-xs leading-5 text-text-tertiary">
            更新：文件夹版解压后覆盖程序文件（保留 data 目录）；单文件版直接替换
            exe。两种方式数据都不受影响。
          </p>
        </div>
      </section>
    </div>
  </div>

  <MarkHistoryDialog
    v-if="markHistoryVisible"
    :open="true"
    @close="markHistoryVisible = false"
    @toast="onDialogToast"
  />

  <DiagnosticsDialog
    v-if="diagnosticsVisible"
    :open="true"
    @close="diagnosticsVisible = false"
    @toast="onDialogToast"
  />

  <BackupManagerDialog
    v-if="backupManagerVisible"
    :items="backups"
    @close="backupManagerVisible = false"
    @refresh="refreshBackups()"
    @restore="openRestore"
  />

  <RestoreMarksDialog
    :open="restoreOpen"
    :backup="restoreTarget"
    @close="restoreOpen = false"
    @restored="onMarksRestored"
    @toast="onDialogToast"
  />
</template>
