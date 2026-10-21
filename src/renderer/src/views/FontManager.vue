<script setup lang="ts">
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { confirmAction } from '@renderer/services/confirm'

import { Button as UiButton } from '@renderer/components/ui/button'
import UiInput from '@renderer/components/ui/ControlInput.vue'
import { useFontVirtualList } from '@renderer/features/fonts/useFontVirtualList'
import { useFontSelection } from '@renderer/features/fonts/useFontSelection'
import InfoHint from '../components/InfoHint.vue'
import { FONT_IDENTIFY_SITE } from '@shared/external-url'
import { fontCatalog } from '../fonts/catalog'
import { FontPreviewLoader } from '../fonts/preview-loader'
import GlyphSample from '../features/fonts/GlyphSample.vue'
import { fontFaceCss } from '@shared/font-style'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { FontLanguage, FontSource, SystemFontInfo } from '@shared/ipc-api'
import { useToastStore } from '../stores/toast'
import AppSelect, { type AppSelectOption } from '../components/AppSelect.vue'

type SourceFilter = 'all' | FontSource
type LanguageFilter = 'all' | FontLanguage
type CardSize = 'large' | 'medium' | 'small'
type ManagementMode = 'system' | 'folder'
type PreviewWeight = 'auto' | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900

interface FontCardOptions {
  previewText: string
  previewSize: number
  previewWeight: PreviewWeight
  forceBold: boolean
  forceItalic: boolean
  verticalPreview: boolean
  cardSize: CardSize
}

const DEFAULT_PREVIEW = '嵌字工坊 字体预览 123 ABC'
const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000
const FONT_CARD_OPTIONS_STORAGE_KEY = 'ui.fontManagerCardOptions'
const toast = useToastStore()

const managementMode = ref<ManagementMode | null>(null)
const folderPath = ref('')
const fonts = ref<SystemFontInfo[]>([])
watch(fontCatalog().fonts, (value) => {
  if (managementMode.value === 'system' && !loading.value) {
    clearFolderPreviewFonts()
    fonts.value = value
  }
})
const supported = ref(true)
const loading = ref(false)
const installing = ref(false)
const activeUninstallId = ref('')
const batchUninstalling = ref(false)
const query = ref('')
const previewText = ref(DEFAULT_PREVIEW)
const previewSize = ref(34)
const previewWeight = ref<PreviewWeight>('auto')
const forceBold = ref(false)
const forceItalic = ref(false)
const verticalPreview = ref(false)
const cardSize = ref<CardSize>('large')
const sourceFilter = ref<SourceFilter>('all')
const languageFilter = ref<LanguageFilter>('all')
const {
  selectionMode,
  selectedFontIds,
  comparingSelected,
  isSelected,
  toggleSelection,
  enterSelectionMode,
  exitSelectionMode,
  clearSelection,
  selectAllFiltered,
  compareSelectedFonts
} = useFontSelection(
  computed(() => filteredFonts.value),
  isRemovable,
  resetVisibleLimit
)
const refreshQueued = ref(false)
const refreshQueuedNotify = ref(false)
const cardOptionsLoaded = ref(false)
let refreshTimer: number | undefined
let requestGeneration = 0
let disposed = false
const previewStatus = ref<Record<string, string>>({})
const previews = new FontPreviewLoader((id, status) => {
  previewStatus.value[id] = status
})

const { listElement, scrollTop, columns, rowHeight, startRow, virtualEnd, virtualFonts } =
  useFontVirtualList(
    cardSize,
    computed(() => visibleFonts.value)
  )
const languageFilteredFonts = computed(() => {
  const language = languageFilter.value
  return language === 'all'
    ? fonts.value
    : fonts.value.filter((font) => font.languages.includes(language))
})

const sourceCounts = computed(() => {
  const counts: Record<FontSource, number> = { system: 0, user: 0, managed: 0, folder: 0 }
  for (const font of languageFilteredFonts.value) counts[font.source] += 1
  return counts
})

const languageCounts = computed(() => {
  const counts: Record<FontLanguage, number> = {
    chinese: 0,
    japanese: 0,
    korean: 0,
    latin: 0,
    symbol: 0,
    other: 0
  }
  for (const font of fonts.value) {
    for (const language of font.languages) counts[language] += 1
  }
  return counts
})

const languageOptions = computed<AppSelectOption[]>(() => [
  { value: 'all', label: '全部字体' },
  { value: 'chinese', label: `中文字体 (${languageCounts.value.chinese})` },
  { value: 'japanese', label: `日文字体 (${languageCounts.value.japanese})` },
  { value: 'korean', label: `韩文字体 (${languageCounts.value.korean})` },
  { value: 'latin', label: `西文字体 (${languageCounts.value.latin})` },
  { value: 'symbol', label: `符号字体 (${languageCounts.value.symbol})` },
  { value: 'other', label: `其他字体 (${languageCounts.value.other})` }
])

