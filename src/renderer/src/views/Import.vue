<script setup lang="ts">
import { Button as UiButton } from '@renderer/components/ui/button'
import UiInput from '@renderer/components/ui/ControlInput.vue'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@renderer/components/ui/table'
import { useImportSource } from '@renderer/features/import/useImportSource'
import { useImportGeneration } from '@renderer/features/import/useImportGeneration'
import { usePhotoshopJob } from '@renderer/features/import/usePhotoshopJob'
import {
  type PersistedImportSettings,
  isRecord,
  stringOr,
  booleanOr,
  stringRecordOr,
  directionRecordOr,
  mergeOptions
} from '@renderer/features/import/import-settings'
import ImportOutputOptions from '@renderer/features/import/components/ImportOutputOptions.vue'
import InfoHint from '../components/InfoHint.vue'
import { resolveFont, fontReference } from '@shared/fonts/resolve'
import { fontCatalog } from '@renderer/fonts/catalog'
import { computed, onMounted, ref, watch } from 'vue'
import type { SystemFontInfo } from '@shared/ipc-api'
import type { LabelPlusGenerateOptions, LabelPlusImageMatch } from '@shared/labelplus-import'
import {
  LABELPLUS_IMPORT_SETTINGS_KEY,
  createDefaultLabelPlusGenerateOptions,
  createDefaultStandardFont,
  normalizeLabelPlusExtension
} from '@shared/labelplus-import'
import AppSelect, { type AppSelectOption } from '@renderer/components/AppSelect.vue'
import ProjectFormModal from '@renderer/components/ProjectFormModal.vue'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import { useToastStore } from '@renderer/stores/toast'

defineOptions({ name: 'Import' })

type GroupPreset = 'all' | 'inside' | 'outside'

const toast = useToastStore()
const workspace = useProjectWorkspace()
const {
  selection,
  sourceDirectory,
  outputDirectory,
  matchMode,
  forcedExtension,
  preview,
  selectedImageNames,
  selectedGroups,
  loadingFile,
  loadingPreview,
  dropActive,
  onInputDragOver,
  onInputDragLeave,
  onInputDrop,
  pickLabelFile,
  pickSourceDirectory,
  pickOutputDirectory,
  refreshPreview,
  selectAllImages
} = useImportSource(
  () => {
    result.value = null
    previewResult.value = null
    projectImportVisible.value = false
  },
  () => {
    previewResult.value = null
  },
  () => !generating.value && !photoshopBusy.value
)
const fonts = ref<SystemFontInfo[]>([])
const selectedFontId = ref('builtin-arial')
const selectedFontFamily = ref('Arial')
const options = ref<LabelPlusGenerateOptions>(createDefaultLabelPlusGenerateOptions())
const settingsLoaded = ref(false)
const imageFilter = ref('')
const autoImportProject = ref(true)
const {
  photoshopActionSet,
  photoshopGroupActions,
  photoshopGroupDirections,
  photoshopBusy,
} = usePhotoshopJob({
  selection,
  sourceDirectory,
  outputDirectory,
  matchMode,
  forcedExtension,
  selectedImageNames,
  selectedGroups,
  options
})
const {
  generating,
  result,
  previewResult,
  previewGenerating,
  projectImportVisible,
  outputPreviewName,
  canPreviewImage,
  resultFileName,
  resultClass,
  openLabelPlusPreview,
  generatePreview,
  generate
} = useImportGeneration({
  selection,
  sourceDirectory,
  outputDirectory,
  matchMode,
  forcedExtension,
  selectedImageNames,
  selectedGroups,
  options,
  preview,
  autoImportProject
})

const matchModeOptions: AppSelectOption[] = [
  { value: 'file-name', label: '按文件名匹配（推荐）' },
  { value: 'sequential', label: '按目录顺序匹配' }
]

const extensionOptions: AppSelectOption[] = [
  { value: '', label: '自动选择后缀' },
  { value: '.png', label: 'PNG' },
  { value: '.jpg', label: 'JPG/JPEG' },
  { value: '.webp', label: 'WEBP' },
  { value: '.psd', label: 'PSD' },
  { value: '.tif', label: 'TIF/TIFF' },
  { value: '.bmp', label: 'BMP' }
]

const directionOptions: AppSelectOption[] = [
  { value: 'horizontal', label: '横排（原生文字）' },
  // 「活字」= 交给 Photoshop 那条路。竖排只有那条路能建出**可编辑**的竖排文字层，
  // 本地 ag-psd 会安全回退成横排（官方明写竖排描述符可能生成搞崩 PS 的文件）。
  { value: 'vertical', label: '竖排（活字可用）' }
]

const alignmentOptions: AppSelectOption[] = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' }
]


