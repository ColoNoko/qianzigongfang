<script setup lang="ts">
import { basenameOf } from '@shared/paths'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SystemFontInfo } from '@shared/ipc-api'
import type {
  LabelPlusFileSelection,
  LabelPlusGenerateOptions,
  LabelPlusGenerateResult,
  LabelPlusImageMatch,
  LabelPlusMatchMode,
  LabelPlusMatchPreview,
  StandardFontRef
} from '@shared/labelplus-import'
import {
  LABELPLUS_IMPORT_API_VERSION,
  LABELPLUS_IMPORT_SETTINGS_KEY,
  createDefaultLabelPlusGenerateOptions,
  createDefaultStandardFont,
  normalizeLabelPlusExtension
} from '@shared/labelplus-import'
import type {
  LabelPlusJobReport,
  LabelPlusManifestJobRequest,
  LabelPlusPhotoshopRunResult
} from '@shared/labelplus-manifest'
import AppSelect, { type AppSelectOption } from '@renderer/components/AppSelect.vue'
import ProjectFormModal from '@renderer/components/ProjectFormModal.vue'
import { useProjectWorkspace } from '@renderer/stores/projectWorkspace'
import { useSettingsStore } from '@renderer/stores/settings'
import { useToastStore } from '@renderer/stores/toast'

defineOptions({ name: 'Import' })

type GroupPreset = 'all' | 'inside' | 'outside'

interface PersistedImportSettings {
  sourceDirectory: string
  outputDirectory: string
  matchMode: LabelPlusMatchMode
  forcedExtension: string
  autoImportProject: boolean
  options: LabelPlusGenerateOptions
  /** 「交给 Photoshop」那一块的动作集名。留空 = 只出图不跑动作。 */
  photoshopActionSet: string
  /** 分组名 → 动作名。空串 = 回落到分组名本身。 */
  photoshopGroupActions: Record<string, string>
  /** 分组名 → 方向选择。'inherit' = 跟随全场的文字方向。 */
  photoshopGroupDirections: Record<string, GroupDirectionChoice>
}

/** 分组级方向的三选一。'inherit' 不落进清单 —— 不写就是跟随 defaults。 */
type GroupDirectionChoice = 'inherit' | 'horizontal' | 'vertical'

const toast = useToastStore()
const workspace = useProjectWorkspace()
const settings = useSettingsStore()
const selection = ref<LabelPlusFileSelection | null>(null)
const sourceDirectory = ref('')
const outputDirectory = ref('')
const matchMode = ref<LabelPlusMatchMode>('file-name')
const forcedExtension = ref('')
const preview = ref<LabelPlusMatchPreview | null>(null)
const selectedImageNames = ref<string[]>([])
const selectedGroups = ref<string[]>([])
const fonts = ref<SystemFontInfo[]>([])
const selectedFontId = ref('builtin-arial')
const selectedFontFamily = ref('Arial')
const options = ref<LabelPlusGenerateOptions>(createDefaultLabelPlusGenerateOptions())
const loadingFile = ref(false)
const loadingPreview = ref(false)
const generating = ref(false)
const settingsLoaded = ref(false)
const result = ref<LabelPlusGenerateResult | null>(null)
const previewResult = ref<LabelPlusGenerateResult | null>(null)
const previewGenerating = ref(false)
const imageFilter = ref('')
const dropActive = ref(false)
const autoImportProject = ref(true)
const projectImportVisible = ref(false)
/**
 * 「交给 Photoshop」那一块。刻意与本地出图完全独立：
 *   photoshopJob     = 本次递出去的清单信息（路径、数量）
 *   photoshopReport  = PS 写回来的回执（轮询读，不需要额外的进度事件通道）
 *   photoshopBusy    = 正在递清单 / 启动 PS
 */
const photoshopActionSet = ref('')
const photoshopGroupActions = ref<Record<string, string>>({})
const photoshopGroupDirections = ref<Record<string, GroupDirectionChoice>>({})
const photoshopJob = ref<LabelPlusPhotoshopRunResult | null>(null)
const photoshopReport = ref<LabelPlusJobReport | null>(null)
const photoshopBusy = ref(false)
let reportTimer: ReturnType<typeof setInterval> | null = null
let previewSequence = 0

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

/**
 * 分组级方向：多一个 'inherit'（跟随全场），所以不能复用 directionOptions。
 * 'inherit' 不会落进清单 —— 不写那个字段就是跟随 defaults。
 */
const groupDirectionOptions: AppSelectOption[] = [
  { value: 'inherit', label: '跟随默认' },
  { value: 'horizontal', label: '横排' },
  { value: 'vertical', label: '竖排' }
]

const alignmentOptions: AppSelectOption[] = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' }
]

const overlayColorOptions: AppSelectOption[] = [
  { value: 'sample', label: '取标签点颜色' },
  { value: 'white', label: '白色' },
  { value: 'custom', label: '自定义颜色' }
]

const fontOptions = computed<AppSelectOption[]>(() => [
  ...fonts.value.map((font) => ({
    value: font.id,
    label: `${font.family} - ${font.style}`
  })),
  ...(fonts.value.some((font) => font.id === 'builtin-arial')
    ? []
    : [{ value: 'builtin-arial', label: 'Arial - Regular（兼容回退）' }])
])

const styleOptions = computed<AppSelectOption[]>(() => {
  const familyFonts = fonts.value.filter((font) => font.family === selectedFontFamily.value)
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
  () => (preview.value?.rows ?? []).filter((row) => selectedImageNames.value.includes(row.labelImageName)).length
)
const matchedSelectedCount = computed(
  () =>
    (preview.value?.rows ?? []).filter(
      (row) => row.matched && selectedImageNames.value.includes(row.labelImageName)
    ).length
)
const selectedGroupLabel = computed(() =>
  selectedGroups.value.length === groupNames.value.length ? '全部分组' : `${selectedGroups.value.length} 个分组`
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * 从存档里读回"分组名 → 动作名"。只保留字符串值的项 ——
 * 存档是 JSON 落库的，历史版本或被手改过都可能塞进别的东西。
 */
function stringRecordOr(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') result[key] = entry
  }
  return result
}

/** 方向只认这三个值；存档里出现别的一律丢掉，而不是把脏值带进请求。 */
function directionRecordOr(value: unknown): Record<string, GroupDirectionChoice> {
  const valid: GroupDirectionChoice[] = ['inherit', 'horizontal', 'vertical']
  if (!isRecord(value)) return {}
  const result: Record<string, GroupDirectionChoice> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (valid.includes(entry as GroupDirectionChoice)) result[key] = entry as GroupDirectionChoice
  }
  return result
}