const previewWeightOptions: AppSelectOption[] = [
  { value: 'auto', label: '字体默认' },
  ...[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => ({
    value: weight,
    label: String(weight)
  }))
]

const filteredFonts = computed(() => {
  if (selectionMode.value && comparingSelected.value) {
    const selected = new Set(selectedFontIds.value)
    return fonts.value.filter((font) => selected.has(font.id))
  }
  const needle = query.value.trim().toLocaleLowerCase()
  return languageFilteredFonts.value.filter((font) => {
    if (sourceFilter.value !== 'all' && font.source !== sourceFilter.value) return false
    if (!needle) return true
    return [font.family, font.style, font.displayName, font.fileName]
      .join(' ')
      .toLocaleLowerCase()
      .includes(needle)
  })
})

const visibleFonts = computed(() => filteredFonts.value)

const selectedFonts = computed(() => {
  const selected = new Set(selectedFontIds.value)
  return fonts.value.filter((font) => selected.has(font.id))
})

const selectedRemovableFonts = computed(() => selectedFonts.value.filter(isRemovable))

watch([query, sourceFilter, languageFilter, cardSize], () => {
  resetVisibleLimit()
})

watch(
  [previewText, previewSize, previewWeight, forceBold, forceItalic, verticalPreview, cardSize],
  () => {
    if (!cardOptionsLoaded.value || typeof window.comicType?.storeSet !== 'function') return
    const options: FontCardOptions = {
      previewText: previewText.value,
      previewSize: previewSize.value,
      previewWeight: previewWeight.value,
      forceBold: forceBold.value,
      forceItalic: forceItalic.value,
      verticalPreview: verticalPreview.value,
      cardSize: cardSize.value
    }
    void window.comicType.storeSet(FONT_CARD_OPTIONS_STORAGE_KEY, options).catch(() => undefined)
  }
)

function normalizePreviewWeight(value: unknown): PreviewWeight {
  if (value === 'auto') return 'auto'
  const number = Number(value)
  return [100, 200, 300, 400, 500, 600, 700, 800, 900].includes(number)
    ? (number as Exclude<PreviewWeight, 'auto'>)
    : 'auto'
}

async function loadCardOptions(): Promise<void> {
  if (typeof window.comicType?.storeGet !== 'function') {
    cardOptionsLoaded.value = true
    return
  }
  try {
    const value = await window.comicType.storeGet(FONT_CARD_OPTIONS_STORAGE_KEY)
    const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
    previewText.value =
      typeof record.previewText === 'string' && record.previewText.trim()
        ? Array.from(record.previewText).slice(0, 120).join('')
        : DEFAULT_PREVIEW
    previewSize.value = Math.min(96, Math.max(12, Number(record.previewSize) || 34))
    previewWeight.value = normalizePreviewWeight(record.previewWeight)
    forceBold.value = record.forceBold === true
    forceItalic.value = record.forceItalic === true
    verticalPreview.value = record.verticalPreview === true
    cardSize.value =
      record.cardSize === 'medium' || record.cardSize === 'small' ? record.cardSize : 'large'
  } catch {
    // Invalid or unavailable persisted UI preferences fall back to the defaults above.
  } finally {
    cardOptionsLoaded.value = true
  }
}

function resetVisibleLimit(): void {
  scrollTop.value = 0
  if (listElement.value) listElement.value.scrollTop = 0
}

function onLanguageFilterChange(nextValue: string | number): void {
  const value = String(nextValue)
  const validValues: LanguageFilter[] = [
    'all',
    'chinese',
    'japanese',
    'korean',
    'latin',
    'symbol',
    'other'
  ]
  languageFilter.value = validValues.includes(value as LanguageFilter)
    ? (value as LanguageFilter)
    : 'all'
  sourceFilter.value = 'all'
  resetVisibleLimit()
}

function onPreviewWeightChange(value: string | number): void {
  previewWeight.value =
    value === 'auto' ? 'auto' : (Number(value) as Exclude<PreviewWeight, 'auto'>)
}

function formatSource(source: FontSource): string {
  if (source === 'folder') return '独立文件夹'
  if (source === 'managed') return '本应用'
  if (source === 'user') return '用户字体'
  return '系统字体'
}

function formatLanguage(language: FontLanguage): string {
  if (language === 'chinese') return '中文'
  if (language === 'japanese') return '日文'
  if (language === 'korean') return '韩文'
  if (language === 'latin') return '西文'
  if (language === 'symbol') return '符号'
  return '其他'
}

