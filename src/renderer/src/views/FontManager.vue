<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { FontLanguage, FontSource, SystemFontInfo } from '@shared/ipc-api'
import { useToastStore } from '../stores/toast'
import { FONT_IDENTIFY_SITE } from '@shared/external-url'
import AppSelect, { type AppSelectOption } from '../components/AppSelect.vue'

type SourceFilter = 'all' | FontSource
type LanguageFilter = 'all' | FontLanguage
type CardSize = 'large' | 'medium' | 'small'
type LoadBatch = 50 | 100 | 'all'
type PreviewWeight = 'auto' | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900

const DEFAULT_PREVIEW = '汉化工坊 字体预览 123 ABC'
const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000
const toast = useToastStore()

const fonts = ref<SystemFontInfo[]>([])
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
const loadBatch = ref<LoadBatch>(50)
const sourceFilter = ref<SourceFilter>('all')
const languageFilter = ref<LanguageFilter>('all')
const visibleLimit = ref(50)
const selectionMode = ref(false)
const selectedFontIds = ref<string[]>([])
const refreshQueued = ref(false)
const refreshQueuedNotify = ref(false)
const fontListRevision = ref(0)
let refreshTimer: number | undefined

const languageFilteredFonts = computed(() => {
  const language = languageFilter.value
  return language === 'all'
    ? fonts.value
    : fonts.value.filter((font) => font.languages.includes(language))
})