const fontOptions = computed<AppSelectOption[]>(() => [
  ...fonts.value
    .filter((font) => Boolean(font.postScriptName))
    .map((font) => ({
      value: font.id,
      label: `${font.family} - ${font.style}`
    })),
  ...(fonts.value.some((font) => font.id === 'builtin-arial')
    ? []
    : [{ value: 'builtin-arial', label: 'Arial - Regular（兼容回退）' }])
])

const styleOptions = computed<AppSelectOption[]>(() => {
  const familyFonts = fonts.value.filter(
    (font) => font.family === selectedFontFamily.value && Boolean(font.postScriptName)
  )
  if (familyFonts.length > 0) {
    return familyFonts.map((font) => ({ value: font.id, label: font.style }))
  }
  return [{ value: 'builtin-arial', label: 'Regular' }]
})

const groupNames = computed(() => selection.value?.groups ?? [])
const insideGroups = computed(() => groupNames.value.filter((group) => isInsideGroup(group)))
const outsideGroups = computed(() => groupNames.value.filter((group) => isOutsideGroup(group)))

const filteredRows = computed(() => {
  const rows = preview.value?.rows ?? []
  const needle = imageFilter.value.trim().toLocaleLowerCase()
  return needle
    ? rows.filter((row) => row.labelImageName.toLocaleLowerCase().includes(needle))
    : rows
})

const selectedRowCount = computed(
  () =>
    (preview.value?.rows ?? []).filter((row) =>
      selectedImageNames.value.includes(row.labelImageName)
    ).length
)
const matchedSelectedCount = computed(
  () =>
    (preview.value?.rows ?? []).filter(
      (row) => row.matched && selectedImageNames.value.includes(row.labelImageName)
    ).length
)

function persistencePayload(): PersistedImportSettings {
  return {
    sourceDirectory: sourceDirectory.value,
    outputDirectory: outputDirectory.value,
    matchMode: matchMode.value,
    forcedExtension: forcedExtension.value,
    autoImportProject: autoImportProject.value,
    options: JSON.parse(JSON.stringify(options.value)) as LabelPlusGenerateOptions,
    photoshopActionSet: photoshopActionSet.value,
    photoshopGroupActions: { ...photoshopGroupActions.value },
    photoshopGroupDirections: { ...photoshopGroupDirections.value }
  }
}

async function loadSettings(): Promise<void> {
  try {
    if (typeof window.comicType?.storeGet !== 'function') return
    const raw = await window.comicType.storeGet(LABELPLUS_IMPORT_SETTINGS_KEY)
    if (isRecord(raw)) {
      sourceDirectory.value = stringOr(raw.sourceDirectory, '')
      outputDirectory.value = stringOr(raw.outputDirectory, '')
      matchMode.value = raw.matchMode === 'sequential' ? 'sequential' : 'file-name'
      forcedExtension.value = normalizeLabelPlusExtension(stringOr(raw.forcedExtension, ''))
      autoImportProject.value = booleanOr(raw.autoImportProject, true)
      photoshopActionSet.value = stringOr(raw.photoshopActionSet, '')
      photoshopGroupActions.value = stringRecordOr(raw.photoshopGroupActions)
      photoshopGroupDirections.value = directionRecordOr(raw.photoshopGroupDirections)
      options.value = mergeOptions(raw.options, options.value.textStyle.font)
      const defaults = createDefaultLabelPlusGenerateOptions(options.value.textStyle.font)
      options.value.positionOffset = defaults.positionOffset
      options.value.labelIndexOffset = defaults.labelIndexOffset
      options.value.textReplacementExpression = defaults.textReplacementExpression
      options.value.dialogOverlay = defaults.dialogOverlay
      selectedFontId.value = options.value.textStyle.font.id
      selectedFontFamily.value = options.value.textStyle.font.family
    }
  } catch {
    // Settings are optional; defaults keep the page usable without a database.
  } finally {
    settingsLoaded.value = true
  }
}

async function persistSettings(): Promise<void> {
  if (!settingsLoaded.value || typeof window.comicType?.storeSet !== 'function') return
  try {
    await window.comicType.storeSet(LABELPLUS_IMPORT_SETTINGS_KEY, persistencePayload())
  } catch {
    // A failed preference write must not interrupt an import operation.
  }
}

watch(fontCatalog().fonts, (updated) => {
  fonts.value = updated
})

async function loadFonts(): Promise<void> {
  if (typeof window.comicType?.fontList !== 'function') return
  try {
    const result = await fontCatalog().load()
    fonts.value = result.fonts
    const resolved = resolveFont(options.value.textStyle.font, fonts.value)
    if (resolved.status === 'exact') selectFont(resolved.font.id)
    // Missing or merely similar fonts retain the saved reference until explicitly selected.
  } catch {
    // Non-Windows environments may not expose a system font inventory.
  }
}