function languageSummary(languages: FontLanguage[]): string {
  return languages.map(formatLanguage).join('/')
}

function sourceClass(source: FontSource): string {
  if (source === 'folder') return 'bg-info text-info-fg'
  if (source === 'managed') return 'bg-success text-success-fg'
  if (source === 'user') return 'bg-warning text-warning-fg'
  return 'bg-text-secondary text-app-bg'
}

function isRemovable(font: SystemFontInfo): boolean {
  return font.source === 'user' || font.source === 'managed'
}

function fontFamily(font: SystemFontInfo): string {
  return `"${previews.family(font)}", sans-serif`
}
function clearFolderPreviewFonts(): void {
  previews.clear()
  previewStatus.value = {}
}
function nativeFontWeight(font: SystemFontInfo): number {
  return Number(fontFaceCss({ font, fauxBold: false, fauxItalic: false }).weight)
}

function effectiveFontWeight(font: SystemFontInfo): number {
  const selectedWeight =
    previewWeight.value === 'auto' ? nativeFontWeight(font) : previewWeight.value
  return forceBold.value ? Math.max(700, selectedWeight) : selectedWeight
}

function effectiveFontStyle(font: SystemFontInfo): 'normal' | 'italic' {
  return forceItalic.value || (font.italic ?? /italic|oblique/i.test(font.style))
    ? 'italic'
    : 'normal'
}

function missingGlyphs(font: SystemFontInfo): number {
  const ranges = previews.coverage.get(font.id)
  if (!ranges || previewStatus.value[font.id]) return 0
  return [...new Set(Array.from(previewText.value || DEFAULT_PREVIEW))].filter(
    (char) =>
      !/\s/u.test(char) &&
      !ranges.some(([a, b]) => char.codePointAt(0)! >= a && char.codePointAt(0)! <= b)
  ).length
}
function effectivePreviewSize(): number {
  const scale = cardSize.value === 'large' ? 1 : cardSize.value === 'medium' ? 0.82 : 0.66
  return Math.max(12, Math.min(72, Math.round(previewSize.value * scale)))
}

function cardClass(): string {
  if (cardSize.value === 'small') return 'h-40 p-2.5'
  if (cardSize.value === 'medium') return 'h-48 p-3'
  return 'h-56 p-4'
}

function previewAreaClass(): string {
  if (cardSize.value === 'small') return 'mt-2 py-1.5'
  if (cardSize.value === 'medium') return 'mt-3 py-2'
  return 'mt-4 py-3'
}

async function refreshFonts(silent = false, notify = false, chooseFolder = false): Promise<void> {
  if (!managementMode.value) return
  if (loading.value) {
    if (!silent) {
      refreshQueued.value = true
      refreshQueuedNotify.value ||= notify
    }
    return
  }
  loading.value = true
  const generation = ++requestGeneration
  const mode = managementMode.value
  try {
    const result =
      mode === 'folder'
        ? await window.comicType.fontListFolder(
            chooseFolder ? undefined : folderPath.value || undefined
          )
        : await fontCatalog().load(notify)
    if (disposed || generation !== requestGeneration || mode !== managementMode.value) return
    if ('canceled' in result && result.canceled) return
    if ('folderPath' in result && typeof result.folderPath === 'string') {
      folderPath.value = result.folderPath
    }
    clearFolderPreviewFonts()
    supported.value = result.supported
    fonts.value = result.fonts
    const availableIds = new Set(result.fonts.map((font) => font.id))
    selectedFontIds.value = selectedFontIds.value.filter((id) => availableIds.has(id))
    if (selectedFontIds.value.length === 0) comparingSelected.value = false
    resetVisibleLimit()
    if (!result.supported && result.message && !silent) {
      toast.addToast({ type: 'warning', message: result.message })
    } else if (notify) {
      toast.addToast({
        type: 'success',
        message: `字体列表已刷新，共 ${result.fonts.length} 个字体`
      })
    }
  } catch (error) {
    if (!silent && !disposed && generation === requestGeneration) {
      toast.addToast({
        type: 'error',
        message: `读取字体失败：${error instanceof Error ? error.message : String(error)}`
      })
    }
  } finally {
    if (!disposed && generation === requestGeneration) {
      loading.value = false
      if (refreshQueued.value) {
        const queuedNotify = refreshQueuedNotify.value
        refreshQueued.value = false
        refreshQueuedNotify.value = false
        void refreshFonts(false, queuedNotify)
      }
    }
  }
}