const sourceCounts = computed(() => {
  const counts: Record<FontSource, number> = { system: 0, user: 0, managed: 0 }
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

const loadBatchOptions: AppSelectOption[] = [
  { value: 50, label: '50' },
  { value: 100, label: '100' },
  { value: 'all', label: '全部' }
]

const previewWeightOptions: AppSelectOption[] = [
  { value: 'auto', label: '字体默认' },
  ...[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => ({
    value: weight,
    label: String(weight)
  }))
]

const filteredFonts = computed(() => {
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

const visibleFonts = computed(() => {
  if (loadBatch.value === 'all') return filteredFonts.value
  return filteredFonts.value.slice(0, visibleLimit.value)
})

const removableFilteredFonts = computed(() =>
  filteredFonts.value.filter((font) => isRemovable(font))
)

const selectedFonts = computed(() => {
  const selected = new Set(selectedFontIds.value)
  return fonts.value.filter((font) => selected.has(font.id) && isRemovable(font))
})

const gridClass = computed(() => {
  if (cardSize.value === 'small') return 'grid-cols-4'
  if (cardSize.value === 'medium') return 'grid-cols-3'
  return 'grid-cols-2'
})

watch([query, sourceFilter, languageFilter, loadBatch], resetVisibleLimit)

function resetVisibleLimit(): void {
  visibleLimit.value = loadBatch.value === 'all' ? Number.MAX_SAFE_INTEGER : loadBatch.value
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
  fontListRevision.value += 1
}

function onLoadBatchChange(value: string | number): void {
  loadBatch.value = value === 'all' ? 'all' : Number(value) === 100 ? 100 : 50
}

function onPreviewWeightChange(value: string | number): void {
  previewWeight.value =
    value === 'auto' ? 'auto' : (Number(value) as Exclude<PreviewWeight, 'auto'>)
}

function formatSource(source: FontSource): string {
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
  if (source === 'managed') return 'bg-success text-success-fg'
  if (source === 'user') return 'bg-warning text-warning-fg'
  return 'bg-text-secondary text-app-bg'
}

function isRemovable(font: SystemFontInfo): boolean {
  return font.source === 'user' || font.source === 'managed'
}

function fontFamily(font: SystemFontInfo): string {
  const safeFamily = font.family.replace(/["\\]/g, '')
  return `"${safeFamily}", "Microsoft YaHei UI", sans-serif`
}

function nativeFontWeight(font: SystemFontInfo): number {
  const style = font.style.toLocaleLowerCase()
  if (style.includes('black') || style.includes('heavy')) return 900
  if (style.includes('extra bold') || style.includes('extrabold')) return 800
  if (style.includes('bold')) return 700
  if (style.includes('semi bold') || style.includes('semibold')) return 600
  if (style.includes('medium')) return 500
  if (style.includes('light')) return 300
  if (style.includes('thin')) return 200
  return 400
}

function effectiveFontWeight(font: SystemFontInfo): number {
  const selectedWeight =
    previewWeight.value === 'auto' ? nativeFontWeight(font) : previewWeight.value
  return forceBold.value ? Math.max(700, selectedWeight) : selectedWeight
}

function effectiveFontStyle(font: SystemFontInfo): 'normal' | 'italic' {
  return forceItalic.value || /italic|oblique/i.test(font.style) ? 'italic' : 'normal'
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

function isSelected(fontId: string): boolean {
  return selectedFontIds.value.includes(fontId)
}

function toggleSelection(font: SystemFontInfo): void {
  if (!selectionMode.value || !isRemovable(font)) return
  selectedFontIds.value = isSelected(font.id)
    ? selectedFontIds.value.filter((id) => id !== font.id)
    : [...selectedFontIds.value, font.id]
}

/**
 * 「识字网」—— 认不出的字体拿去外面识别 / 下载（用系统默认浏览器打开）。
 *
 * 只放行 http / https，规则在主进程侧（`shared/external-url.ts`，纯函数有单测）。
 * 打不开时给一条提示，**不要静默什么都没发生** —— 用户点了没反应会以为程序坏了。
 */
async function openFontIdentifySite(): Promise<void> {
  const result = await window.comicType.openExternal(FONT_IDENTIFY_SITE)
  if (!result.ok) {
    toast.addToast({ type: 'warning', message: `没能打开浏览器：${result.message}` })
  }
}

function enterSelectionMode(): void {
  selectionMode.value = true
  selectedFontIds.value = []
}

function exitSelectionMode(): void {
  selectionMode.value = false
  selectedFontIds.value = []
}

function selectAllFiltered(): void {
  selectedFontIds.value = removableFilteredFonts.value.map((font) => font.id)
}

async function refreshFonts(silent = false, notify = false): Promise<void> {
  if (loading.value) {
    if (!silent) {
      refreshQueued.value = true
      refreshQueuedNotify.value ||= notify
    }
    return
  }
  loading.value = true
  try {
    const result = await window.comicType.fontList()
    supported.value = result.supported
    fonts.value = result.fonts
    const availableIds = new Set(
      result.fonts.filter((font) => isRemovable(font)).map((font) => font.id)
    )
    selectedFontIds.value = selectedFontIds.value.filter((id) => availableIds.has(id))
    resetVisibleLimit()
    fontListRevision.value += 1
    if (!result.supported && result.message && !silent) {
      toast.addToast({ type: 'warning', message: result.message })
    } else if (notify) {
      toast.addToast({
        type: 'success',
        message: `字体列表已刷新，共 ${result.fonts.length} 个字体`
      })
    }
  } catch (error) {
    if (!silent) {
      toast.addToast({
        type: 'error',
        message: `读取字体失败：${error instanceof Error ? error.message : String(error)}`
      })
    }
  } finally {
    loading.value = false
    if (refreshQueued.value) {
      const queuedNotify = refreshQueuedNotify.value
      refreshQueued.value = false
      refreshQueuedNotify.value = false
      void refreshFonts(false, queuedNotify)
    }
  }
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
  if (!window.confirm(`确定卸载“${font.displayName}”吗？\n字体文件将从当前用户字体库中删除。`)) {
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
  if (selectedFonts.value.length === 0 || batchUninstalling.value) return
  const count = selectedFonts.value.length
  if (!window.confirm(`确定卸载选中的 ${count} 个用户字体吗？\n系统字体不会被修改。`)) return

  batchUninstalling.value = true
  try {
    const result = await window.comicType.fontUninstallMany(
      selectedFonts.value.map((font) => font.id)
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
    selectedFontIds.value = []
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

function loadMore(): void {
  if (loadBatch.value !== 'all') visibleLimit.value += loadBatch.value
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

onMounted(() => {
  resetVisibleLimit()
  void refreshFonts()
  document.addEventListener('visibilitychange', handleVisibilityChange)
  startAutoRefresh()
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  stopAutoRefresh()
})
</script>

<template>
  <div class="page-in flex h-full min-h-0 flex-col bg-app-bg p-6 text-text-primary">
    <header class="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">字体管理</h1>
        <p class="mt-1 text-sm text-text-secondary">
          浏览和预览 Windows 字体。系统字体受保护，只允许卸载用户字体。
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
        <label class="flex items-center gap-2 text-xs text-text-secondary">
          <span>每批加载</span>
          <AppSelect
            class="w-20"
            :model-value="loadBatch"
            :options="loadBatchOptions"
            test-id="font-load-batch"
            @update:model-value="onLoadBatchChange"
          />
        </label>
        <button
          type="button"
          class="rounded-md border border-border bg-card-bg px-4 py-2 text-sm text-text-primary transition-colors hover:bg-card-bg-hover disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="font-refresh"
          @click="refreshFromButton"
        >
          {{ loading ? '读取中…' : '刷新' }}
        </button>
        <button
          type="button"
          class="rounded-badge bg-accent px-4 py-2 text-sm text-text-on-accent transition-colors hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!supported || installing"
          data-testid="font-install"
          @click="installFonts"
        >
          {{ installing ? '安装中…' : '安装字体' }}
        </button>
      </div>
    </header>

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
            <input
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
          <input
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
          <button
            v-for="option in [
              { value: 'large', label: '大' },
              { value: 'medium', label: '中' },
              { value: 'small', label: '小' }
            ]"
            :key="option.value"
            type="button"
            class="rounded px-2.5 py-1.5 text-xs transition-colors"
            :class="
              cardSize === option.value
                ? 'bg-accent text-text-on-accent'
                : 'bg-app-bg text-text-secondary hover:bg-card-bg-hover'
            "
            :data-testid="`font-card-size-${option.value}`"
            @click="cardSize = option.value as CardSize"
          >
            {{ option.label }}
          </button>
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
          <button
            type="button"
            class="h-8 min-w-8 rounded border text-sm font-bold transition-colors"
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
          </button>
          <button
            type="button"
            class="h-8 min-w-8 rounded border text-sm italic transition-colors"
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
          </button>
          <button
            type="button"
            class="h-8 rounded border px-2 text-xs transition-colors"
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
          </button>
        </div>

        <label class="ml-auto flex min-w-60 items-center gap-3 text-xs text-text-secondary">
          <span class="shrink-0">字号 {{ previewSize }} px</span>
          <input
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

    <div class="mb-3 flex shrink-0 items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <div class="flex rounded-badge border border-border bg-card-bg p-1 text-sm">
          <button
            v-for="filter in [
              { value: 'all', label: `全部 ${languageFilteredFonts.length}` },
              { value: 'system', label: `系统 ${sourceCounts.system}` },
              { value: 'user', label: `用户 ${sourceCounts.user}` },
              { value: 'managed', label: `本应用 ${sourceCounts.managed}` }
            ]"
            :key="filter.value"
            type="button"
            class="rounded px-3 py-1.5 transition-colors"
            :class="
              sourceFilter === filter.value
                ? 'bg-accent text-text-on-accent'
                : 'text-text-secondary hover:bg-card-bg-hover hover:text-text-primary'
            "
            :data-testid="`font-filter-${filter.value}`"
            @click="sourceFilter = filter.value as SourceFilter"
          >
            {{ filter.label }}
          </button>
        </div>

        <button
          v-if="!selectionMode"
          type="button"
          class="rounded-md border border-border bg-card-bg px-3 py-2 text-xs text-text-secondary hover:bg-card-bg-hover hover:text-text-primary"
          :disabled="removableFilteredFonts.length === 0"
          data-testid="font-selection-enter"
          @click="enterSelectionMode"
        >
          多选卸载
        </button>
        <template v-else>
          <button
            type="button"
            class="rounded-md border border-border bg-card-bg px-3 py-2 text-xs text-text-secondary hover:bg-card-bg-hover"
            data-testid="font-selection-all"
            @click="selectAllFiltered"
          >
            全选可卸载字体
          </button>
          <button
            type="button"
            class="rounded-md border border-border bg-card-bg px-3 py-2 text-xs text-text-secondary hover:bg-card-bg-hover"
            @click="selectedFontIds = []"
          >
            清空
          </button>
          <button
            type="button"
            class="rounded-md bg-danger px-3 py-2 text-xs text-danger-fg disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="selectedFonts.length === 0 || batchUninstalling"
            data-testid="font-selection-uninstall"
            @click="uninstallSelectedFonts"
          >
            {{ batchUninstalling ? '卸载中…' : `卸载所选 (${selectedFonts.length})` }}
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-2 text-xs text-text-secondary hover:bg-card-bg-hover"
            data-testid="font-selection-cancel"
            @click="exitSelectionMode"
          >
            取消多选
          </button>
        </template>

        <!-- 字体识别 / 下载：跳到外面那个站（识字网）。样式与隔壁「多选卸载」同一档，
             图标复用本页「搜索字体」那个放大镜的 path，保证是同一套图标语言。 -->
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-md border border-border bg-card-bg px-3 py-2 text-xs text-text-secondary hover:bg-card-bg-hover hover:text-text-primary"
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
        </button>
      </div>
      <span class="text-xs text-text-tertiary">
        显示 {{ visibleFonts.length }} / {{ filteredFonts.length }}
      </span>
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
      :key="`font-list-${languageFilter}-${fontListRevision}`"
      class="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-card-bg p-3"
      data-testid="font-list"
    >
      <div
        v-if="visibleFonts.length === 0"
        class="flex h-full min-h-52 items-center justify-center text-sm text-text-secondary"
      >
        没有找到符合条件的字体
      </div>

      <div v-else class="grid gap-3" :class="gridClass">
        <article
          v-for="font in visibleFonts"
          :key="font.id"
          class="flex min-w-0 flex-col rounded-lg border bg-app-bg transition-colors"
          :class="[
            cardClass(),
            isSelected(font.id)
              ? 'border-accent bg-selected-bg'
              : 'border-border hover:border-accent/50',
            selectionMode && isRemovable(font) ? 'cursor-pointer' : ''
          ]"
          :data-testid="`font-card-${font.id}`"
          @click="toggleSelection(font)"
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
                PS: {{ font.postScriptName }}
              </p>
            </div>
            <button
              v-if="selectionMode && isRemovable(font)"
              type="button"
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs"
              :class="
                isSelected(font.id)
                  ? 'border-accent bg-accent text-text-on-accent'
                  : 'border-border bg-card-bg'
              "
              :aria-label="isSelected(font.id) ? '取消选择' : '选择字体'"
              @click.stop="toggleSelection(font)"
            >
              {{ isSelected(font.id) ? '✓' : '' }}
            </button>
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
            <div
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

          <div class="mt-2 flex items-center justify-between gap-2">
            <p class="min-w-0 truncate text-[10px] text-text-tertiary" :title="font.filePath">
              {{ font.filePath }}
            </p>
            <button
              v-if="isRemovable(font) && !selectionMode"
              type="button"
              class="shrink-0 rounded px-2 py-1 text-xs text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
              :disabled="Boolean(activeUninstallId) || batchUninstalling"
              :data-testid="`font-uninstall-${font.id}`"
              @click.stop="uninstallFont(font)"
            >
              {{ activeUninstallId === font.id ? '卸载中…' : '卸载' }}
            </button>
            <span
              v-else-if="font.source === 'system'"
              class="shrink-0 text-[10px] text-text-tertiary"
            >
              受保护
            </span>
          </div>
        </article>
      </div>

      <div v-if="visibleFonts.length < filteredFonts.length" class="flex justify-center py-4">
        <button
          type="button"
          class="rounded-md border border-border px-5 py-2 text-sm text-text-secondary hover:bg-card-bg-hover hover:text-text-primary"
          data-testid="font-load-more"
          @click="loadMore"
        >
          再加载 {{ loadBatch }} 个
        </button>
      </div>
    </section>
  </div>
</template>