function selectFont(fontId: string | number): void {
  const id = String(fontId)
  selectedFontId.value = id
  const font = fonts.value.find((item) => item.id === id)
  if (font) {
    selectedFontFamily.value = font.family
    if (!font.postScriptName) return
    options.value.textStyle.font = fontReference(font)
  } else if (id === 'builtin-arial') {
    selectedFontFamily.value = 'Arial'
    options.value.textStyle.font = createDefaultStandardFont()
  }
}

function selectFontFamily(fontId: string | number): void {
  selectFont(fontId)
}

function groupKind(group: string): 'inside' | 'outside' | 'other' {
  if (/(框内|框里|inside|in[-_ ]?box)/iu.test(group)) return 'inside'
  if (/(框外|框外字|outside|out[-_ ]?box)/iu.test(group)) return 'outside'
  return 'other'
}

function isInsideGroup(group: string): boolean {
  return groupKind(group) === 'inside'
}

function isOutsideGroup(group: string): boolean {
  return groupKind(group) === 'outside'
}

function toggleGroup(group: string): void {
  selectedGroups.value = selectedGroups.value.includes(group)
    ? selectedGroups.value.filter((item) => item !== group)
    : [...selectedGroups.value, group]
}

function setGroupPreset(preset: GroupPreset): void {
  if (preset === 'all') selectedGroups.value = [...groupNames.value]
  else if (preset === 'inside') selectedGroups.value = [...insideGroups.value]
  else selectedGroups.value = [...outsideGroups.value]
}

function toggleImage(fileName: string): void {
  selectedImageNames.value = selectedImageNames.value.includes(fileName)
    ? selectedImageNames.value.filter((item) => item !== fileName)
    : [...selectedImageNames.value, fileName]
}

function selectMatchedImages(): void {
  selectedImageNames.value = (preview.value?.rows ?? [])
    .filter((row) => row.matched)
    .map((row) => row.labelImageName)
}

function clearImages(): void {
  selectedImageNames.value = []
}


function imageSummary(image: LabelPlusImageMatch): string {
  return image.matched ? image.sourceFileName || '已匹配' : '未找到图源'
}

function resetOptions(): void {
  const font = options.value.textStyle.font
  options.value = createDefaultLabelPlusGenerateOptions(font)
  selectedFontId.value = font.id
  selectedFontFamily.value = font.family
}

async function onProjectImportSave(payload: {
  parentTitle: string
  chapterNumber: string
  projectTitle: string
  folderPath: string
}): Promise<void> {
  try {
    const saved = await workspace.saveChild(payload)
    projectImportVisible.value = false
    toast.addToast({
      type: 'success',
      message:
        saved.skipped > 0 && saved.added === 0
          ? '项目已存在，已跳过导入'
          : saved.skipped > 0
            ? `项目添加成功，新增 ${saved.added} 个，跳过 ${saved.skipped} 个`
            : `项目添加成功（${saved.added} 个）`
    })
  } catch (error) {
    toast.addToast({
      type: 'error',
      message: `项目导入失败：${error instanceof Error ? error.message : String(error)}`
    })
  }
}

watch(
  [sourceDirectory, outputDirectory, matchMode, forcedExtension, autoImportProject, options],
  () => void persistSettings(),
  { deep: true }
)

watch(
  [
    sourceDirectory,
    outputDirectory,
    matchMode,
    forcedExtension,
    options,
    selectedImageNames,
    selectedGroups
  ],
  () => {
    // A temp PSD is a snapshot of these inputs. Do not keep showing it after
    // the user changes a setting or selection.
    previewResult.value = null
    result.value = null
  },
  { deep: true }
)

watch([sourceDirectory, matchMode, forcedExtension], () => {
  if (selection.value && settingsLoaded.value) void refreshPreview()
})

onMounted(() => {
  void (async () => {
    await loadSettings()
    await loadFonts()
  })()
})
</script>

