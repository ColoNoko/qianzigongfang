<script setup lang="ts">
import { Slider } from '@renderer/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { Switch } from "@renderer/components/ui/switch"
import { Button as UiButton } from '@renderer/components/ui/button'
import UiInput from '@renderer/components/ui/ControlInput.vue'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@renderer/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import SettingRow from '@renderer/features/settings/SettingRow.vue'
import SettingsToolRow from '@renderer/features/settings/SettingsToolRow.vue'
import { WORK_MODE_OPTIONS } from '@shared/modes'
// Settings — global appearance, thumbnail size, sorting and data migration.
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@renderer/stores/settings'
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
import BackupManagerDialog from '@renderer/features/settings/BackupManagerDialog.vue'
import type { DbBackupInfo, MarkWriteBackResult } from '@shared/ipc-api'
import type { UpdateManifest } from '@shared/update'

const APP_NAME = '汉化工坊'
/**
 * 版本号来自构建期注入的 `__APP_VERSION__`（真源 = `package.json`）。
 * ⚠️ 这里**不许**再写版本号字面量 —— 以前写死在这儿，改版本时最容易漏的就是它。
 */
const APP_VERSION = __APP_VERSION__

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
  autoBackup
} = storeToRefs(settingsStore)
const { theme: selectedTheme, hue, saturation, neutralSaturation } = storeToRefs(themeStore)
const importingLegacyData = ref(false)
const personalName = ref('')
const nameLoading = ref(true)
const nameSaving = ref(false)
onMounted(async () => {
  try { const value = await window.comicType.storeGet('ui.userId'); personalName.value = typeof value === 'string' ? value.slice(0,40) : '' }
  catch { toast.addToast({type:'error',message:'个人称呼读取失败'}) }
  finally { nameLoading.value = false }
})
async function savePersonalName() {
  if (nameSaving.value || nameLoading.value) return
  nameSaving.value = true
  try {
    const value = personalName.value.trim().slice(0,40)
    await window.comicType.storeSet('ui.userId',value)
    personalName.value = value
    toast.addToast({type:'success',message:'个人称呼已保存'})
  } catch { toast.addToast({type:'error',message:'个人称呼保存失败，请重试'}) }
  finally { nameSaving.value = false }
}


onMounted(() => {
  void settingsStore.loadSettings()
})

function onThumbChange(size: ThumbSize): void {
  settingsStore.setThumbSize(size)
}

function onChildSortOrderChange(order: ChildSortOrder): void {
  settingsStore.setChildSortOrder(order)
}

// --- 数据安全：备份 / 还原 / 标记记录（第十四轮）--------------------------------
// 设置页显示最近备份时间，完整列表在备份管理中查看。
const backups = ref<DbBackupInfo[]>([])
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

function onSilentSelfCheckChange(checked: boolean): void {
  settingsStore.setSilentSelfCheck(checked)
}

/** The three configurable external tools, rendered from one description. */
type ToolField = 'translation' | 'photoshop' | 'importScript'

const TOOL_FIELD_APPLY: Record<ToolField, (path: string) => void> = {
  translation: (path) => settingsStore.setLabelPlusFxPath(path),
  photoshop: (path) => settingsStore.setPhotoshopPath(path),
  importScript: (path) => settingsStore.setTypesetImportScript(path)
}

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

const colorOpen = ref(false)
const draftColors = ref<ThemeColorSettings>({ hue: 262, saturation: 58, neutralSaturation: 8 })
function openColors(open: boolean) {
  colorOpen.value = open
  if (open) draftColors.value = { hue: hue.value, saturation: saturation.value, neutralSaturation: neutralSaturation.value }
}
function saveColors() { themeStore.setColorSettings(draftColors.value); colorOpen.value = false }
const selectedPreset = computed(() => colorPresets.find(isPresetActive)?.label ?? '')
function choosePreset(value: unknown) {
  const preset = colorPresets.find(p => p.label === value)
  if (preset) themeStore.setColorSettings(preset)
}
function updateDuties(value: unknown) {
  if (!Array.isArray(value)) return
  const duties = WORK_MODE_OPTIONS.filter(item => value.includes(item.value)).map(item => item.value)
  if (duties.length > 2) return
  void settingsStore.saveImportDuties(duties)
}
const groups = [{id:'appearance',label:'外观与看图'},{id:'workflow',label:'项目习惯'},{id:'tools',label:'外部软件'},{id:'data',label:'数据与备份'}]
function scrollToGroup(id: string) { document.getElementById('settings-' + id)?.scrollIntoView({ block:'start', behavior:'smooth' }) }
const latestBackup = computed(() => backups.value[0] ? new Date(backups.value[0].at).toLocaleString('zh-CN') : '尚无备份')
</script>