async function chooseManagementMode(mode: ManagementMode): Promise<void> {
  managementMode.value = mode
  query.value = ''
  languageFilter.value = 'all'
  exitSelectionMode()
  sourceFilter.value = 'all'
  if (mode === 'system') {
    folderPath.value = ''
    clearFolderPreviewFonts()
  }
  await refreshFonts(false)
  if (mode === 'folder' && !folderPath.value && fonts.value.length === 0)
    managementMode.value = null
}

async function chooseAnotherFolder(): Promise<void> {
  await refreshFonts(false, false, true)
}

function returnToModeSelection(): void {
  requestGeneration++
  loading.value = false
  refreshQueued.value = false
  refreshQueuedNotify.value = false
  managementMode.value = null
  fonts.value = []
  folderPath.value = ''
  exitSelectionMode()
  clearFolderPreviewFonts()
}

function refreshFromButton(): void {
  void refreshFonts(false, true)
}

async function installFonts(): Promise<void> {
  if (installing.value) return
  installing.value = true
  try {
    const result = await window.comicType.fontInstall()
    if (result.canceled) return

    if (result.installed.length > 0) {
      toast.addToast({ type: 'success', message: `已安装 ${result.installed.length} 个字体` })
    }
    if (result.failed.length > 0) {
      toast.addToast({
        type: 'error',
        message: result.failed
          .map((failure) =>
            failure.fileName ? `${failure.fileName}：${failure.message}` : failure.message
          )
          .join('；')
      })
    }
    await refreshFonts(true)
    sourceFilter.value = result.installed.length > 0 ? 'managed' : sourceFilter.value
  } catch (error) {
    toast.addToast({
      type: 'error',
      message: `安装失败：${error instanceof Error ? error.message : String(error)}`
    })
  } finally {
    installing.value = false
  }
}

async function uninstallFont(font: SystemFontInfo): Promise<void> {
  if (!isRemovable(font) || activeUninstallId.value || batchUninstalling.value) return
  if (
    !(await confirmAction(
      `确定卸载“${font.displayName}”吗？\n字体文件将从当前用户字体库中删除；TTC 集合内的所有字体将一并卸载。`
    ))
  ) {
    return
  }

  activeUninstallId.value = font.id
  try {
    const result = await window.comicType.fontUninstall(font.id)
    if (result.ok) {
      toast.addToast({ type: 'success', message: result.message })
      await refreshFonts(true)
    } else {
      toast.addToast({ type: 'error', message: result.message })
    }
  } catch (error) {
    toast.addToast({
      type: 'error',
      message: `卸载失败：${error instanceof Error ? error.message : String(error)}`
    })
  } finally {
    activeUninstallId.value = ''
  }
}

async function uninstallSelectedFonts(): Promise<void> {
  if (selectedRemovableFonts.value.length === 0 || batchUninstalling.value) return
  const selectedFonts = [...selectedRemovableFonts.value]
  const count = new Set(
    selectedFonts.map((font) => font.fileId || font.id.split(':')[0])
  ).size
  if (!await confirmAction(`确定卸载选中的 ${count} 个用户字体吗？\n系统字体不会被修改。`)) return

  batchUninstalling.value = true
  try {
    const result = await window.comicType.fontUninstallMany(
      selectedFonts.map((font) => font.id)
    )
    if (result.succeeded.length > 0) {
      toast.addToast({ type: 'success', message: `已卸载 ${result.succeeded.length} 个字体` })
    }
    if (result.failed.length > 0) {
      toast.addToast({
        type: 'error',
        message: `${result.failed.length} 个字体卸载失败：${result.failed
          .map((failure) => failure.message)
          .join('；')}`
      })
    }
    const removed = new Set(result.succeeded)
    selectedFontIds.value = selectedFontIds.value.filter((id) => !removed.has(id.split(':')[0]))
    if (selectedFontIds.value.length === 0) comparingSelected.value = false
    await refreshFonts(true)
  } catch (error) {
    toast.addToast({
      type: 'error',
      message: `批量卸载失败：${error instanceof Error ? error.message : String(error)}`
    })
  } finally {
    batchUninstalling.value = false
  }
}

async function openFontIdentifySite(): Promise<void> {
  const result = await window.comicType.openExternal(FONT_IDENTIFY_SITE)
  if (!result.ok) {
    toast.addToast({ type: 'warning', message: `没能打开浏览器：${result.message}` })
  }
}

function stopAutoRefresh(): void {
  if (refreshTimer === undefined) return
  window.clearInterval(refreshTimer)
  refreshTimer = undefined
}

function startAutoRefresh(): void {
  stopAutoRefresh()
  if (document.visibilityState === 'hidden') return
  refreshTimer = window.setInterval(() => void refreshFonts(true), AUTO_REFRESH_INTERVAL)
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    stopAutoRefresh()
  } else {
    startAutoRefresh()
  }
}