<template>
  <div class="page-in page-layout min-h-full bg-app-bg text-text-primary" data-testid="import-page">
    <div class="flex flex-col">
      <header class="view-heading"><h1 class="view-title">导入 PSD</h1><UiButton variant="ghost" size="sm" data-testid="import-reset-options" :disabled="generating || photoshopBusy" @click="resetOptions">重置配置</UiButton></header>
      <fieldset :disabled="generating || photoshopBusy" class="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <section v-if="selection" class="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2" data-testid="import-file-section" data-labelplus-dropzone @dragover="onInputDragOver" @dragleave="onInputDragLeave" @drop="onInputDrop">
          <UiButton variant="outline" size="sm" :disabled="loadingFile" data-testid="import-file-button" @click="pickLabelFile">{{ loadingFile ? '读取中…' : selection ? '更换文件' : '选择 TXT / JSON / ZIP' }}</UiButton>
          <div v-if="selection" class="min-w-0 flex-1"><p class="truncate text-sm font-medium" :title="selection.filePath">{{ selection.fileName }}</p></div>
          <span v-else class="text-xs text-muted-foreground">也可拖入文件夹或 ZIP</span>
          <span v-if="selection" class="text-xs text-muted-foreground">{{ selection.images.length }} 张图片 · {{ selection.totalLabels }} 条文字 · {{ selection.groups.length }} 个分组</span>
          <InfoHint v-if="selection?.warnings.length" label="文件提示">{{ selection.warnings.join('；') }}</InfoHint>
        </section>
        <div v-if="selection" class="import-layout">
          <div class="import-form flex min-w-0 flex-col gap-3">
            <section
            class="min-w-0 rounded-lg border border-border bg-card p-3"
            data-testid="import-path-section"
          >
            
            <div class="grid gap-3">
              <label class="block text-xs text-text-secondary">
                <span class="mb-1 block font-medium text-text-primary">图源目录</span>
                <div class="flex gap-2">
                  <UiInput
                    v-model="sourceDirectory" :title="sourceDirectory"
                    class="min-w-0 flex-1 rounded-badge border border-border bg-app-bg px-2.5 py-1 text-xs outline-none focus:border-accent"
                    data-testid="import-source-directory"
                    placeholder="包含 PNG/JPG/PSD 的目录"
                  />
                  <UiButton variant="outline" size="sm"
                    type="button"
                    class="shrink-0"
                    data-testid="import-source-picker"
                    @click="pickSourceDirectory"
                  >
                    选择
                  </UiButton>
                </div>
              </label>
              <label class="block text-xs text-text-secondary">
                <span class="mb-1 block font-medium text-text-primary">PSD 输出目录</span>
                <div class="flex gap-2">
                  <UiInput
                    v-model="outputDirectory" :title="outputDirectory"
                    class="min-w-0 flex-1 rounded-badge border border-border bg-app-bg px-2.5 py-1 text-xs outline-none focus:border-accent"
                    data-testid="import-output-directory"
                    placeholder="默认为文本文件旁的 output"
                  />
                  <UiButton variant="outline" size="sm"
                    type="button"
                    class="shrink-0"
                    data-testid="import-output-picker"
                    @click="pickOutputDirectory"
                  >
                    选择
                  </UiButton>
                </div>
              </label>
              <div class="grid gap-2 sm:grid-cols-2">
                <label class="block text-xs text-text-secondary">
                  <span class="mb-1 flex h-5 items-center gap-1"
                    ><span class="block font-medium text-text-primary">图源匹配方式</span
                    ><InfoHint label="图源匹配方式说明">
                      <span
                        >按文件名匹配时会先尝试完整文件名，再按文件名主体和常见后缀优先级匹配；按顺序匹配时会使用自然排序。</span
                      >
                    </InfoHint></span
                  >
                  <AppSelect
                    v-model="matchMode"
                    :options="matchModeOptions"
                    test-id="import-match-mode"
                    size="small"
                  />
                </label>
                <label class="block text-xs text-text-secondary">
                  <span class="mb-1 flex h-5 items-center font-medium text-text-primary">强制图源后缀</span>
                  <AppSelect
                    v-model="forcedExtension"
                    :options="extensionOptions"
                    test-id="import-extension"
                    size="small"
                  />
                </label>
              </div>
            </div>
          </section>
            <div class="min-w-0 rounded-lg border border-border bg-card p-3"><section
            class="min-w-0"
            data-testid="import-groups-section"
          >
            <div class="flex items-start justify-between gap-2">
              <div>
                <h2 class="text-sm font-semibold">文本分组</h2>
                
              </div>
              <div class="flex gap-1">
                <UiButton variant="ghost" size="sm"
                  type="button"
                  class=""
                  data-testid="import-groups-all"
                  @click="setGroupPreset('all')"
                >
                  全选
                </UiButton>
                <UiButton variant="ghost" size="sm"
                  v-if="insideGroups.length"
                  type="button"
                  class=""
                  data-testid="import-groups-inside"
                  @click="setGroupPreset('inside')"
                >
                  只选框内
                </UiButton>
                <UiButton variant="ghost" size="sm"
                  v-if="outsideGroups.length"
                  type="button"
                  class=""
                  data-testid="import-groups-outside"
                  @click="setGroupPreset('outside')"
                >
                  只选框外
                </UiButton>
              </div>
            </div>
            <div class="mt-2 flex flex-wrap gap-2">
              <label
                v-for="group in groupNames"
                :key="group"
                class="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1 text-xs transition-colors hover:bg-card-bg-hover"
                :class="
                  selectedGroups.includes(group) ? 'border-selected-border bg-selected-bg' : ''
                "
              >
                <UiInput
                  type="checkbox"
                  class="h-3.5 w-3.5 accent-accent"
                  :checked="selectedGroups.includes(group)"
                  :data-testid="`import-group-${group}`"
                  @change="toggleGroup(group)"
                />
                <span class="min-w-0 truncate" :title="group">{{ group }}</span>
              </label>
            </div>
          </section></div>
            <div class="min-w-0 rounded-lg border border-border bg-card p-3"><section
            class="min-w-0"
            data-testid="import-style-section"
          >
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="flex items-center gap-1">
                  <h2 class="text-sm font-semibold">文字样式</h2>
                  <InfoHint label="4. 标准文字样式说明"
                    >字体写入标识会在后台自动映射；位置为 px + baseline，字号为 px（与 Photoshop
                    里一致，不再按分辨率折算）。</InfoHint
                  >
                </div>
              </div>
              
            </div>

            <div class="mt-2 flex flex-col gap-2">
              <div class="grid gap-2 sm:grid-cols-2">
                <label class="block text-xs text-text-secondary">
                  <span class="mb-1 block font-medium text-text-primary">字体</span>
                  <AppSelect
                    v-model="selectedFontId"
                    :options="fontOptions"
                    test-id="import-font"
                    size="small"
                    searchable
                    search-placeholder="输入字体或样式名"
                    @change="selectFontFamily"
                  />
                </label>
                <label class="block text-xs text-text-secondary">
                  <span class="mb-1 block font-medium text-text-primary">样式</span>
                  <AppSelect
                    v-model="selectedFontId"
                    :options="styleOptions"
                    test-id="import-font-style"
                    size="small"
                    searchable
                    search-placeholder="输入样式名"
                    @change="selectFont"
                  />
                </label>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <label class="block text-xs text-text-secondary"
                  ><span class="mb-1 block font-medium text-text-primary">字号（px）</span
                  ><UiInput
                    v-model.number="options.textStyle.fontSizePx"
                    type="number"
                    min="1"
                    max="720"
                    step="1"
                    class="w-full rounded-badge border border-border bg-app-bg px-2.5 py-1 text-xs outline-none focus:border-accent"
                    data-testid="import-font-size"
                /></label>
                <label class="block text-xs text-text-secondary"
                  ><span class="mb-1 block font-medium text-text-primary">行距（%）</span
                  ><UiInput
                    v-model.number="options.textStyle.leadingPercent"
                    type="number"
                    min="50"
                    max="500"
                    step="1"
                    class="w-full rounded-badge border border-border bg-app-bg px-2.5 py-1 text-xs outline-none focus:border-accent"
                    data-testid="import-leading"
                /></label>
                <label class="block text-xs text-text-secondary"
                  ><span class="mb-1 block font-medium text-text-primary">文字方向</span
                  ><AppSelect
                    v-model="options.textStyle.direction"
                    :options="directionOptions"
                    test-id="import-direction"
                    size="small"
                /></label>
                <label class="block text-xs text-text-secondary"
                  ><span class="mb-1 block font-medium text-text-primary">对齐</span
                  ><AppSelect
                    v-model="options.textStyle.alignment"
                    :options="alignmentOptions"
                    test-id="import-alignment"
                    size="small"
                /></label>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <label
                  class="flex cursor-pointer items-center gap-2 px-0 py-1 text-xs text-text-primary"
                  ><UiInput
                    v-model="options.textStyle.fauxBold"
                    type="checkbox"
                    class="accent-accent"
                    data-testid="import-bold"
                  />粗体</label
                >
                <label
                  class="flex cursor-pointer items-center gap-2 px-0 py-1 text-xs text-text-primary"
                  ><UiInput
                    v-model="options.textStyle.fauxItalic"
                    type="checkbox"
                    class="accent-accent"
                    data-testid="import-italic"
                  />斜体</label
                >
                <!-- 用 PS 面板的原词「自由连字」。默认是开的（PS 与 ag-psd 都是），
                     所以这个勾的存在意义是"能关掉"，不是"能打开"。 -->
                <label
                  class="flex cursor-pointer items-center gap-2 px-0 py-1 text-xs text-text-primary"
                  ><UiInput
                    v-model="options.textStyle.ligatures"
                    type="checkbox"
                    class="accent-accent"
                    data-testid="import-ligatures"
                  />自由连字<InfoHint label="自由连字说明">
                    <span
                      >对应 Photoshop 字符面板的「自由连字」。Photoshop
                      新建文字层时默认就是开的。</span
                    >
                  </InfoHint></label
                >
                <label
                  class="flex cursor-pointer items-center gap-2 px-0 py-1 text-xs text-text-primary"
                  ><UiInput
                    v-model="options.textStyle.standardVerticalRoman"
                    type="checkbox"
                    class="accent-accent"
                    data-testid="import-vertical-roman"
                  />标准垂直罗马对齐<InfoHint label="标准垂直罗马对齐说明">
                    <span
                      >对应 Photoshop
                      字符面板菜单里的「标准垂直罗马对齐方式」。只对竖排有效：决定竖排里的拉丁字母和数字是竖着站（开）还是转
                      90°（关）。⚠️ 目前只有本地「生成 PSD」支持它 —— 「交给
                      Photoshop」那条路设不了（PS 的脚本 DOM
                      没暴露这个属性），跑的时候会明确警告。</span
                    >
                  </InfoHint></label
                >
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <label class="block text-xs text-text-secondary"
                  ><span class="mb-1 block font-medium text-text-primary">填充颜色</span>
                  <div class="flex gap-2">
                    <UiInput
                      v-model="options.textStyle.fillColor"
                      type="text"
                      class="min-w-0 flex-1 rounded-badge border border-border bg-app-bg px-2.5 py-1 text-xs outline-none focus:border-accent"
                      data-testid="import-fill-color"
                    /><UiInput
                      v-model="options.textStyle.fillColor"
                      type="color"
                      class="h-8 w-9 rounded-badge border border-border bg-app-bg p-0.5"
                      aria-label="填充颜色选择器"
                    /></div
                ></label>
                <label class="block text-xs text-text-secondary"
                  ><span class="mb-1 block font-medium text-text-primary">描边颜色</span>
                  <div class="flex gap-2">
                    <UiInput
                      v-model="options.textStyle.strokeColor"
                      type="text"
                      class="min-w-0 flex-1 rounded-badge border border-border bg-app-bg px-2.5 py-1 text-xs outline-none focus:border-accent"
                      data-testid="import-stroke-color"
                    /><UiInput
                      v-model="options.textStyle.strokeColor"
                      type="color"
                      class="h-8 w-9 rounded-badge border border-border bg-app-bg p-0.5"
                      aria-label="描边颜色选择器"
                    /></div
                ></label>
                <label class="block text-xs text-text-secondary"
                  ><span class="mb-1 block font-medium text-text-primary">描边宽度（px）</span
                  ><UiInput
                    v-model.number="options.textStyle.strokeWidthPx"
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    class="w-full rounded-badge border border-border bg-app-bg px-2.5 py-1 text-xs outline-none focus:border-accent"
                    data-testid="import-stroke-width"
                /></label>
              </div>
            </div>
          </section></div>
            <ImportOutputOptions v-model="options" />
          </div>
          <div class="import-preview-column"><div class="import-preview-stack flex min-w-0 flex-col gap-3">
            <div class="shrink-0 rounded-lg border border-border bg-card p-3"><section
            class="min-w-0"
            data-testid="import-result-section"
          >
            <div class="flex flex-wrap items-center justify-end gap-2">
              
              <div class="flex items-center gap-2">
                <label
                  class="flex cursor-pointer items-center gap-2 text-xs font-medium text-text-primary"
                  ><UiInput
                    v-model="autoImportProject"
                    type="checkbox"
                    class="accent-accent"
                    data-testid="import-auto-project"
                  />生成后导入项目</label
                ><UiButton variant="default" size="sm"
                  type="button"
                  class="transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="generating || photoshopBusy || loadingFile || loadingPreview || !preview"
                  data-testid="import-generate-button"
                  @click="generate"
                >
                  {{ generating ? '生成中…' : '直接生成 PSD' }}
                </UiButton>
              </div>
            </div>
            <div v-if="result" class="mt-2 grid gap-2 sm:grid-cols-3">
              <div class="rounded-md bg-success p-3 text-xs font-semibold text-success-fg">
                成功<strong class="ml-2 text-base">{{ result.generatedCount }}</strong>
              </div>
              <div class="rounded-md bg-warning p-3 text-xs font-semibold text-warning-fg">
                跳过<strong class="ml-2 text-base">{{ result.skippedCount }}</strong>
              </div>
              <div class="rounded-md bg-danger p-3 text-xs font-semibold text-danger-fg">
                失败<strong class="ml-2 text-base">{{ result.failedCount }}</strong>
              </div>
            </div>
            <div v-if="result" class="mt-3 max-h-72 overflow-auto rounded-md border border-border">
              <div
                v-for="file in result.files"
                :key="`${file.labelImageName}-${file.outputPath || file.status}`"
                class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1 text-xs last:border-0"
              >
                <UiButton variant="ghost" size="sm"
                  v-if="canPreviewImage(file.labelImageName)"
                  type="button"
                  class="min-w-0 flex-1 truncate text-left underline decoration-dashed underline-offset-2"
                  :title="file.outputPath || resultFileName(file)"
                  @click="openLabelPlusPreview('output', file.labelImageName)"
                >
                  {{ resultFileName(file) }}</UiButton><span
                  v-else
                  class="min-w-0 flex-1 truncate font-bold"
                  :title="file.outputPath || resultFileName(file)"
                  >{{ resultFileName(file) }}</span
                ><span :class="resultClass(file.status)"
                  >{{ file.message
                  }}<span v-if="file.textLayerCount" class="ml-1 text-text-tertiary"
                    >({{ file.textLayerCount }} 层)</span
                  ></span
                >
              </div>
            </div>
            <div
              v-if="result?.warnings.length"
              class="mt-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-1 text-xs leading-5 text-warning"
            >
              {{ result.warnings.join('；') }}
            </div>
          </section></div>
            <div class="import-preview-card rounded-lg border border-border bg-card p-3"><section
            class="import-preview-content min-w-0"
            data-testid="import-preview-section"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 class="text-sm font-semibold">图源匹配预览</h2>
                <p class="mt-1 text-xs text-text-secondary">
                  {{
                    loadingPreview
                      ? '匹配中…'
                      : preview
                        ? `已匹配 ${preview.matchedCount}/${preview.rows.length}`
                        : '选择图源目录后开始匹配'
                  }}
                </p>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <UiButton variant="outline" size="sm"
                  type="button"
                  class=""
                  data-testid="import-refresh-preview"
                  @click="refreshPreview"
                >
                  刷新匹配</UiButton><UiButton variant="outline" size="sm"
                  type="button"
                  class="transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="previewGenerating || generating || !preview"
                  data-testid="import-generate-preview-button"
                  @click="generatePreview"
                >
                  {{ previewGenerating ? '生成样张中…' : '生成样张' }}</UiButton><UiButton variant="outline" size="sm"
                  type="button"
                  class=""
                  @click="selectAllImages"
                >
                  全选</UiButton><UiButton variant="outline" size="sm"
                  type="button"
                  class=""
                  @click="selectMatchedImages"
                >
                  仅已匹配</UiButton><UiButton variant="outline" size="sm"
                  type="button"
                  class=""
                  @click="clearImages"
                >
                  清空
                </UiButton>
              </div>
            </div>
            <div v-if="preview" class="import-preview-body mt-2 flex flex-col gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <UiInput
                  v-model="imageFilter"
                  type="search"
                  class="min-w-52 flex-1 rounded-badge border border-border bg-app-bg px-2.5 py-1 text-xs outline-none focus:border-accent"
                  placeholder="筛选文本图片名"
                  data-testid="import-image-filter"
                /><span class="text-[11px] text-text-tertiary"
                  >已选 {{ selectedRowCount }} 张，匹配 {{ matchedSelectedCount }} 张</span
                >
              </div>
              <div class="import-preview-scroll overflow-auto rounded-md border border-border">
                <Table class="w-full border-collapse text-left text-xs">
                  <TableHeader class="sticky top-0 bg-sunken text-[11px] text-text-secondary">
                    <TableRow>
                      <TableHead class="w-9 px-3 py-2"></TableHead>
                      <TableHead class="px-3 py-2">LabelPlus 图片</TableHead>
                      <TableHead class="px-3 py-2">标签</TableHead>
                      <TableHead class="px-3 py-2">图源</TableHead>
                      <TableHead class="px-3 py-2">状态 / 输出</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow
                      v-for="row in filteredRows"
                      :key="row.labelImageName"
                      class="border-t border-border hover:bg-card-bg-hover"
                    >
                      <TableCell class="px-3 py-2">
                        <UiInput
                          type="checkbox"
                          class="accent-accent"
                          :checked="selectedImageNames.includes(row.labelImageName)"
                          :data-testid="`import-image-${row.labelImageName}`"
                          @change="toggleImage(row.labelImageName)"
                        />
                      </TableCell>
                      <TableCell class="max-w-52 truncate px-3 py-2 font-bold" :title="row.labelImageName">
                        <UiButton variant="ghost" size="sm"
                          v-if="row.matched"
                          type="button"
                          class="max-w-full truncate underline decoration-dashed underline-offset-2"
                          :data-testid="`import-source-preview-${row.labelImageName}`"
                          @click="openLabelPlusPreview('source', row.labelImageName)"
                        >
                          {{ row.labelImageName }}
                        </UiButton>
                        <span v-else>{{ row.labelImageName }}</span>
                      </TableCell>
                      <TableCell class="px-3 py-2 text-text-secondary">{{ row.labelCount }}</TableCell>
                      <TableCell
                        class="max-w-64 truncate px-3 py-2 font-bold"
                        :title="row.sourceFileName || ''"
                      >
                        <UiButton variant="ghost" size="sm"
                          v-if="row.matched"
                          type="button"
                          class="max-w-full truncate underline decoration-dashed underline-offset-2"
                          :data-testid="`import-source-name-${row.labelImageName}`"
                          @click="openLabelPlusPreview('source', row.labelImageName)"
                        >
                          {{ row.sourceFileName }}
                        </UiButton>
                        <span v-else>—</span>
                      </TableCell>
                      <TableCell class="px-3 py-2" :class="row.matched ? 'text-success' : 'text-warning'">
                        <UiButton variant="ghost" size="sm"
                          v-if="row.matched"
                          type="button"
                          class="underline decoration-dashed underline-offset-2 transition-colors"
                          :data-testid="`import-output-preview-${row.labelImageName}`"
                          @click="openLabelPlusPreview('output', row.labelImageName)"
                        >
                          {{ outputPreviewName(row) }}
                        </UiButton>
                        <span v-else>{{ imageSummary(row) }}</span>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              <div
                v-if="preview.warnings.length"
                class="rounded-md border border-warning/30 bg-warning-soft px-3 py-1 text-xs leading-5 text-warning"
              >
                {{ preview.warnings.join('；') }}
              </div>
            </div>
            <div
              v-else
              class="mt-5 rounded-md border border-dashed border-border bg-app-bg px-4 py-10 text-center text-sm text-text-tertiary"
            >
              尚未生成匹配预览
            </div>
          </section></div>
          </div></div>
        </div>
        <section
        v-else
        class="rounded-lg border border-dashed bg-card-bg px-6 py-6 text-center transition-colors"
        :class="dropActive ? 'border-accent bg-primary-soft' : 'border-border'"
        data-testid="import-empty-state"
        data-labelplus-dropzone
        @dragover="onInputDragOver"
        @dragleave="onInputDragLeave"
        @drop="onInputDrop"
      >
        <div class="mx-auto flex max-w-md flex-col items-center">
          <div
            class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-accent"
          >
            <svg
              class="h-6 w-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 20h14" />
            </svg>
          </div>
          <div class="relative mt-4 flex items-center justify-center">
            <h2 class="text-center text-lg font-semibold">从 LabelPlus 文本开始</h2>
            <span class="absolute left-full ml-1 inline-flex">
            <InfoHint label="从 LabelPlus 文本开始说明"
              >可选择 TXT / JSON，也可以把包含图片和文本的文件夹或 ZIP 直接拖到这里。ZIP 会解压到
              EXE 同级 temp/包名，输出目录默认是 output。</InfoHint
            >
            </span>
          </div>
          <div class="mt-4 flex flex-col items-center justify-center gap-2">
            <UiButton variant="outline" size="sm" :disabled="loadingFile" data-testid="import-file-button" @click="pickLabelFile">{{ loadingFile ? '读取中…' : '选择 TXT / JSON / ZIP' }}</UiButton>
            <span class="text-xs text-muted-foreground">也可拖入文件夹或 ZIP</span>
          </div>
        </div>
      </section>
      </fieldset>
    </div>
    <ProjectFormModal
      v-if="projectImportVisible"
      mode="add"
      :initial-data="{
        parentTitle: '',
        chapterNumber: '',
        projectTitle: '',
        folderPath: sourceDirectory
      }"
      :existing-parent-titles="workspace.parents.map((parent) => parent.title)"
      @save="onProjectImportSave"
      @cancel="projectImportVisible = false"
      @delete="projectImportVisible = false"
    />
  </div>
</template>

<style scoped>
.import-layout { display:grid; min-width:0; align-items:stretch; gap:16px; }
.import-preview-column { min-width:0; }
.import-preview-scroll { max-height:520px; }
@media (min-width:1100px) {
.import-preview-column { position:relative; min-height:520px; }
.import-preview-stack { position:absolute; inset:0; overflow:auto; }
.import-preview-card, .import-preview-content, .import-preview-body { display:flex; flex-direction:column; flex:1; min-height:0; }
.import-preview-content > :first-child, .import-preview-body > :first-child { flex-shrink:0; }
.import-preview-scroll { flex:1; min-height:0; max-height:none; }
}
@media (min-width:1100px) {
  .import-layout { grid-template-columns:minmax(0, 0.9fr) minmax(0, 1.1fr); }
}
.import-form :deep(label), .import-form :deep(.grid > *) { min-width:0; }
.import-form :deep(input:not([type=checkbox]):not([type=radio])) { height:32px; }
.import-form :deep(button[role=combobox]) { height:32px; }
</style>