<template>
  <div class="settings-shell page-layout bg-app-bg text-text-primary">
    <div class="w-full">
      <header class="view-heading">
        <div><h1 class="view-title">设置</h1><p class="view-description">让工坊适合你的工作习惯。</p></div>
        <span class="text-xs text-muted-foreground">偏好自动保存</span>
      </header>
      <nav aria-label="设置分组" class="mb-6 flex flex-wrap gap-1 border-b border-border pb-3">
        <UiButton v-for="group in groups" :key="group.id" variant="ghost" size="sm" @click="scrollToGroup(group.id)">{{ group.label }}</UiButton>
      </nav>
      <div class="flex flex-col gap-6">
        <Card id="settings-appearance" class="settings-card" data-settings-group="appearance" data-testid="settings-color-section">
          <CardHeader class="pb-2"><CardTitle class="text-base">外观与看图</CardTitle><CardDescription>调整显示方式，让阅读和操作更顺手。</CardDescription></CardHeader>
          <CardContent class="settings-rows">
            <SettingRow title="启动页面" description="选择项目时，优先继续上次打开的章节；没有记录则显示项目列表。">
              <ToggleGroup type="single" size="sm" :model-value="settingsStore.startupPage" aria-label="启动页面" :disabled="settingsStore.savingStartupPage" @update:model-value="value => { if(value === 'home' || value === 'project') settingsStore.setStartupPage(value) }"><ToggleGroupItem value="home">首页</ToggleGroupItem><ToggleGroupItem value="project">项目</ToggleGroupItem></ToggleGroup>
            </SettingRow>
            <SettingRow title="首页风格" description="选择首页的信息布局与展示风格。">
              <ToggleGroup type="single" size="sm" :model-value="settingsStore.homeStyle" aria-label="首页风格" :disabled="settingsStore.savingHomeStyle" @update:model-value="value => { if(value === 'default' || value === 'modern') settingsStore.setHomeStyle(value) }"><ToggleGroupItem value="default">默认</ToggleGroupItem><ToggleGroupItem value="modern">现代</ToggleGroupItem></ToggleGroup>
            </SettingRow>
            <SettingRow title="个人称呼" description="用于现代首页的问候语，留空时称呼你为「朋友」。">
              <UiInput v-model="personalName" class="w-48 max-w-full" aria-label="个人称呼" placeholder="朋友" :maxlength="40" :disabled="nameLoading || nameSaving" @keydown.enter="savePersonalName" />
              <UiButton variant="outline" size="sm" :disabled="nameLoading || nameSaving" @click="savePersonalName">{{ nameSaving ? '保存中…' : '保存称呼' }}</UiButton>
            </SettingRow>
            <SettingRow title="明暗模式">
              <ToggleGroup type="single" variant="outline" size="sm" :model-value="selectedTheme" aria-label="明暗模式" @update:model-value="$event && themeStore.setTheme($event as ThemeMode)">
                <ToggleGroupItem v-for="mode in themeModes" :key="mode.value" :value="mode.value" :data-testid="`theme-mode-${mode.value}`">{{ mode.label }}</ToggleGroupItem>
              </ToggleGroup>
            </SettingRow>
            <SettingRow title="主题配色">
              <ToggleGroup type="single" size="sm" :model-value="selectedPreset" aria-label="主题配色" @update:model-value="choosePreset">
                <ToggleGroupItem v-for="preset in colorPresets" :key="preset.label" :value="preset.label" :data-testid="`theme-preset-${preset.hue}`"><span class="mr-1.5 size-2.5 rounded-full" :style="{backgroundColor:`hsl(${preset.hue} ${preset.saturation}% 50%)`}" />{{ preset.label }}</ToggleGroupItem>
              </ToggleGroup>
              <Popover :open="colorOpen" @update:open="openColors">
                <PopoverTrigger as-child><UiButton variant="ghost" size="sm">自定义…</UiButton></PopoverTrigger>
                <PopoverContent align="end" class="w-80 max-w-[calc(100vw-2rem)]">
                  <p class="text-sm font-semibold">自定义颜色</p><p class="mt-1 text-xs text-muted-foreground">保存后应用到整个工坊。</p>
                  <div class="my-4 flex h-12 items-center justify-center rounded-md text-sm" :style="{backgroundColor:`hsl(${draftColors.hue} ${draftColors.saturation}% 92%)`,color:`hsl(${draftColors.hue} ${draftColors.saturation}% 28%)`}">配色预览</div>
                  <label v-for="slider in [{key:'hue' as const,label:'色相',max:360},{key:'saturation' as const,label:'主色饱和度',max:100},{key:'neutralSaturation' as const,label:'背景染色',max:30}]" :key="slider.key" class="mb-3 block text-xs">
                    <span class="mb-2 flex justify-between"><span>{{ slider.label }}</span><span>{{ draftColors[slider.key] }}</span></span>
                    <UiInput type="range" :aria-label="slider.label" min="0" :max="slider.max" :value="draftColors[slider.key]" class="w-full" @input="draftColors[slider.key] = Number(($event.target as HTMLInputElement).value)" />
                  </label>
                  <div class="flex justify-end gap-2"><UiButton variant="ghost" size="sm" data-testid="theme-colors-reset" @click="draftColors = {hue:262,saturation:58,neutralSaturation:8}">默认值</UiButton><UiButton variant="outline" size="sm" @click="colorOpen = false">取消</UiButton><UiButton size="sm" @click="saveColors">保存</UiButton></div>
                </PopoverContent>
              </Popover>
            </SettingRow>
            <SettingRow title="缩略图大小" data-testid="settings-thumb-section">
              <ToggleGroup type="single" size="sm" :model-value="selectedThumb" aria-label="全局缩略图大小" @update:model-value="value => { if (value === '大' || value === '中' || value === '小') onThumbChange(value) }"><ToggleGroupItem v-for="size in [...thumbSizes].reverse()" :key="size" :value="size">{{ size }}</ToggleGroupItem></ToggleGroup>
            </SettingRow>
            <SettingRow title="译文浮点标记大小" description="适用于翻译、校对和监修。100% 为原始大小。">
              <div class="flex w-72 max-w-full items-center gap-4">
                <div class="min-w-0 flex-1"><Slider :model-value="[settingsStore.anchorScale]" :min="30" :max="200" :step="1" aria-label="浮点标记大小" @update:model-value="value => settingsStore.setAnchorScale(value?.[0] ?? 100)" /><p class="mt-2 text-xs text-muted-foreground">{{ settingsStore.anchorScale }}% · 30%–200%</p></div>
                <div class="flex h-24 w-24 shrink-0 items-center justify-center rounded-md border bg-muted" aria-label="标记大小预览"><span class="flex items-center justify-center rounded-full font-bold text-white" :style="{ width: `calc(32px * var(--translation-anchor-scale, 1))`, height: `calc(32px * var(--translation-anchor-scale, 1))`, fontSize: `calc(11px * var(--translation-anchor-scale, 1))`, background: 'var(--lp-group-1)' }">1</span></div>
              </div>
            </SettingRow>
            <SettingRow title="图片预览滚轮操作" :description="settingsStore.invertWheel ? '按住 Ctrl 时翻页。' : '按住 Ctrl 时缩放。'">
              <ToggleGroup type="single" size="sm" :model-value="settingsStore.invertWheel ? 'zoom' : 'page'" aria-label="图片预览滚轮操作" @update:model-value="value => { if (value) settingsStore.setInvertWheel(value === 'zoom') }"><ToggleGroupItem value="page">翻页</ToggleGroupItem><ToggleGroupItem value="zoom">缩放</ToggleGroupItem></ToggleGroup>
            </SettingRow>
          </CardContent>
        </Card>
        <Card id="settings-workflow" class="settings-card" data-settings-group="workflow">
          <CardHeader class="pb-2"><CardTitle class="text-base">项目习惯</CardTitle><CardDescription>决定新作品如何加入，以及打开时如何工作。</CardDescription></CardHeader>
          <CardContent class="settings-rows">
            <SettingRow title="新漫画默认职责" description="最多选择两个，仅影响之后添加的漫画。">
              <ToggleGroup type="multiple" size="sm" :model-value="settingsStore.defaultImportDuties" aria-label="新漫画默认职责" @update:model-value="updateDuties"><ToggleGroupItem v-for="option in WORK_MODE_OPTIONS" :key="option.value" :value="option.value" :disabled="settingsStore.defaultImportDuties.length >= 2 && !settingsStore.defaultImportDuties.includes(option.value)">{{ option.label }}</ToggleGroupItem></ToggleGroup>
            </SettingRow>
            <SettingRow v-if="settingsStore.defaultImportDuties.length === 2" title="进入作品优先切换到" description="作品有两个职责时，自动选择对应工序。">
              <ToggleGroup type="single" size="sm" :model-value="settingsStore.dutyModePriority" aria-label="双职责优先级" @update:model-value="value => { if (value === 'slower' || value === 'faster') settingsStore.saveImportDuties(settingsStore.defaultImportDuties, value) }"><ToggleGroupItem value="slower">进度较慢</ToggleGroupItem><ToggleGroupItem value="faster">进度较快</ToggleGroupItem></ToggleGroup>
            </SettingRow>
            <SettingRow title="章节排列" data-testid="settings-child-sort-section"><ToggleGroup type="single" size="sm" :model-value="childSortOrder" aria-label="集数排序" @update:model-value="value => { if (value) onChildSortOrderChange(value as ChildSortOrder) }"><ToggleGroupItem v-for="option in childSortOrders" :key="option.value" :value="option.value">{{ option.label }}</ToggleGroupItem></ToggleGroup></SettingRow>
            <SettingRow title="发现新章节时" description="手动检测新章节时使用。同集数冲突仍需确认。" data-testid="settings-self-check-section"><ToggleGroup type="single" size="sm" :model-value="silentSelfCheck ? 'auto' : 'ask'" aria-label="发现新章节时" @update:model-value="value => { if (value) onSilentSelfCheckChange(value === 'auto') }"><ToggleGroupItem value="ask">先确认</ToggleGroupItem><ToggleGroupItem value="auto">直接加入</ToggleGroupItem></ToggleGroup></SettingRow>
            

              <SettingRow title="后台检测漫画更新" description="每 10 分钟扫描已有章节与新章节。关闭后，当前打开的章节仍会实时更新。"><Switch :model-value="settingsStore.autoIncrementalScan" aria-label="后台检测漫画更新" data-testid="auto-incremental-scan" @update:model-value="settingsStore.setAutoIncrementalScan" /></SettingRow>
            
          </CardContent>
        </Card>
        <Card id="settings-tools" class="settings-card" data-settings-group="tools" data-testid="settings-tool-section">
          <CardHeader class="pb-2"><CardTitle class="text-base">外部软件</CardTitle><CardDescription>按需配置；使用内置翻译编辑器，无需另选翻译软件。</CardDescription></CardHeader>
          <CardContent class="settings-rows">
            <SettingsToolRow title="Photoshop" description="用于打开 PSD 和外部嵌字流程。" :value="photoshopPath" field="photoshop" @browse="onPickToolPath('photoshop')" @save="TOOL_FIELD_APPLY.photoshop" />
            <SettingsToolRow title="外部翻译工具" description="用于「去翻译 / 去校对」，例如 LabelPlusFX。" :value="labelPlusFxPath" field="translation" @browse="onPickToolPath('translation')" @save="TOOL_FIELD_APPLY.translation" />
            

              
                <SettingsToolRow title="译文导入脚本" description="通过 Photoshop 从译文生成 PSD 时使用（.jsx）。" :value="typesetImportScript" field="importScript" @browse="onPickToolPath('importScript')" @save="TOOL_FIELD_APPLY.importScript" />
                <SettingRow title="未配置导入工具时" description="仅在嵌字且当前章节没有 PSD 时生效。"><ToggleGroup type="single" size="sm" :model-value="skipPsFallbackPrompt ? 'open' : 'ask'" aria-label="未配置导入工具时" @update:model-value="value => { if(value) settingsStore.setSkipPsFallbackPrompt(value === 'open') }"><ToggleGroupItem value="ask">询问我</ToggleGroupItem><ToggleGroupItem value="open">直接打开 Photoshop</ToggleGroupItem></ToggleGroup></SettingRow>
              
            
          </CardContent>
        </Card>
        <Card id="settings-data" class="settings-card" data-settings-group="data" data-testid="settings-data-safety-section">
          <CardHeader class="pb-2"><CardTitle class="text-base">数据与备份</CardTitle><CardDescription>保留项目、标记和设置。备份不包含漫画图片与 PSD 文件。</CardDescription></CardHeader>
          <CardContent class="settings-rows">
            <SettingRow title="自动备份" description="启动时检查，每 12 小时最多一份，保留最近 20 份。"><Switch :model-value="autoBackup" aria-label="自动备份" data-testid="auto-backup-toggle" @update:model-value="settingsStore.setAutoBackup" /></SettingRow>
            <SettingRow title="最近备份" :description="latestBackup"><UiButton variant="outline" size="sm" data-testid="db-backup-now" :disabled="backingUp" @click="onBackupNow">{{ backingUp ? '备份中…' : '立即备份' }}</UiButton><UiButton variant="outline" size="sm" data-testid="db-backup-open-all" @click="backupManagerVisible = true">管理备份</UiButton></SettingRow>
            <p v-if="backupMessage" class="pb-3 text-xs text-muted-foreground" role="status" data-testid="db-backup-message">{{ backupMessage }}</p>
            

              
                <SettingRow title="导入已有数据" description="从旧版数据库或 JSON 合并项目与标记。" data-testid="settings-import-section"><UiButton variant="outline" size="sm" data-testid="import-legacy-json" :disabled="importingLegacyData" @click="importLegacyJson">{{ importingLegacyData ? '导入中…' : '选择数据导入' }}</UiButton></SettingRow>
                <SettingRow title="操作记录与诊断" description="查阅标记历史，或在遇到问题时检查运行状态。"><UiButton variant="ghost" size="sm" data-testid="mark-history-open" @click="markHistoryVisible = true">标记记录</UiButton><UiButton variant="ghost" size="sm" data-testid="diagnostics-open" @click="diagnosticsVisible = true">诊断</UiButton><UiButton variant="ghost" size="sm" data-testid="db-backup-reveal" @click="onRevealBackups">打开备份文件夹</UiButton></SettingRow>
              
            
          </CardContent>
        </Card>
      </div>
      <footer class="mt-6 border-t border-border py-4" data-testid="settings-about-section">
        <div class="flex flex-wrap items-center justify-between gap-3"><p class="text-xs text-muted-foreground">{{ APP_NAME }} <span class="ml-2" data-testid="about-version">{{ APP_VERSION }}</span></p><div class="flex gap-2"><UiButton v-if="updateManifest" size="sm" data-testid="update-download" @click="onOpenDownload">去下载</UiButton><UiButton variant="ghost" size="sm" data-testid="update-check" :disabled="updateChecking" @click="onCheckUpdate">{{ updateChecking ? '正在检查…' : '检查更新' }}</UiButton></div></div>
        <p v-if="updateStatusText" class="mt-2 text-xs text-muted-foreground" data-testid="update-status">{{ updateStatusText }}</p>
      </footer>
    </div>
  </div>
  <MarkHistoryDialog v-if="markHistoryVisible" :open="true" @close="markHistoryVisible = false" @toast="onDialogToast" />
  <DiagnosticsDialog v-if="diagnosticsVisible" :open="true" @close="diagnosticsVisible = false" @toast="onDialogToast" />
  <BackupManagerDialog v-if="backupManagerVisible" :items="backups" @close="backupManagerVisible = false" @refresh="refreshBackups()" @restore="openRestore" />
  <RestoreMarksDialog :open="restoreOpen" :backup="restoreTarget" @close="restoreOpen = false" @restored="onMarksRestored" @toast="onDialogToast" />
</template>
<style scoped>

.settings-card { container-type:inline-size; scroll-margin-top:20px; box-shadow:none; border-color:var(--border); }
.settings-rows { padding-top:0; padding-bottom:4px; }
</style>