function mergeOptions(raw: unknown): LabelPlusGenerateOptions {
  const defaults = createDefaultLabelPlusGenerateOptions(options.value.textStyle.font)
  if (!isRecord(raw)) return defaults
  const rawStyle = isRecord(raw.textStyle) ? raw.textStyle : {}
  const rawFont = isRecord(rawStyle.font) ? rawStyle.font : {}
  const rawShadow = isRecord(rawStyle.shadow) ? rawStyle.shadow : {}
  const rawOffset = isRecord(raw.positionOffset) ? raw.positionOffset : {}
  const rawIndexOffset = isRecord(raw.labelIndexOffset) ? raw.labelIndexOffset : {}
  const rawOverlay = isRecord(raw.dialogOverlay) ? raw.dialogOverlay : {}
  const font: StandardFontRef = {
    id: stringOr(rawFont.id, defaults.textStyle.font.id),
    family: stringOr(rawFont.family, defaults.textStyle.font.family),
    style: stringOr(rawFont.style, defaults.textStyle.font.style),
    postScriptName: stringOr(rawFont.postScriptName, defaults.textStyle.font.postScriptName),
    ...(typeof rawFont.filePath === 'string' ? { filePath: rawFont.filePath } : {})
  }
  return {
    resolutionPpi: numberOr(raw.resolutionPpi, defaults.resolutionPpi),
    ignoreImagesWithoutLabels: booleanOr(
      raw.ignoreImagesWithoutLabels,
      defaults.ignoreImagesWithoutLabels
    ),
    createLayerGroups: booleanOr(raw.createLayerGroups, defaults.createLayerGroups),
    outputLabelIndex: booleanOr(raw.outputLabelIndex, defaults.outputLabelIndex),
    overwriteExisting: booleanOr(raw.overwriteExisting, defaults.overwriteExisting),
    textReplacementExpression: stringOr(
      raw.textReplacementExpression,
      defaults.textReplacementExpression
    ),
    textStyle: {
      font,
      // fontSizePt 是 2026-09-23 之前的键名 —— 不认它的话，旧存档里的字号会静默变回默认值。
      fontSizePx: numberOr(
        rawStyle.fontSizePx ?? rawStyle.fontSize ?? rawStyle.fontSizePt,
        defaults.textStyle.fontSizePx
      ),
      direction:
        (rawStyle.direction ?? rawStyle.orientation) === 'vertical' ? 'vertical' : 'horizontal',
      leadingPercent: numberOr(rawStyle.leadingPercent, defaults.textStyle.leadingPercent),
      alignment:
        rawStyle.alignment === 'center' || rawStyle.alignment === 'right'
          ? rawStyle.alignment
          : 'left',
      fillColor: stringOr(rawStyle.fillColor, defaults.textStyle.fillColor),
      strokeColor: stringOr(rawStyle.strokeColor, defaults.textStyle.strokeColor),
      strokeWidthPx: numberOr(rawStyle.strokeWidthPx, defaults.textStyle.strokeWidthPx),
      fauxBold: booleanOr(rawStyle.fauxBold ?? rawStyle.bold, defaults.textStyle.fauxBold),
      fauxItalic: booleanOr(rawStyle.fauxItalic ?? rawStyle.italic, defaults.textStyle.fauxItalic),
      // 旧存档里没有这俩字段 → 都用默认值 true。
      ligatures: booleanOr(rawStyle.ligatures, defaults.textStyle.ligatures),
      standardVerticalRoman: booleanOr(
        rawStyle.standardVerticalRoman,
        defaults.textStyle.standardVerticalRoman
      ),
      shadow: {
        enabled: booleanOr(rawShadow.enabled, defaults.textStyle.shadow.enabled),
        color: stringOr(rawShadow.color, defaults.textStyle.shadow.color),
        opacity: numberOr(rawShadow.opacity, defaults.textStyle.shadow.opacity),
        distancePx: numberOr(rawShadow.distancePx, defaults.textStyle.shadow.distancePx),
        blurPx: numberOr(rawShadow.blurPx, defaults.textStyle.shadow.blurPx),
        angleDeg: numberOr(rawShadow.angleDeg, defaults.textStyle.shadow.angleDeg)
      }
    },
    positionOffset: {
      unit: 'px',
      x: numberOr(rawOffset.x, 0),
      y: numberOr(rawOffset.y, 0)
    },
    labelIndexOffset: {
      unit: 'px',
      x: numberOr(rawIndexOffset.x, 0),
      y: numberOr(rawIndexOffset.y, 0)
    },
    dialogOverlay: {
      enabled: booleanOr(rawOverlay.enabled, defaults.dialogOverlay.enabled),
      groups: Array.isArray(rawOverlay.groups)
        ? rawOverlay.groups.filter((value): value is string => typeof value === 'string')
        : [],
      radiusXPx: numberOr(rawOverlay.radiusXPx, defaults.dialogOverlay.radiusXPx),
      radiusYPx: numberOr(rawOverlay.radiusYPx, defaults.dialogOverlay.radiusYPx),
      colorMode:
        rawOverlay.colorMode === 'white' || rawOverlay.colorMode === 'custom'
          ? rawOverlay.colorMode
          : 'sample',
      customColor: stringOr(rawOverlay.customColor, defaults.dialogOverlay.customColor)
    }
  }
}

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
      options.value = mergeOptions(raw.options)
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