onMounted(async () => {
  await loadCardOptions()
  if (disposed) return
  resetVisibleLimit()
  document.addEventListener('visibilitychange', handleVisibilityChange)
  startAutoRefresh()
})

onUnmounted(() => {
  disposed = true
  requestGeneration++
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  stopAutoRefresh()
  clearFolderPreviewFonts()
})

watch(
  [virtualFonts, previewText, previewWeight, forceBold, forceItalic, verticalPreview],
  ([visible]) => {
    previews.show(visible, (previewText.value || DEFAULT_PREVIEW) === DEFAULT_PREVIEW && previewWeight.value === 'auto' && !forceBold.value && !forceItalic.value && !verticalPreview.value)
  },
  { flush: 'post' }
)
</script>

<template>
  <div class="page-in page-layout flex h-full min-h-0 flex-col bg-app-bg text-text-primary">
    <header
      v-if="managementMode"
      class="view-heading shrink-0"
    >
      <div>
        <div class="flex items-center gap-1">
          <h1 class="view-title">字体管理</h1>
          <InfoHint label="字体管理说明"
            ><template v-if="managementMode === 'system'"
              >浏览和预览 Windows 字体。系统字体受保护，只允许卸载用户字体。</template
            ><template v-else>递归浏览独立文件夹中的字体，无需安装即可预览。</template></InfoHint
          >
        </div>
        <p
          v-if="managementMode === 'folder'"
          class="mt-1 max-w-xl break-all text-xs text-text-secondary"
        >
          {{ folderPath }}
        </p>
      </div>
      <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
        <label class="flex items-center gap-2 text-xs text-text-secondary">
          <span>字体分类</span>
          <AppSelect
            class="w-44"
            :model-value="languageFilter"
            :options="languageOptions"
            test-id="font-language-filter"
            @update:model-value="onLanguageFilterChange"
          />
        </label>
        <UiButton variant="outline" size="sm"
          v-if="managementMode === 'folder'"
          type="button"
          class="transition-colors"
          data-testid="font-choose-another-folder"
          @click="chooseAnotherFolder"
        >
          更换文件夹
        </UiButton>
        <UiButton variant="outline" size="sm"
          type="button"
          class="transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="font-refresh"
          @click="refreshFromButton"
        >
          {{ loading ? '读取中…' : '刷新' }}
        </UiButton>
        <UiButton variant="default" size="sm"
          v-if="managementMode === 'system'"
          type="button"
          class="transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!supported || installing"
          data-testid="font-install"
          @click="installFonts"
        >
          {{ installing ? '安装中…' : '安装字体' }}
        </UiButton>
        <UiButton variant="ghost" size="sm"
          type="button"
          class=""
          data-testid="font-back-to-mode"
          @click="returnToModeSelection"
        >
          返回选择
        </UiButton>
      </div>
    </header>

    <header v-else class="view-heading shrink-0">
      <div>
      <h1 class="view-title">字体管理</h1>
      <p class="view-description">请选择这次需要管理的字体来源。</p>
      </div>
    </header>

    <section
      v-if="!managementMode"
      class="font-mode-picker min-h-0 flex-1 pb-12"
      data-testid="font-mode-picker"
    >
      <div class="font-mode-card-group" data-testid="font-mode-card-group">
        <UiButton variant="outline" size="sm"
          type="button"
          class="group h-auto min-h-52 w-full flex-col items-start whitespace-normal p-6 text-left transition-all duration-200 hover:-translate-y-0.5 [&_svg]:size-6"
          data-testid="font-mode-system"
          @click="chooseManagementMode('system')"
        >
          <span
            class="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-accent transition-transform duration-200 group-hover:scale-105"
            aria-hidden="true"
          >
            <svg
              class="h-6 w-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </span>
          <span class="text-lg font-bold transition-colors group-hover:text-accent"
            >管理系统字体</span
          >
          <span class="mt-2 block text-sm leading-6 text-text-secondary">
            扫描 Windows 系统与当前用户字体，可安装、预览和卸载用户字体。
          </span>
          <span class="mt-auto pt-5 text-xs font-semibold text-accent">
            进入管理
            <span class="ml-1 transition-transform group-hover:translate-x-1" aria-hidden="true"
              >→</span
            >
          </span>
        </UiButton>
        <UiButton variant="outline" size="sm"
          type="button"
          class="group h-auto min-h-52 w-full flex-col items-start whitespace-normal p-6 text-left transition-all duration-200 hover:-translate-y-0.5 [&_svg]:size-6"
          data-testid="font-mode-folder"
          @click="chooseManagementMode('folder')"
        >
          <span
            class="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-accent transition-transform duration-200 group-hover:scale-105"
            aria-hidden="true"
          >
            <svg
              class="h-6 w-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path
                d="M3 7.5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z"
              />
            </svg>
          </span>
          <span class="text-lg font-bold transition-colors group-hover:text-accent"
            >导入独立文件夹</span
          >
          <span class="mt-2 block text-sm leading-6 text-text-secondary">
            选择一个文件夹，递归读取其全部子文件夹中的 TTF、OTF 和 TTC 字体，不安装到系统。
          </span>
          <span class="mt-auto pt-5 text-xs font-semibold text-accent">
            选择文件夹
            <span class="ml-1 transition-transform group-hover:translate-x-1" aria-hidden="true"
              >→</span
            >
          </span>
        </UiButton>
      </div>
    </section>

    <template v-if="managementMode">
      <section class="mb-4 shrink-0 rounded-xl border border-border bg-card-bg p-4">
        <div class="grid grid-cols-[minmax(220px,1fr)_minmax(280px,1.5fr)] gap-3">
          <label class="block">
            <span class="mb-1.5 block text-xs text-text-secondary">搜索字体</span>
            <div class="relative">
              <svg
                class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <UiInput
                v-model="query"
                type="search"
                placeholder="名称、样式或文件名"
                class="h-10 w-full rounded-md border border-border bg-app-bg pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-text-tertiary focus:border-accent"
                data-testid="font-search"
              />
            </div>
          </label>

          <label class="block">
            <span class="mb-1.5 block text-xs text-text-secondary">预览文字</span>
            <UiInput
              v-model="previewText"
              type="text"
              class="h-10 w-full rounded-md border border-border bg-app-bg px-3 text-sm outline-none transition-colors focus:border-accent"
              data-testid="font-preview-input"
            />
          </label>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-4 border-t border-border pt-3">
          <div class="flex items-center gap-1">
            <span class="mr-1 text-xs text-text-secondary">卡片</span>
            <ToggleGroup type="single" variant="outline" size="sm" :model-value="cardSize" aria-label="卡片大小" @update:model-value="value => { if (value) cardSize = value as CardSize }">
            <ToggleGroupItem :value="option.value"
              v-for="option in [
                { value: 'large', label: '大' },
                { value: 'medium', label: '中' },
                { value: 'small', label: '小' }
              ]"
              :key="option.value"
              type="button"
              class="transition-colors"
              :data-testid="`font-card-size-${option.value}`"
            >
              {{ option.label }}
            </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <label class="flex items-center gap-2 text-xs text-text-secondary">
            <span>字重</span>
            <AppSelect
              class="w-28"
              size="small"
              :model-value="previewWeight"
              :options="previewWeightOptions"
              test-id="font-preview-weight"
              @update:model-value="onPreviewWeightChange"
            />
          </label>

          <div class="flex items-center gap-1">
            <UiButton variant="outline" size="sm"
              type="button"
              class="min-w-8 transition-colors"
              :class="
                forceBold
                  ? 'border-accent bg-selected-bg text-accent'
                  : 'border-border bg-app-bg text-text-secondary'
              "
              title="粗体预览"
              data-testid="font-preview-bold"
              @click="forceBold = !forceBold"
            >
              B
            </UiButton>
            <UiButton variant="outline" size="sm"
              type="button"
              class="min-w-8 italic transition-colors"
              :class="
                forceItalic
                  ? 'border-accent bg-selected-bg text-accent'
                  : 'border-border bg-app-bg text-text-secondary'
              "
              title="斜体预览"
              data-testid="font-preview-italic"
              @click="forceItalic = !forceItalic"
            >
              I
            </UiButton>
            <UiButton variant="outline" size="sm"
              type="button"
              class="transition-colors"
              :class="
                verticalPreview
                  ? 'border-accent bg-selected-bg text-accent'
                  : 'border-border bg-app-bg text-text-secondary'
              "
              title="竖排预览"
              data-testid="font-preview-vertical"
              @click="verticalPreview = !verticalPreview"
            >
              竖排
            </UiButton>
          </div>

          <label class="ml-auto flex min-w-60 items-center gap-3 text-xs text-text-secondary">
            <span class="shrink-0">字号 {{ previewSize }} px</span>
            <UiInput
              v-model.number="previewSize"
              type="range"
              min="16"
              max="72"
              step="2"
              class="w-full accent-accent"
              data-testid="font-preview-size"
            />
          </label>
        </div>
      </section>

      <div class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" :model-value="sourceFilter" @update:model-value="value => { if (value) sourceFilter = String(value) as SourceFilter }"
            v-if="managementMode === 'system'"
            size="sm" variant="outline"
          >
            <ToggleGroupItem :value="filter.value"
              v-for="filter in [
                { value: 'all', label: `全部 ${languageFilteredFonts.length}` },
                { value: 'system', label: `系统 ${sourceCounts.system}` },
                { value: 'user', label: `用户 ${sourceCounts.user}` },
                { value: 'managed', label: `本应用 ${sourceCounts.managed}` }
              ]"
              :key="filter.value"
              type="button"
              class="transition-colors"
              :data-testid="`font-filter-${filter.value}`"
            >
              {{ filter.label }}
            </ToggleGroupItem>
          </ToggleGroup>

          <UiButton variant="outline" size="sm"
            v-if="!selectionMode"
            type="button"
            class=""
            :disabled="fonts.length === 0"
            data-testid="font-selection-enter"
            @click="enterSelectionMode"
          >
            多选
          </UiButton>

          <template v-else>
            <UiButton variant="outline" size="sm"
              type="button"
              class=""
              data-testid="font-selection-all"
              @click="selectAllFiltered"
            >
              全选可卸载字体
            </UiButton>
            <UiButton variant="outline" size="sm"
              type="button"
              class=""
              @click="clearSelection"
            >
              清空
            </UiButton>

            <UiButton variant="outline" size="sm"
              type="button"
              class="transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              :class="
                comparingSelected
                  ? 'border-accent bg-selected-bg font-semibold text-accent'
                  : 'border-border bg-card-bg text-text-secondary hover:bg-card-bg-hover'
              "
              :disabled="selectedFonts.length === 0"
              data-testid="font-selection-compare"
              @click="compareSelectedFonts"
            >
              比较所选 ({{ selectedFonts.length }})
            </UiButton>
            <UiButton variant="destructive" size="sm"
              type="button"
              class="disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="selectedRemovableFonts.length === 0 || batchUninstalling"
              data-testid="font-selection-uninstall"
              @click="uninstallSelectedFonts"
            >
              {{ batchUninstalling ? '卸载中…' : `卸载所选 (${selectedRemovableFonts.length})` }}
            </UiButton>
            <UiButton variant="ghost" size="sm"
              type="button"
              class=""
              data-testid="font-selection-cancel"
              @click="exitSelectionMode"
            >
              取消多选
            </UiButton>
          </template>
          <!-- 字体识别 / 下载：跳到外面那个站（识字网）。样式与隔壁「多选卸载」同一档，
             图标复用本页「搜索字体」那个放大镜的 path，保证是同一套图标语言。 -->
          <UiButton variant="outline" size="sm"
            type="button"
            class="flex items-center gap-1.5"
            title="在浏览器打开识字网：字体识别与字体下载"
            data-testid="font-identify-site"
            @click="openFontIdentifySite"
          >
            <svg
              class="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            识字网
          </UiButton>
        </div>
        <span class="text-xs text-text-tertiary"> 共 {{ filteredFonts.length }} 个字体 </span>
      </div>

      <section
        v-if="!supported"
        class="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-card-bg"
        data-testid="font-unsupported"
      >
        <div class="text-center">
          <div class="text-4xl font-semibold text-text-tertiary">Aa</div>
          <p class="mt-3 text-sm text-text-secondary">字体管理仅在 Windows 版本中可用</p>
        </div>
      </section>

      <section
        v-else-if="loading && fonts.length === 0"
        class="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border bg-card-bg text-sm text-text-secondary"
      >
        正在扫描系统字体…
      </section>

      <section
        v-else
        @scroll="scrollTop = ($event.target as HTMLElement).scrollTop"
        class="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-card-bg p-3"
        style="overflow-anchor: none"
        ref="listElement"
        data-testid="font-list"
      >
        <div
          v-if="visibleFonts.length === 0"
          class="flex h-full min-h-52 items-center justify-center text-sm text-text-secondary"
        >
          没有找到符合条件的字体
        </div>

        <div
          v-else
          class="grid gap-3"
          :style="{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            paddingTop: `${startRow * rowHeight}px`,
            paddingBottom: `${Math.max(0, Math.ceil((visibleFonts.length - virtualEnd) / columns)) * rowHeight}px`
          }"
        >
          <article
            v-for="(font, fontIndex) in virtualFonts"
            :key="font.id"
            class="font-card-appear flex min-w-0 flex-col rounded-lg border bg-app-bg transition-colors"
            :class="[
              cardClass(),
              isSelected(font.id)
                ? 'border-accent bg-selected-bg'
                : 'border-border hover:border-accent/50',
              selectionMode ? 'cursor-pointer' : ''
            ]"
            :style="{ '--font-card-delay': `${Math.min(fontIndex, 16) * 10}ms` }"
            :data-testid="`font-card-${font.id}`"
            @click="toggleSelection(font)"
            :tabindex="selectionMode ? 0 : undefined"
            :aria-label="font.displayName"
            @keydown.enter.self.prevent="toggleSelection(font)"
            @keydown.space.self.prevent="toggleSelection(font)"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <h2 class="truncate text-sm font-semibold" :title="font.displayName">
                  {{ font.family }}
                </h2>
                <p class="mt-0.5 truncate text-[11px] text-text-tertiary">
                  {{ font.style }} · {{ font.format }} · {{ languageSummary(font.languages) }}
                </p>
                <p class="truncate text-[10px] text-text-tertiary" :title="font.postScriptName">
                  PS: {{ font.postScriptName || '未提供（不可用于 PSD 文字层）' }}
                </p>
              </div>
              <UiButton variant="default" size="sm"
                v-if="selectionMode"
                type="button"
                class="flex w-5 shrink-0 items-center justify-center"
                :class="
                  isSelected(font.id)
                    ? 'border-accent bg-accent text-text-on-accent'
                    : 'border-border bg-card-bg'
                "
                :aria-label="isSelected(font.id) ? '取消选择' : '选择字体'"
                @click.stop="toggleSelection(font)"
              >
                {{ isSelected(font.id) ? '✓' : '' }}
              </UiButton>
              <span
                v-else
                class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                :class="sourceClass(font.source)"
              >
                {{ formatSource(font.source) }}
              </span>
            </div>

            <div
              class="flex min-h-0 flex-1 items-center justify-center overflow-hidden border-y border-border leading-tight"
              :class="previewAreaClass()"
            >
              <span v-if="previewStatus[font.id]" class="text-xs text-text-secondary">{{
                previewStatus[font.id]
              }}</span>
              <GlyphSample v-else-if="previews.glyphs.has(font.id)" :sample="previews.glyphs.get(font.id)!" :size="effectivePreviewSize()" />
              <div
                v-else
                class="max-h-full max-w-full overflow-hidden break-words"
                :data-testid="`font-preview-sample-${font.id}`"
                :style="{
                  fontFamily: fontFamily(font),
                  fontSize: `${effectivePreviewSize()}px`,
                  fontWeight: effectiveFontWeight(font),
                  fontStyle: effectiveFontStyle(font),
                  writingMode: verticalPreview ? 'vertical-rl' : 'horizontal-tb',
                  textOrientation: 'mixed'
                }"
              >
                {{ previewText || DEFAULT_PREVIEW }}
              </div>
            </div>

            <p v-if="missingGlyphs(font)" class="text-[10px] text-warning">
              预览含 {{ missingGlyphs(font) }} 个缺失字符{{ previews.glyphs.has(font.id) ? '（字体未包含对应字形）' : '（使用回退字体）' }}
            </p>
            <p
              v-else-if="
                effectiveFontWeight(font) !== nativeFontWeight(font) ||
                (forceItalic && !font.italic)
              "
              class="text-[10px] text-text-tertiary"
            >
              合成字重 / 斜体预览
            </p>
            <div class="mt-2 flex items-center justify-between gap-2">
              <p class="min-w-0 truncate text-[10px] text-text-tertiary" :title="font.filePath">
                {{ font.filePath }}
              </p>
              <UiButton variant="destructive" size="sm"
                v-if="isRemovable(font) && !selectionMode"
                type="button"
                class="shrink-0 transition-colors disabled:opacity-50"
                :disabled="Boolean(activeUninstallId) || batchUninstalling"
                :data-testid="`font-uninstall-${font.id}`"
                @click.stop="uninstallFont(font)"
              >
                {{ activeUninstallId === font.id ? '卸载中…' : '卸载' }}
              </UiButton>
              <span
                v-else-if="font.source === 'system'"
                class="shrink-0 text-[10px] text-text-tertiary"
              >
                受保护
              </span>
            </div>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.font-mode-picker {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
}

.font-mode-card-group {
  display: grid;
  width: min(660px, 100%);
  margin-inline: auto;
  grid-template-columns: repeat(2, minmax(0, 320px));
  justify-content: center;
  gap: 20px;
}

@media (max-width: 760px) {
  .font-mode-card-group {
    width: min(320px, 100%);
    grid-template-columns: minmax(0, 320px);
  }
}

@keyframes font-card-fade-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.font-card-appear {
  animation: font-card-fade-in 240ms ease-out both;
  animation-delay: var(--font-card-delay, 0ms);
}

@media (prefers-reduced-motion: reduce) {
  .font-card-appear {
    animation: none;
  }
}
</style>