async function loadFonts(): Promise<void> {
  if (typeof window.comicType?.fontList !== 'function') return
  try {
    const result = await window.comicType.fontList()
    fonts.value = result.fonts
    const current = fonts.value.find((font) => font.id === options.value.textStyle.font.id)
    if (current) {
      selectedFontId.value = current.id
      selectedFontFamily.value = current.family
      return
    }
    const first = fonts.value[0]
    if (first) selectFont(first.id)
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
    options.value.textStyle.font = {
      id: font.id,
      family: font.family,
      style: font.style,
      postScriptName: font.postScriptName || font.family,
      filePath: font.filePath
    }
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

function selectAllImages(): void {
  selectedImageNames.value = (preview.value?.rows ?? []).map((row) => row.labelImageName)
}

function selectMatchedImages(): void {
  selectedImageNames.value = (preview.value?.rows ?? [])
    .filter((row) => row.matched)
    .map((row) => row.labelImageName)
}

function clearImages(): void {
  selectedImageNames.value = []
}

function toggleOverlayGroup(group: string): void {
  const groups = options.value.dialogOverlay.groups
  options.value.dialogOverlay.groups = groups.includes(group)
    ? groups.filter((item) => item !== group)
    : [...groups, group]
}

function imageSummary(image: LabelPlusImageMatch): string {
  return image.matched ? image.sourceFileName || '已匹配' : '未找到图源'
}

function pathBaseName(path: string | null | undefined): string {
  if (!path) return ''
  return basenameOf(path)
}

function outputPathForImage(imageName: string): string | null {
  const sources = [result.value, previewResult.value]
  for (const source of sources) {
    const file = source?.files.find(
      (item) => item.labelImageName === imageName && item.outputPath
    )
    if (file?.outputPath) return file.outputPath
  }
  return null
}

function outputPreviewPaths(): Record<string, string> {
  const paths: Record<string, string> = {}
  for (const source of [previewResult.value, result.value]) {
    for (const file of source?.files ?? []) {
      if (file.outputPath) paths[file.labelImageName] = file.outputPath
    }
  }
  return paths
}

function outputPreviewName(image: LabelPlusImageMatch): string {
  const source = image.sourceFileName || image.labelImageName
  const withoutExtension = source.replace(/\.[^.\\/]+$/, '')
  return (
    pathBaseName(outputPathForImage(image.labelImageName)) ||
    `${withoutExtension || 'untitled'}.psd`
  )
}

function canPreviewImage(imageName: string): boolean {
  return Boolean(
    outputPathForImage(imageName) ||
      preview.value?.rows.some((row) => row.labelImageName === imageName && row.matched)
  )
}

function resultFileName(file: LabelPlusGenerateResult['files'][number]): string {
  const actual = pathBaseName(file.outputPath)
  if (actual) return actual
  const source = pathBaseName(file.sourcePath) || file.labelImageName
  const withoutExtension = source.replace(/\.[^.\\/]+$/, '')
  return `${withoutExtension || 'untitled'}.psd`
}

function resultClass(status: LabelPlusGeneratedFileStatus): string {
  if (status === 'generated') return 'text-success'
  if (status === 'failed') return 'text-danger'
  return 'text-warning'
}

type LabelPlusGeneratedFileStatus = NonNullable<LabelPlusGenerateResult['files'][number]>['status']

async function applySelection(next: LabelPlusFileSelection): Promise<void> {
  selection.value = next
  sourceDirectory.value = next.suggestedSourceDirectory || sourceDirectory.value
  outputDirectory.value = next.suggestedOutputDirectory || outputDirectory.value
  selectedGroups.value = [...next.groups]
  selectedImageNames.value = next.images.map((image) => image.fileName)
  result.value = null
  previewResult.value = null
  projectImportVisible.value = false
  await refreshPreview()
}

async function loadDroppedInput(inputPath: string): Promise<void> {
  if (!inputPath || loadingFile.value) return
  loadingFile.value = true
  try {
    const next = await window.comicType.prepareLabelPlusInput(inputPath)
    await applySelection(next)
  } catch (error) {
    toast.addToast({
      type: 'error',
      message: `导入内容读取失败：${error instanceof Error ? error.message : String(error)}`
    })
  } finally {
    loadingFile.value = false
  }
}

function droppedPath(event: DragEvent): string {
  const file = event.dataTransfer?.files?.[0]
  if (!file) return ''
  try {
    if (typeof window.comicType?.getPathForFile === 'function') {
      return window.comicType.getPathForFile(file)
    }
  } catch {
    // Older Electron builds may still expose the legacy File.path property.
  }
  return String((file as File & { path?: string }).path ?? '')
}

function onInputDragOver(event: DragEvent): void {
  event.preventDefault()
  event.stopPropagation()
  dropActive.value = true
}

function onInputDragLeave(event: DragEvent): void {
  event.preventDefault()
  event.stopPropagation()
  const current = event.currentTarget as HTMLElement | null
  if (!current?.contains(event.relatedTarget as Node | null)) dropActive.value = false
}

async function onInputDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  event.stopPropagation()
  dropActive.value = false
  const path = droppedPath(event)
  if (!path) {
    toast.addToast({ type: 'warning', message: '无法读取拖入文件的本地路径' })
    return
  }
  await loadDroppedInput(path)
}

async function pickLabelFile(): Promise<void> {
  if (loadingFile.value) return
  loadingFile.value = true
  try {
    const next = await window.comicType.pickLabelPlusFile()
    if (!next) return
    await applySelection(next)
  } catch (error) {
    toast.addToast({
      type: 'error',
      message: `LabelPlus 文件读取失败：${error instanceof Error ? error.message : String(error)}`
    })
  } finally {
    loadingFile.value = false
  }
}

async function pickSourceDirectory(): Promise<void> {
  const picked = await window.comicType.pickDirectory()
  if (!picked) return
  sourceDirectory.value = picked
  await refreshPreview()
}

async function pickOutputDirectory(): Promise<void> {
  const picked = await window.comicType.pickDirectory()
  if (picked) outputDirectory.value = picked
}

async function refreshPreview(): Promise<void> {
  previewResult.value = null
  if (!selection.value || !sourceDirectory.value) {
    preview.value = null
    return
  }
  const sequence = ++previewSequence
  loadingPreview.value = true
  try {
    const next = await window.comicType.previewLabelPlusImport({
      apiVersion: LABELPLUS_IMPORT_API_VERSION,
      labelFilePath: selection.value.filePath,
      sourceDirectory: sourceDirectory.value,
      match: {
        mode: matchMode.value,
        forcedExtension: normalizeLabelPlusExtension(forcedExtension.value)
      }
    })
    if (sequence !== previewSequence) return
    preview.value = next
    if (selectedImageNames.value.length === 0) selectAllImages()
  } catch (error) {
    if (sequence === previewSequence) {
      preview.value = null
      toast.addToast({
        type: 'error',
        message: `图源匹配失败：${error instanceof Error ? error.message : String(error)}`
      })
    }
  } finally {
    if (sequence === previewSequence) loadingPreview.value = false
  }
}

function resetOptions(): void {
  const font = options.value.textStyle.font
  options.value = createDefaultLabelPlusGenerateOptions(font)
  selectedFontId.value = font.id
  selectedFontFamily.value = font.family
}

async function openLabelPlusPreview(
  mode: 'source' | 'output',
  initialImageName: string
): Promise<void> {
  if (!selection.value || !sourceDirectory.value) return
  const generatedOutputPaths = outputPreviewPaths()
  if (
    mode === 'output' &&
    Object.keys(generatedOutputPaths).length > 0 &&
    !generatedOutputPaths[initialImageName]
  ) {
    toast.addToast({ type: 'warning', message: '该项没有可用的已生成 PSD 预览' })
    return
  }
  try {
    const opened = await window.comicType.openLabelPlusPreview({
      apiVersion: LABELPLUS_IMPORT_API_VERSION,
      labelFilePath: selection.value.filePath,
      sourceDirectory: sourceDirectory.value,
      match: {
        mode: matchMode.value,
        forcedExtension: normalizeLabelPlusExtension(forcedExtension.value)
      },
      outputDirectory: outputDirectory.value || selection.value.suggestedOutputDirectory,
      selectedImageNames: [...selectedImageNames.value],
      selectedGroups: [...selectedGroups.value],
      options: JSON.parse(JSON.stringify(options.value)) as LabelPlusGenerateOptions,
      mode,
      initialImageName,
      ...(mode === 'output' && Object.keys(generatedOutputPaths).length > 0
        ? { previewOutputPaths: generatedOutputPaths }
        : {})
    })
    if (!opened.opened) toast.addToast({ type: 'warning', message: opened.message || '没有可预览内容' })
  } catch (error) {
    toast.addToast({
      type: 'error',
      message: `打开预览失败：${error instanceof Error ? error.message : String(error)}`
    })
  }
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

async function generatePreview(): Promise<void> {
  if (!selection.value || !sourceDirectory.value || !preview.value) {
    toast.addToast({ type: 'warning', message: '请先选择 LabelPlus 文本和图源目录' })
    return
  }
  if (selectedGroups.value.length === 0) {
    toast.addToast({ type: 'warning', message: '请至少选择一个文本分组' })
    return
  }
  previewGenerating.value = true
  try {
    const next = await window.comicType.generateLabelPlusPreviewPsd({
      apiVersion: LABELPLUS_IMPORT_API_VERSION,
      labelFilePath: selection.value.filePath,
      sourceDirectory: sourceDirectory.value,
      match: {
        mode: matchMode.value,
        forcedExtension: normalizeLabelPlusExtension(forcedExtension.value)
      },
      // The main process replaces this with a disposable EXE-adjacent temp
      // directory. Keeping the field here preserves the same request shape
      // as the normal generator for external API clients.
      selectedImageNames: [...selectedImageNames.value],
      selectedGroups: [...selectedGroups.value],
      options: JSON.parse(JSON.stringify(options.value)) as LabelPlusGenerateOptions
    })
    previewResult.value = next
    const generated = next.files.filter((file) => file.status === 'generated').length
    toast.addToast({
      type: next.failedCount > 0 ? 'warning' : 'success',
      message: `临时预览已生成 ${generated} 个 PSD`
    })
  } catch (error) {
    toast.addToast({
      type: 'error',
      message: `生成预览 PSD 失败：${error instanceof Error ? error.message : String(error)}`
    })
  } finally {
    previewGenerating.value = false
  }
}

async function generate(): Promise<void> {
  if (!selection.value) {
    toast.addToast({ type: 'warning', message: '请先选择 LabelPlus 文本文件' })
    return
  }
  if (!sourceDirectory.value) {
    toast.addToast({ type: 'warning', message: '请选择图源目录' })
    return
  }
  if (!outputDirectory.value) {
    toast.addToast({ type: 'warning', message: '请选择输出目录' })
    return
  }
  if (selectedGroups.value.length === 0) {
    toast.addToast({ type: 'warning', message: '请至少选择一个文本分组' })
    return
  }
  // 一张图都没选就发请求 = 让主进程去猜语义。以前的语义是"空数组 = 全选"
  // （主进程那两句判据在 size === 0 时永不成立）—— 点「清空」再生成会把整份图跑一遍，
  // 勾了「覆盖已有 PSD」时直接覆盖用户没勾的文件。见 2026-09-30 审查 critical。
  if (selectedImageNames.value.length === 0) {
    toast.addToast({
      type: 'warning',
      message: '请至少选择一张图片（想整份出图就点「全选」）'
    })
    return
  }
  generating.value = true
  result.value = null
  try {
    const next = await window.comicType.generateLabelPlusPsd({
      apiVersion: LABELPLUS_IMPORT_API_VERSION,
      labelFilePath: selection.value.filePath,
      sourceDirectory: sourceDirectory.value,
      match: {
        mode: matchMode.value,
        forcedExtension: normalizeLabelPlusExtension(forcedExtension.value)
      },
      outputDirectory: outputDirectory.value,
      selectedImageNames: [...selectedImageNames.value],
      selectedGroups: [...selectedGroups.value],
      options: JSON.parse(JSON.stringify(options.value)) as LabelPlusGenerateOptions
    })
    result.value = next
    const summary = `已生成 ${next.generatedCount} 个 PSD，跳过 ${next.skippedCount} 个，失败 ${next.failedCount} 个`
    toast.addToast({ type: next.failedCount > 0 ? 'warning' : 'success', message: summary })
    if (next.failedCount === 0 && autoImportProject.value && sourceDirectory.value) {
      projectImportVisible.value = true
    }
  } catch (error) {
    toast.addToast({
      type: 'error',
      message: `PSD 生成失败：${error instanceof Error ? error.message : String(error)}`
    })
  } finally {
    generating.value = false
  }
}

watch(
  [sourceDirectory, outputDirectory, matchMode, forcedExtension, autoImportProject, options],
  () => void persistSettings(),
  { deep: true }
)

// ---- 「交给 Photoshop」那条路 -------------------------------------------------
//
// 这条路刻意与上面的本地出图**完全独立**：不动 generate()、不动 previewResult，
// 所以既有的导入功能一行都没改。两边吃的是同一份表单，只是终点不同。

/**
 * 请求体与本地出图**同形**（都满足 LabelPlusGenerateRequest），所以界面上不用维护两套表单。
 * 多出来的只有 actionSetName。
 */
function manifestRequest(): LabelPlusManifestJobRequest | null {
  if (!selection.value) return null
  return {
    apiVersion: LABELPLUS_IMPORT_API_VERSION,
    labelFilePath: selection.value.filePath,
    sourceDirectory: sourceDirectory.value,
    match: {
      mode: matchMode.value,
      forcedExtension: normalizeLabelPlusExtension(forcedExtension.value)
    },
    outputDirectory: outputDirectory.value,
    selectedImageNames: [...selectedImageNames.value],
    selectedGroups: [...selectedGroups.value],
    // 响应式对象发 IPC 前必须摊平成普通对象（§13.2 踩过：主进程只会回一句
    // "An object could not be cloned"，看不出是哪个字段）。
    options: JSON.parse(JSON.stringify(options.value)) as LabelPlusGenerateOptions,
    actionSetName: photoshopActionSet.value.trim(),
    groupActions: { ...photoshopGroupActions.value },
    groupDirections: explicitGroupDirections()
  }
}

/** 拦在发请求之前。分组为空也拦 —— 否则会生成一份"一张图都不带文字"的清单。 */
function photoshopBlockReason(): string {
  if (!selection.value) return '请先选择 LabelPlus 文本文件'
  if (!sourceDirectory.value) return '请选择图源目录'
  if (!outputDirectory.value) return '请选择输出目录'
  if (selectedGroups.value.length === 0) return '请至少选择一个文本分组'
  // 与「生成 PSD」同一条语义：0 张图片 = 什么都不做，而不是整份跑一遍。
  if (selectedImageNames.value.length === 0) return '请至少选择一张图片（想整份出图就点「全选」）'
  return ''
}

// ---- 分组映射表（动作名 / 文字方向）------------------------------------------

function groupIsSelected(group: string): boolean {
  return selectedGroups.value.includes(group)
}

function groupDirectionChoice(group: string): GroupDirectionChoice {
  return photoshopGroupDirections.value[group] ?? 'inherit'
}

function setGroupDirection(group: string, value: string | number): void {
  // 整体替换而不是就地改：ref 里装的是普通对象，换引用最不容易踩响应式的坑。
  photoshopGroupDirections.value = {
    ...photoshopGroupDirections.value,
    [group]: String(value) as GroupDirectionChoice
  }
}

/** 只把"明确改过"的方向交出去；'inherit' 不写进清单，交由 runner 回落到 defaults。 */
function explicitGroupDirections(): Record<string, 'horizontal' | 'vertical'> {
  const result: Record<string, 'horizontal' | 'vertical'> = {}
  for (const [group, choice] of Object.entries(photoshopGroupDirections.value)) {
    if (choice === 'inherit') continue
    result[group] = choice
  }
  return result
}

function stopReportPolling(): void {
  if (reportTimer !== null) {
    clearInterval(reportTimer)
    reportTimer = null
  }
}

/**
 * 回执是 PS 那边"每处理完一张图就整份重写"，所以只能轮询。
 * 换来的是**不需要新增任何进度事件通道** —— 少一条跨进程链路，就少一处会漂移的契约。
 */
function startReportPolling(reportPath: string): void {
  stopReportPolling()
  const tick = async (): Promise<void> => {
    try {
      const next = await window.comicType.readLabelPlusJobReport(reportPath)
      if (next) photoshopReport.value = next
      // finishedAt 有值 = 整批跑完了，停止轮询。
      if (next?.finishedAt) stopReportPolling()
    } catch {
      // 回执读失败不该打断界面；下一次 tick 再试。
    }
  }
  void tick()
  reportTimer = setInterval(() => void tick(), 1200)
}

function manifestFailureMessage(
  next: { message: string; issues: string[] }
): string {
  return next.issues.length > 0 ? `${next.message}：${next.issues[0]}` : next.message
}

async function exportManifest(): Promise<void> {
  const reason = photoshopBlockReason()
  if (reason) {
    toast.addToast({ type: 'warning', message: reason })
    return
  }
  const request = manifestRequest()
  if (!request) return
  photoshopBusy.value = true
  try {
    const next = await window.comicType.exportLabelPlusManifest(request)
    photoshopReport.value = null
    photoshopJob.value = next.ok ? { ...next, launched: false, launchMessage: '' } : null
    if (!next.ok) {
      toast.addToast({ type: 'error', message: manifestFailureMessage(next) })
      return
    }
    toast.addToast({ type: 'success', message: `${next.message}。清单已写到 ${next.manifestPath}` })
  } catch (error) {
    toast.addToast({
      type: 'error',
      message: `导出指令清单失败：${error instanceof Error ? error.message : String(error)}`
    })
  } finally {
    photoshopBusy.value = false
  }
}

async function runInPhotoshop(): Promise<void> {
  const reason = photoshopBlockReason()
  if (reason) {
    toast.addToast({ type: 'warning', message: reason })
    return
  }
  const photoshopPath = settings.photoshopPath.trim()
  if (!photoshopPath) {
    toast.addToast({
      type: 'warning',
      message: '尚未配置 Photoshop 程序，请先在「设置 → 外部工具」里指定其路径'
    })
    return
  }
  const request = manifestRequest()
  if (!request) return
  photoshopBusy.value = true
  photoshopJob.value = null
  photoshopReport.value = null
  stopReportPolling()
  try {
    const next = await window.comicType.runLabelPlusInPhotoshop(request, photoshopPath)
    photoshopJob.value = next
    if (!next.ok) {
      toast.addToast({ type: 'error', message: manifestFailureMessage(next) })
      return
    }
    if (!next.launched) {
      toast.addToast({ type: 'error', message: next.message })
      return
    }
    toast.addToast({ type: 'success', message: next.message })
    if (next.reportPath) startReportPolling(next.reportPath)
  } catch (error) {
    toast.addToast({
      type: 'error',
      message: `交给 Photoshop 失败：${error instanceof Error ? error.message : String(error)}`
    })
  } finally {
    photoshopBusy.value = false
  }
}

const photoshopProgress = computed(() => {
  const job = photoshopJob.value
  if (!job || !job.ok) return null
  const report = photoshopReport.value
  return {
    total: job.imageCount,
    done: report ? report.generated + report.failed + report.skipped : 0,
    finished: Boolean(report?.finishedAt),
    failed: report?.failed ?? 0,
    // 回执里两类警告都要露出来：批次级的（如尺寸对不上）和逐张级的（如动作不存在）。
    // 再加上工坊侧的提醒（如"涂白这条路还没实现"）—— 它不在回执里，PS 不知道这事。
    warnings: [
      // `?? []` 不是多余的：这个字段是新增的，而载荷来自 IPC ——
      // 缺了它会让整个 computed 抛错，面板直接渲染不出来（测试抓到过）。
      ...(job.warnings ?? []),
      ...(report?.warnings ?? []),
      ...(report?.images ?? []).flatMap((image) => image.warnings)
    ]
  }
})

onBeforeUnmount(stopReportPolling)

watch(
  [sourceDirectory, outputDirectory, matchMode, forcedExtension, options, selectedImageNames, selectedGroups],
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
  <div class="page-in min-h-full bg-app-bg p-6 text-text-primary" data-testid="import-page">
    <div class="mx-auto max-w-[1500px]">
      <header class="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-xl font-semibold tracking-tight">导入 LabelPlus</h1>
          <p class="mt-1 max-w-3xl text-sm leading-6 text-text-secondary">
            独立生成 RGB 8-bit PSD，保留可编辑文字层；坐标采用“归一化输入 → px 基线输出”，框内/框外均可导入。
          </p>
        </div>
        <button
          type="button"
          class="rounded-badge border border-border px-3 py-2 text-xs text-text-secondary transition-colors hover:border-accent hover:bg-card-bg-hover hover:text-text-primary"
          data-testid="import-reset-options"
          @click="resetOptions"
        >
          恢复导入设置
        </button>
      </header>

      <section
        class="rounded-badge border bg-card-bg p-5 transition-colors"
        :class="dropActive ? 'border-accent bg-primary-soft' : 'border-border'"
        data-testid="import-file-section"
        data-labelplus-dropzone
        @dragover="onInputDragOver"
        @dragleave="onInputDragLeave"
        @drop="onInputDrop"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold">1. 选择 LabelPlus 文本</h2>
            <p class="mt-1 text-xs text-text-secondary">支持 TXT/JSON、文件夹或 ZIP 拖入；ZIP 会解压到 EXE 同级 temp/包名后自动寻找文本和图片。</p>
          </div>
          <button
            type="button"
            class="rounded-badge bg-accent px-4 py-2 text-sm font-medium text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active disabled:opacity-40"
            :disabled="loadingFile"
            data-testid="import-file-button"
            @click="pickLabelFile"
          >
            {{ loadingFile ? '读取中…' : '选择 TXT / JSON / ZIP' }}
          </button>
        </div>

        <div v-if="selection" class="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div class="rounded-md border border-border bg-app-bg p-3">
            <p class="truncate text-sm font-medium" :title="selection.filePath">{{ selection.fileName }}<span v-if="selection.inputKind === 'zip'" class="ml-2 rounded-full bg-info px-1.5 py-0.5 text-[10px] font-semibold text-info-fg">ZIP</span><span v-else-if="selection.inputKind === 'directory'" class="ml-2 rounded-full bg-info px-1.5 py-0.5 text-[10px] font-semibold text-info-fg">文件夹</span></p>
            <p class="mt-1 truncate text-[11px] text-text-tertiary" :title="selection.filePath">{{ selection.filePath }}</p>
          </div>
          <div class="flex items-center gap-5 whitespace-nowrap rounded-md border border-border bg-app-bg px-4 py-3 text-sm font-medium text-text-secondary">
            <p><span class="text-lg font-bold text-text-primary">{{ selection.images.length }}</span> 张图片</p>
            <p><span class="text-lg font-bold text-text-primary">{{ selection.totalLabels }}</span> 条文字</p>
            <p><span class="text-lg font-bold text-text-primary">{{ selection.groups.length }}</span> 个分组</p>
          </div>
        </div>

        <div v-if="selection?.warnings.length" class="mt-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
          {{ selection.warnings.join('；') }}
        </div>
      </section>

      <div v-if="selection" class="mt-4 grid gap-4 xl:grid-cols-[minmax(360px,0.78fr)_minmax(0,1.22fr)]">
        <div class="space-y-4">
          <section class="rounded-lg border border-border bg-card-bg p-5 shadow-[var(--shadow-1)]" data-testid="import-path-section">
            <h2 class="text-sm font-semibold">2. 图源与输出</h2>
            <div class="mt-4 space-y-3">
              <label class="block text-xs text-text-secondary">
                <span class="mb-1.5 block font-medium text-text-primary">图源目录</span>
                <div class="flex gap-2">
                  <input v-model="sourceDirectory" class="min-w-0 flex-1 rounded-badge border border-border bg-app-bg px-2.5 py-2 text-xs outline-none focus:border-accent" data-testid="import-source-directory" placeholder="包含 PNG/JPG/PSD 的目录" />
                  <button type="button" class="shrink-0 rounded-badge border border-border px-2.5 text-xs text-text-secondary hover:border-accent hover:text-text-primary" data-testid="import-source-picker" @click="pickSourceDirectory">选择</button>
                </div>
              </label>
              <label class="block text-xs text-text-secondary">
                <span class="mb-1.5 block font-medium text-text-primary">PSD 输出目录</span>
                <div class="flex gap-2">
                  <input v-model="outputDirectory" class="min-w-0 flex-1 rounded-badge border border-border bg-app-bg px-2.5 py-2 text-xs outline-none focus:border-accent" data-testid="import-output-directory" placeholder="默认为文本文件旁的 output" />
                  <button type="button" class="shrink-0 rounded-badge border border-border px-2.5 text-xs text-text-secondary hover:border-accent hover:text-text-primary" data-testid="import-output-picker" @click="pickOutputDirectory">选择</button>
                </div>
              </label>
              <div class="grid gap-3 sm:grid-cols-2">
                <label class="block text-xs text-text-secondary">
                  <span class="mb-1.5 block font-medium text-text-primary">图源匹配方式</span>
                  <AppSelect v-model="matchMode" :options="matchModeOptions" test-id="import-match-mode" size="small" />
                </label>
                <label class="block text-xs text-text-secondary">
                  <span class="mb-1.5 block font-medium text-text-primary">强制图源后缀</span>
                  <AppSelect v-model="forcedExtension" :options="extensionOptions" test-id="import-extension" size="small" />
                </label>
              </div>
              <p class="text-[11px] leading-5 text-text-tertiary">按文件名匹配时会先尝试完整文件名，再按文件名主体和常见后缀优先级匹配；按顺序匹配时会使用自然排序。</p>
            </div>
          </section>

          <section class="rounded-lg border border-border bg-card-bg p-5 shadow-[var(--shadow-1)]" data-testid="import-groups-section">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="text-sm font-semibold">3. 文本分组</h2>
                <p class="mt-1 text-xs text-text-secondary">{{ selectedGroupLabel }}；PSD 中会按组建立图层组。</p>
              </div>
              <div class="flex gap-1">
                <button type="button" class="rounded-badge px-2 py-1 text-[11px] text-text-secondary hover:bg-card-bg-hover" data-testid="import-groups-all" @click="setGroupPreset('all')">全选</button>
                <button v-if="insideGroups.length" type="button" class="rounded-badge px-2 py-1 text-[11px] text-text-secondary hover:bg-card-bg-hover" data-testid="import-groups-inside" @click="setGroupPreset('inside')">只选框内</button>
                <button v-if="outsideGroups.length" type="button" class="rounded-badge px-2 py-1 text-[11px] text-text-secondary hover:bg-card-bg-hover" data-testid="import-groups-outside" @click="setGroupPreset('outside')">只选框外</button>
              </div>
            </div>
            <div class="mt-4 grid gap-2 sm:grid-cols-2">
              <label v-for="group in groupNames" :key="group" class="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-xs transition-colors hover:bg-card-bg-hover" :class="selectedGroups.includes(group) ? 'border-selected-border bg-selected-bg' : ''">
                <input type="checkbox" class="h-3.5 w-3.5 accent-accent" :checked="selectedGroups.includes(group)" :data-testid="`import-group-${group}`" @change="toggleGroup(group)" />
                <span class="min-w-0 flex-1 truncate" :title="group">{{ group }}</span>
                <span v-if="isInsideGroup(group)" class="rounded-full bg-info px-1.5 py-0.5 text-[10px] font-semibold text-info-fg">框内</span>
                <span v-else-if="isOutsideGroup(group)" class="rounded-full bg-warning px-1.5 py-0.5 text-[10px] font-semibold text-warning-fg">框外</span>
              </label>
            </div>
          </section>

          <section class="rounded-lg border border-border bg-card-bg p-5 shadow-[var(--shadow-1)]" data-testid="import-style-section">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="text-sm font-semibold">4. 标准文字样式</h2>
                <p class="mt-1 text-xs text-text-secondary">字体写入标识会在后台自动映射；位置为 px + baseline，字号为 px（与 Photoshop 里一致，不再按分辨率折算）。</p>
              </div>
              <span class="rounded-full bg-info px-2 py-1 text-[10px] font-semibold text-info-fg">API v{{ LABELPLUS_IMPORT_API_VERSION }}</span>
            </div>

            <div class="mt-4 space-y-3">
              <div class="grid gap-3 sm:grid-cols-2">
                <label class="block text-xs text-text-secondary">
                  <span class="mb-1.5 block font-medium text-text-primary">字体</span>
                  <AppSelect v-model="selectedFontId" :options="fontOptions" test-id="import-font" size="small" searchable search-placeholder="输入字体或样式名" @change="selectFontFamily" />
                </label>
                <label class="block text-xs text-text-secondary">
                  <span class="mb-1.5 block font-medium text-text-primary">样式</span>
                  <AppSelect v-model="selectedFontId" :options="styleOptions" test-id="import-font-style" size="small" searchable search-placeholder="输入样式名" @change="selectFont" />
                </label>
              </div>
              <div class="grid gap-3 sm:grid-cols-3">
                <label class="block text-xs text-text-secondary"><span class="mb-1.5 block font-medium text-text-primary">字号（px）</span><input v-model.number="options.textStyle.fontSizePx" type="number" min="1" max="720" step="0.5" class="w-full rounded-badge border border-border bg-app-bg px-2.5 py-2 text-xs outline-none focus:border-accent" data-testid="import-font-size" /></label>
                <label class="block text-xs text-text-secondary"><span class="mb-1.5 block font-medium text-text-primary">行距（%）</span><input v-model.number="options.textStyle.leadingPercent" type="number" min="50" max="500" step="1" class="w-full rounded-badge border border-border bg-app-bg px-2.5 py-2 text-xs outline-none focus:border-accent" data-testid="import-leading" /></label>
                <label class="block text-xs text-text-secondary"><span class="mb-1.5 block font-medium text-text-primary">文字方向</span><AppSelect v-model="options.textStyle.direction" :options="directionOptions" test-id="import-direction" size="small" /></label>
              </div>
              <div class="grid gap-3 sm:grid-cols-3">
                <label class="block text-xs text-text-secondary"><span class="mb-1.5 block font-medium text-text-primary">对齐</span><AppSelect v-model="options.textStyle.alignment" :options="alignmentOptions" test-id="import-alignment" size="small" /></label>
                <label class="flex cursor-pointer items-center gap-2 px-1 py-2 text-xs text-text-primary"><input v-model="options.textStyle.fauxBold" type="checkbox" class="accent-accent" data-testid="import-bold" />粗体</label>
                <label class="flex cursor-pointer items-center gap-2 px-1 py-2 text-xs text-text-primary"><input v-model="options.textStyle.fauxItalic" type="checkbox" class="accent-accent" data-testid="import-italic" />斜体</label>
                <!-- 用 PS 面板的原词「自由连字」。默认是开的（PS 与 ag-psd 都是），
                     所以这个勾的存在意义是"能关掉"，不是"能打开"。 -->
                <label class="flex cursor-pointer items-center gap-2 px-1 py-2 text-xs text-text-primary" title="对应 Photoshop 字符面板的「自由连字」。Photoshop 新建文字层时默认就是开的。"><input v-model="options.textStyle.ligatures" type="checkbox" class="accent-accent" data-testid="import-ligatures" />自由连字</label>
                <label class="flex cursor-pointer items-center gap-2 px-1 py-2 text-xs text-text-primary" title="对应 Photoshop 字符面板菜单里的「标准垂直罗马对齐方式」。只对竖排有效：决定竖排里的拉丁字母和数字是竖着站（开）还是转 90°（关）。⚠️ 目前只有本地「生成 PSD」支持它 —— 「交给 Photoshop」那条路设不了（PS 的脚本 DOM 没暴露这个属性），跑的时候会明确警告。"><input v-model="options.textStyle.standardVerticalRoman" type="checkbox" class="accent-accent" data-testid="import-vertical-roman" />标准垂直罗马对齐</label>
              </div>
              <div class="grid gap-3 sm:grid-cols-3">
                <label class="block text-xs text-text-secondary"><span class="mb-1.5 block font-medium text-text-primary">填充颜色</span><div class="flex gap-2"><input v-model="options.textStyle.fillColor" type="text" class="min-w-0 flex-1 rounded-badge border border-border bg-app-bg px-2.5 py-2 text-xs outline-none focus:border-accent" data-testid="import-fill-color" /><input v-model="options.textStyle.fillColor" type="color" class="h-8 w-9 rounded-badge border border-border bg-app-bg p-0.5" aria-label="填充颜色选择器" /></div></label>
                <label class="block text-xs text-text-secondary"><span class="mb-1.5 block font-medium text-text-primary">描边颜色</span><div class="flex gap-2"><input v-model="options.textStyle.strokeColor" type="text" class="min-w-0 flex-1 rounded-badge border border-border bg-app-bg px-2.5 py-2 text-xs outline-none focus:border-accent" data-testid="import-stroke-color" /><input v-model="options.textStyle.strokeColor" type="color" class="h-8 w-9 rounded-badge border border-border bg-app-bg p-0.5" aria-label="描边颜色选择器" /></div></label>
                <label class="block text-xs text-text-secondary"><span class="mb-1.5 block font-medium text-text-primary">描边宽度（px）</span><input v-model.number="options.textStyle.strokeWidthPx" type="number" min="0" max="100" step="0.5" class="w-full rounded-badge border border-border bg-app-bg px-2.5 py-2 text-xs outline-none focus:border-accent" data-testid="import-stroke-width" /></label>
              </div>
            </div>
          </section>

          <section class="rounded-lg border border-border bg-card-bg p-5 shadow-[var(--shadow-1)]" data-testid="import-advanced-section">
            <h2 class="text-sm font-semibold">5. 位置、编号与选项</h2>
            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <p class="mb-1.5 text-xs font-medium text-text-primary">文字位置偏移（px）</p>
                <div class="grid grid-cols-2 gap-2"><label class="text-[11px] text-text-secondary">X<input v-model.number="options.positionOffset.x" type="number" class="mt-1 w-full rounded-badge border border-border bg-app-bg px-2 py-2 text-xs outline-none focus:border-accent" data-testid="import-offset-x" /></label><label class="text-[11px] text-text-secondary">Y<input v-model.number="options.positionOffset.y" type="number" class="mt-1 w-full rounded-badge border border-border bg-app-bg px-2 py-2 text-xs outline-none focus:border-accent" data-testid="import-offset-y" /></label></div>
              </div>
              <div>
                <p class="mb-1.5 text-xs font-medium text-text-primary">编号位置偏移（px）</p>
                <div class="grid grid-cols-2 gap-2"><label class="text-[11px] text-text-secondary">X<input v-model.number="options.labelIndexOffset.x" type="number" class="mt-1 w-full rounded-badge border border-border bg-app-bg px-2 py-2 text-xs outline-none focus:border-accent" data-testid="import-index-offset-x" /></label><label class="text-[11px] text-text-secondary">Y<input v-model.number="options.labelIndexOffset.y" type="number" class="mt-1 w-full rounded-badge border border-border bg-app-bg px-2 py-2 text-xs outline-none focus:border-accent" data-testid="import-index-offset-y" /></label></div>
              </div>
            </div>
            <div class="mt-3 grid gap-2 sm:grid-cols-2">
              <label class="flex cursor-pointer items-center gap-2 text-xs text-text-primary"><input v-model="options.createLayerGroups" type="checkbox" class="accent-accent" data-testid="import-create-groups" />按分组创建 PSD 图层组</label>
              <label class="flex cursor-pointer items-center gap-2 text-xs text-text-primary"><input v-model="options.outputLabelIndex" type="checkbox" class="accent-accent" data-testid="import-output-index" />额外生成 Label 编号层</label>
              <label class="flex cursor-pointer items-center gap-2 text-xs text-text-primary"><input v-model="options.ignoreImagesWithoutLabels" type="checkbox" class="accent-accent" data-testid="import-ignore-empty" />忽略没有标签的图片</label>
              <label class="flex cursor-pointer items-center gap-2 text-xs text-text-primary"><input v-model="options.overwriteExisting" type="checkbox" class="accent-accent" data-testid="import-overwrite" />覆盖已有 PSD</label>
            </div>
            <label class="mt-3 block text-xs text-text-secondary"><span class="mb-1.5 block font-medium text-text-primary">文本替换规则</span><input v-model="options.textReplacementExpression" type="text" class="w-full rounded-badge border border-border bg-app-bg px-2.5 py-2 text-xs outline-none focus:border-accent" placeholder="例如：！？->!?|……->..." data-testid="import-replacement" /><span class="mt-1 block text-[10px] text-text-tertiary">多个规则用 | 分隔，格式为 from-&gt;to。</span></label>
            <div class="mt-3 grid gap-3 sm:grid-cols-3">
              <label class="block text-xs text-text-secondary"><span class="mb-1.5 block font-medium text-text-primary">分辨率（PPI）</span><input v-model.number="options.resolutionPpi" type="number" min="30" max="1200" class="w-full rounded-badge border border-border bg-app-bg px-2.5 py-2 text-xs outline-none focus:border-accent" data-testid="import-resolution" /></label>
              <div class="sm:col-span-2 rounded-md border border-border bg-app-bg p-3 text-[11px] leading-5 text-text-tertiary">竖排预览会按竖排绘制；当前 ag-psd 对 Photoshop 竖排 EngineData 支持不完整，因此生成 PSD 的原生文字层安全使用横排描述符，避免打开时被栅格化。</div>
            </div>
            <p class="mt-3 rounded-md border border-info/30 bg-info-soft px-3 py-2 text-[11px] leading-5 text-info">独立模式不执行 Photoshop Action，也不读取 Photoshop 专用模板；图源本身会作为背景层写入，文本样式和分组通过标准 API 生成。</p>
          </section>

          <section class="rounded-lg border border-border bg-card-bg p-5 shadow-[var(--shadow-1)]" data-testid="import-overlay-section">
            <div class="flex items-center justify-between gap-3">
              <div><h2 class="text-sm font-semibold">实验：按标签点覆盖对白框</h2><p class="mt-1 text-xs text-text-secondary">仅覆盖选定分组，生成独立 dialog-overlay 位图层。</p></div>
              <input v-model="options.dialogOverlay.enabled" type="checkbox" class="h-4 w-4 accent-accent" data-testid="import-overlay-enabled" />
            </div>
            <div v-if="options.dialogOverlay.enabled" class="mt-4 space-y-3">
              <div class="grid gap-3 sm:grid-cols-3"><label class="text-xs text-text-secondary">横向半径<input v-model.number="options.dialogOverlay.radiusXPx" type="number" min="1" class="mt-1 w-full rounded-badge border border-border bg-app-bg px-2 py-2 text-xs outline-none focus:border-accent" /></label><label class="text-xs text-text-secondary">纵向半径<input v-model.number="options.dialogOverlay.radiusYPx" type="number" min="1" class="mt-1 w-full rounded-badge border border-border bg-app-bg px-2 py-2 text-xs outline-none focus:border-accent" /></label><label class="text-xs text-text-secondary">颜色<AppSelect v-model="options.dialogOverlay.colorMode" :options="overlayColorOptions" test-id="import-overlay-color" size="small" /></label></div>
              <label v-if="options.dialogOverlay.colorMode === 'custom'" class="block text-xs text-text-secondary">自定义颜色<input v-model="options.dialogOverlay.customColor" type="text" class="mt-1 w-full rounded-badge border border-border bg-app-bg px-2 py-2 text-xs outline-none focus:border-accent" /></label>
              <div><p class="mb-2 text-xs font-medium text-text-primary">覆盖分组（不选表示全部已选分组）</p><div class="flex flex-wrap gap-2"><label v-for="group in groupNames" :key="`overlay-${group}`" class="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-[11px] text-text-secondary"><input type="checkbox" class="accent-accent" :checked="options.dialogOverlay.groups.includes(group)" @change="toggleOverlayGroup(group)" />{{ group }}</label></div></div>
            </div>
          </section>
        </div>

        <div class="min-w-0 space-y-4">
          <section class="rounded-lg border border-border bg-card-bg p-5 shadow-[var(--shadow-1)]" data-testid="import-preview-section">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div><h2 class="text-sm font-semibold">图源匹配预览</h2><p class="mt-1 text-xs text-text-secondary">{{ loadingPreview ? '匹配中…' : preview ? `已匹配 ${preview.matchedCount}/${preview.rows.length}` : '选择图源目录后开始匹配' }}</p></div>
              <div class="flex flex-wrap gap-1.5"><button type="button" class="rounded-badge border border-border px-2.5 py-1.5 text-[11px] text-text-secondary hover:bg-card-bg-hover" data-testid="import-refresh-preview" @click="refreshPreview">刷新匹配</button><button type="button" class="rounded-badge border border-accent bg-primary-soft px-2.5 py-1.5 text-[11px] font-semibold text-accent transition-colors hover:bg-primary-soft-hover disabled:cursor-not-allowed disabled:opacity-40" :disabled="previewGenerating || generating || !preview" data-testid="import-generate-preview-button" @click="generatePreview">{{ previewGenerating ? '生成预览中…' : '预览' }}</button><button type="button" class="rounded-badge border border-border px-2.5 py-1.5 text-[11px] text-text-secondary hover:bg-card-bg-hover" @click="selectAllImages">全选</button><button type="button" class="rounded-badge border border-border px-2.5 py-1.5 text-[11px] text-text-secondary hover:bg-card-bg-hover" @click="selectMatchedImages">仅已匹配</button><button type="button" class="rounded-badge border border-border px-2.5 py-1.5 text-[11px] text-text-secondary hover:bg-card-bg-hover" @click="clearImages">清空</button></div>
            </div>
            <div v-if="preview" class="mt-4 space-y-3">
              <div class="flex flex-wrap items-center gap-2"><input v-model="imageFilter" type="search" class="min-w-52 flex-1 rounded-badge border border-border bg-app-bg px-2.5 py-2 text-xs outline-none focus:border-accent" placeholder="筛选文本图片名" data-testid="import-image-filter" /><span class="text-[11px] text-text-tertiary">已选 {{ selectedRowCount }} 张，匹配 {{ matchedSelectedCount }} 张</span></div>
              <div class="max-h-[520px] overflow-auto rounded-md border border-border">
                <table class="w-full border-collapse text-left text-xs">
                  <thead class="sticky top-0 bg-sunken text-[11px] text-text-secondary">
                    <tr><th class="w-9 px-3 py-2"></th><th class="px-3 py-2">LabelPlus 图片</th><th class="px-3 py-2">标签</th><th class="px-3 py-2">图源</th><th class="px-3 py-2">状态 / 输出</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in filteredRows" :key="row.labelImageName" class="border-t border-border hover:bg-card-bg-hover">
                      <td class="px-3 py-2"><input type="checkbox" class="accent-accent" :checked="selectedImageNames.includes(row.labelImageName)" :data-testid="`import-image-${row.labelImageName}`" @change="toggleImage(row.labelImageName)" /></td>
                      <td class="max-w-52 truncate px-3 py-2 font-bold" :title="row.labelImageName">
                        <button v-if="row.matched" type="button" class="max-w-full truncate underline decoration-dashed underline-offset-2 hover:text-accent" :data-testid="`import-source-preview-${row.labelImageName}`" @click="openLabelPlusPreview('source', row.labelImageName)">{{ row.labelImageName }}</button>
                        <span v-else>{{ row.labelImageName }}</span>
                      </td>
                      <td class="px-3 py-2 text-text-secondary">{{ row.labelCount }}</td>
                      <td class="max-w-64 truncate px-3 py-2 font-bold" :title="row.sourceFileName || ''">
                        <button v-if="row.matched" type="button" class="max-w-full truncate underline decoration-dashed underline-offset-2 hover:text-accent" :data-testid="`import-source-name-${row.labelImageName}`" @click="openLabelPlusPreview('source', row.labelImageName)">{{ row.sourceFileName }}</button>
                        <span v-else>—</span>
                      </td>
                      <td class="px-3 py-2" :class="row.matched ? 'text-success' : 'text-warning'">
                        <button v-if="row.matched" type="button" class="font-bold underline decoration-dashed underline-offset-2 transition-colors hover:text-primary-hover" :data-testid="`import-output-preview-${row.labelImageName}`" @click="openLabelPlusPreview('output', row.labelImageName)">{{ outputPreviewName(row) }}</button>
                        <span v-else>{{ imageSummary(row) }}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-if="preview.warnings.length" class="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">{{ preview.warnings.join('；') }}</div>
            </div>
            <div v-else class="mt-5 rounded-md border border-dashed border-border bg-app-bg px-4 py-10 text-center text-sm text-text-tertiary">尚未生成匹配预览</div>
          </section>

          <section class="rounded-lg border border-border bg-card-bg p-5 shadow-[var(--shadow-1)]" data-testid="import-result-section">
            <div class="flex flex-wrap items-center justify-between gap-3"><div><h2 class="text-sm font-semibold">生成</h2><p class="mt-1 text-xs text-text-secondary">将选中的图片和分组写入独立 PSD，保留背景与原生文字层。</p></div><div class="flex items-center gap-3"><label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-text-primary"><input v-model="autoImportProject" type="checkbox" class="accent-accent" data-testid="import-auto-project" />生成后导入项目</label><button type="button" class="rounded-badge bg-accent px-5 py-2.5 text-sm font-semibold text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:opacity-40" :disabled="generating || !preview" data-testid="import-generate-button" @click="generate">{{ generating ? '生成中…' : '生成 PSD' }}</button></div></div>
            <div v-if="result" class="mt-4 grid gap-2 sm:grid-cols-3"><div class="rounded-md bg-success p-3 text-xs font-semibold text-success-fg">成功<strong class="ml-2 text-base">{{ result.generatedCount }}</strong></div><div class="rounded-md bg-warning p-3 text-xs font-semibold text-warning-fg">跳过<strong class="ml-2 text-base">{{ result.skippedCount }}</strong></div><div class="rounded-md bg-danger p-3 text-xs font-semibold text-danger-fg">失败<strong class="ml-2 text-base">{{ result.failedCount }}</strong></div></div>
            <div v-if="result" class="mt-3 max-h-72 overflow-auto rounded-md border border-border"><div v-for="file in result.files" :key="`${file.labelImageName}-${file.outputPath || file.status}`" class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs last:border-0"><button v-if="canPreviewImage(file.labelImageName)" type="button" class="min-w-0 flex-1 truncate text-left font-bold underline decoration-dashed underline-offset-2 hover:text-accent" :title="file.outputPath || resultFileName(file)" @click="openLabelPlusPreview('output', file.labelImageName)">{{ resultFileName(file) }}</button><span v-else class="min-w-0 flex-1 truncate font-bold" :title="file.outputPath || resultFileName(file)">{{ resultFileName(file) }}</span><span :class="resultClass(file.status)">{{ file.message }}<span v-if="file.textLayerCount" class="ml-1 text-text-tertiary">({{ file.textLayerCount }} 层)</span></span></div></div>
            <div v-if="result?.warnings.length" class="mt-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">{{ result.warnings.join('；') }}</div>
          </section>

          <section class="rounded-lg border border-border bg-card-bg p-5 shadow-[var(--shadow-1)]" data-testid="import-photoshop-section">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="text-sm font-semibold">6. 交给 Photoshop 生成（可选）</h2>
                <p class="mt-1 text-xs text-text-secondary">工坊只负责编排：把分组、坐标、文字和动作写成一份「指令清单」交给 PS；真竖排文字层、按分组执行动作、存 PSD 全部由 PS 自己完成。</p>
              </div>
              <span class="shrink-0 rounded-full bg-primary-soft px-2 py-1 text-[10px] font-semibold text-accent">活字</span>
            </div>

            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <label class="block text-xs text-text-secondary"><span class="mb-1.5 block font-medium text-text-primary">动作组名</span><input v-model="photoshopActionSet" type="text" class="w-full rounded-badge border border-border bg-app-bg px-2.5 py-2 text-xs outline-none focus:border-accent" placeholder="例如 LabelPlusAction" data-testid="import-action-set" /></label>
              <div class="rounded-md border border-border bg-app-bg p-3 text-[11px] leading-5 text-text-tertiary">填 <strong class="text-text-primary">Photoshop 动作面板里那一组的名字</strong>。它会在三个时机执行组里的同名动作：<strong class="text-text-primary">每条文字</strong>建完跑一次「与分组同名」的；<strong class="text-text-primary">每张图</strong>打开时跑一次 <code class="text-text-primary">_start</code>、存盘前跑一次 <code class="text-text-primary">_end</code>（后两个是可选钩子，组里没有就安静跳过）。留空则只出图、不跑动作。</div>
            </div>

            <div class="mt-3 overflow-hidden rounded-md border border-border" data-testid="import-group-mapping">
              <table class="w-full text-left text-[11px]">
                <thead class="bg-sunken text-text-tertiary">
                  <tr>
                    <th class="px-3 py-2 font-medium">分组</th>
                    <th class="px-3 py-2 font-medium">动作名（留空 = 用分组名）</th>
                    <th class="px-3 py-2 font-medium">文字方向</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="group in groupNames" :key="group" class="border-t border-border">
                    <td class="px-3 py-2 whitespace-nowrap">
                      <span :class="groupIsSelected(group) ? 'text-text-primary' : 'text-text-tertiary'">{{ group }}</span>
                      <span v-if="!groupIsSelected(group)" class="ml-1 text-warning">未勾选</span>
                    </td>
                    <td class="px-3 py-2">
                      <input v-model="photoshopGroupActions[group]" type="text" class="w-full rounded-badge border border-border bg-app-bg px-2 py-1.5 text-[11px] outline-none focus:border-accent" :placeholder="group" :data-testid="`import-group-action-${group}`" />
                    </td>
                    <td class="px-3 py-2">
                      <AppSelect :model-value="groupDirectionChoice(group)" :options="groupDirectionOptions" :test-id="`import-group-direction-${group}`" size="small" @update:model-value="(value) => setGroupDirection(group, value)" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="mt-2 text-[11px] leading-5 text-text-tertiary">动作名留空时用<strong class="text-text-primary">分组名本身</strong>当动作名（LabelPlus 官方脚本的规矩，所以现有的 <code class="text-text-primary">LabelPlusAction</code> 不用改一个字）。方向改过的分组会写进指令清单；<strong class="text-text-primary">「生成 PSD」不认这张表</strong> —— 那条路只认上面全场的文字方向，而且文字层永远是横排。</p>

            <div class="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" class="rounded-badge border border-border px-3 py-2 text-xs text-text-secondary hover:bg-card-bg-hover disabled:cursor-not-allowed disabled:opacity-40" :disabled="photoshopBusy" data-testid="import-export-manifest" @click="exportManifest">{{ photoshopBusy ? '处理中…' : '导出指令清单 (.json)' }}</button>
              <button type="button" class="rounded-badge bg-accent px-5 py-2.5 text-sm font-semibold text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:opacity-40" :disabled="photoshopBusy" data-testid="import-run-photoshop" @click="runInPhotoshop">{{ photoshopBusy ? '处理中…' : '交给 Photoshop 生成' }}</button>
            </div>

            <p class="mt-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] leading-5 text-warning">这条路目前<strong>不支持描边、阴影、涂白</strong>（上面的本地「生成 PSD」支持）。需要这三样时请走本地生成。</p>

            <div v-if="photoshopJob && photoshopJob.ok" class="mt-3 rounded-md border border-border bg-app-bg p-3 text-[11px] leading-5" data-testid="import-photoshop-status">
              <p class="text-text-secondary">指令清单：<span class="text-text-primary">{{ photoshopJob.imageCount }} 张图 / {{ photoshopJob.labelCount }} 条文字</span><span v-if="photoshopJob.skippedImages.length" class="ml-2 text-warning">跳过 {{ photoshopJob.skippedImages.length }} 张</span></p>
              <p v-if="photoshopProgress" class="mt-1" :class="photoshopProgress.finished ? 'text-success' : 'text-text-secondary'">
                <template v-if="photoshopProgress.finished">Photoshop 已完成 {{ photoshopProgress.done }}/{{ photoshopProgress.total }}<span v-if="photoshopProgress.failed">，失败 {{ photoshopProgress.failed }}</span></template>
                <template v-else-if="photoshopProgress.done > 0">Photoshop 进行中 {{ photoshopProgress.done }}/{{ photoshopProgress.total }}</template>
                <template v-else>已把清单交给 Photoshop，等它开始干活…</template>
              </p>
              <ul v-if="photoshopProgress && photoshopProgress.warnings.length" class="mt-2 list-disc space-y-1 pl-4 text-warning">
                <li v-for="(warning, index) in photoshopProgress.warnings.slice(0, 6)" :key="index">{{ warning }}</li>
              </ul>
              <p class="mt-2 break-all text-text-tertiary">清单：{{ photoshopJob.manifestPath }}</p>
            </div>
          </section>
        </div>
      </div>

      <section
        v-else
        class="mt-4 rounded-badge border border-dashed bg-card-bg px-6 py-12 text-center transition-colors"
        :class="dropActive ? 'border-accent bg-primary-soft' : 'border-border'"
        data-testid="import-empty-state"
        data-labelplus-dropzone
        @dragover="onInputDragOver"
        @dragleave="onInputDragLeave"
        @drop="onInputDrop"
      >
        <div class="mx-auto max-w-md"><div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-accent"><svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></svg></div><h2 class="mt-4 text-lg font-semibold">从 LabelPlus 文本开始</h2><p class="mt-2 text-sm leading-6 text-text-secondary">可选择 TXT / JSON，也可以把包含图片和文本的文件夹或 ZIP 直接拖到这里。ZIP 会解压到 EXE 同级 temp/包名，输出目录默认是 output。</p></div>
      </section>
    </div>
    <ProjectFormModal
      v-if="projectImportVisible"
      mode="add"
      :initial-data="{ parentTitle: '', chapterNumber: '', projectTitle: '', folderPath: sourceDirectory }"
      :existing-parent-titles="workspace.parents.map((parent) => parent.title)"
      @save="onProjectImportSave"
      @cancel="projectImportVisible = false"
      @delete="projectImportVisible = false"
    />
  </div>
</template>
