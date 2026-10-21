import { normalizeDuties, pickChapterDutyMode, pickParentDutyMode } from '@shared/duties'
import { defineStore } from 'pinia'
import type { ChildProject, ParentProject } from '@shared/types'
import { WORK_MODES } from '@shared/modes'
import type { WorkMode } from '@shared/types'
import { useToastStore } from './toast'

export const WORK_MODES_STORAGE_KEY = 'ui.workModes'
export const PROJECT_WORK_MODES_STORAGE_KEY = 'ui.projectWorkModes'
// Keep IPC writes ordered; promises do not belong in Pinia's serializable state.
const projectModeWrites = new WeakMap<object, Promise<void>>()
let projectModeRequest = 0

export function normalizeProjectWorkModes(value: unknown): Record<string, WorkMode> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([id, mode]) =>
    id.length > 0 && WORK_MODES.includes(mode as WorkMode)
  ))
}
export function normalizeEnabledModes(value: unknown): WorkMode[] {
  const modes = WORK_MODES.filter((mode) => Array.isArray(value) && value.includes(mode))
  return modes.length ? modes : [...WORK_MODES]
}
import type { ThumbSize } from '@renderer/components/ThumbGrid.vue'
import { DEFAULT_PROGRESS_SORT, isProgressSortValue } from '@shared/progress'
import type { ChildSortOrder } from '@shared/chapter'

/**
 * Settings store — persists user UI preferences via typed IPC.
 *
 * Owns validated UI preferences persisted through the app's SQLite-backed
 * key/value store.
 */
const THUMB_SIZE_STORAGE_KEY = 'ui.thumbSize'
const CHILD_SORT_ORDER_STORAGE_KEY = 'ui.childSortOrder'
const PROGRESS_SORT_STORAGE_KEY = 'ui.progressSort'
const PROJECT_LIST_WIDTH_STORAGE_KEY = 'ui.projectListWidth'
/** 对照视图「译文态」里原图那一栏的宽度（百分比）。2026-10-06 新增。 */
const VIEWER_SPLIT_WIDTH_STORAGE_KEY = 'ui.viewerSplitWidth'
const SILENT_SELF_CHECK_STORAGE_KEY = 'ui.selfCheckSilent'
const LABEL_PLUS_FX_PATH_STORAGE_KEY = 'tools.labelPlusFxPath'
const PHOTOSHOP_PATH_STORAGE_KEY = 'tools.photoshopPath'
const TYPESET_IMPORT_SCRIPT_STORAGE_KEY = 'tools.typesetImportScript'
const SKIP_PS_FALLBACK_STORAGE_KEY = 'tools.skipPsFallbackPrompt'
const GUIDE_SEEN_VERSION_STORAGE_KEY = 'ui.guideSeenVersion'
const PLAY_INTERVAL_STORAGE_KEY = 'ui.playIntervalMs'
const AUTO_BACKUP_STORAGE_KEY = 'ui.autoBackup'
const AUTO_INCREMENTAL_SCAN_STORAGE_KEY = 'ui.autoIncrementalScan'
const ADVANCE_AFTER_MARK_STORAGE_KEY = 'ui.advanceAfterMark'
const VALID_SIZES: readonly ThumbSize[] = ['大', '中', '小'] as const
const DEFAULT_SIZE: ThumbSize = '中'
const VALID_SORT_ORDERS: readonly ChildSortOrder[] = ['ascending', 'descending'] as const
const DEFAULT_SORT_ORDER: ChildSortOrder = 'ascending'

/**
 * 预览 / 对照状态自动播放的间隔（毫秒）。
 *
 * 三档固定值给设置页用；存的是毫秒数而不是档位序号 —— 以后想加"2.5 秒"不用写迁移。
 * 读取时夹在 1~10 秒：手改过库里的值也不至于变成 1 毫秒的连环翻页。
 */
export const DEFAULT_PLAY_INTERVAL_MS = 2000
export const MIN_PLAY_INTERVAL_MS = 1000
export const MAX_PLAY_INTERVAL_MS = 10000
export const PLAY_INTERVAL_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1500, label: '1.5 秒' },
  { value: 2000, label: '2 秒' },
  { value: 3000, label: '3 秒' }
]

/** Default width of the project list pane, matching SplitPane's own default. */
export const DEFAULT_PROJECT_LIST_WIDTH = 33.333

/**
 * Sanity band for the stored list width.
 *
 * The divider already clamps to real pixels at runtime (min 20% of the window,
 * 320px reserved for the thumbnails); this only keeps a corrupt or hand-edited
 * value from being persisted back into an unusable pane.
 */
export const MIN_PROJECT_LIST_WIDTH = 15
export const MAX_PROJECT_LIST_WIDTH = 80

/**
 * 对照视图「译文态」的左右分栏宽度（**存的是原图那一栏的百分比**）。
 *
 * 默认 66 / 34：译文是一列短文本，用不到原来那个 50/50 的一半宽（用户实测反馈
 * "右栏用不到这么宽"）。PSD 对照态**不受它影响**（那边保持写死的 50/50 —— 两边一样
 * 大才好比对），所以这一份只在有译文栏时生效。
 *
 * 与列表宽度同一条路：分隔条运行时按真实像素夹取，这里只防"库里被手改成不可用的值"。
 */
export const DEFAULT_VIEWER_SPLIT_WIDTH = 66
export const MIN_VIEWER_SPLIT_WIDTH = 45
export const MAX_VIEWER_SPLIT_WIDTH = 80

/**
 * 与 `normalizeProjectListWidth` 同一条路（缺失 / 空串 / 非数 / 乱码一律回默认，
 * 有限值四舍五入到 3 位小数再夹进合法带）。
 */
export function normalizeViewerSplitWidth(value: unknown): number {
  if (value === null || value === undefined || value === '') return DEFAULT_VIEWER_SPLIT_WIDTH
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_VIEWER_SPLIT_WIDTH
  const rounded = Math.round(numeric * 1000) / 1000
  return Math.min(MAX_VIEWER_SPLIT_WIDTH, Math.max(MIN_VIEWER_SPLIT_WIDTH, rounded))
}

function isValidSize(v: unknown): v is ThumbSize {
  return typeof v === 'string' && (VALID_SIZES as readonly string[]).includes(v)
}

function isValidSortOrder(value: unknown): value is ChildSortOrder {
  return typeof value === 'string' && (VALID_SORT_ORDERS as readonly string[]).includes(value)
}

function normalizeToolPath(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 引导版本号：只接受正整数，其余（缺失、NaN、负数、字符串）一律当"没看过"。
 * 宽进严出没有意义 —— 看不懂的值宁可再弹一次引导，也不要永久吞掉它。
 */
export function normalizeGuideSeenVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return value > 0 ? Math.floor(value) : 0
}

/** Clamp a stored list width into the sanity band, defaulting when absent. */
export function normalizeProjectListWidth(value: unknown): number {
  if (value === null || value === undefined || value === '') return DEFAULT_PROJECT_LIST_WIDTH
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_PROJECT_LIST_WIDTH
  const rounded = Math.round(numeric * 1000) / 1000
  return Math.min(MAX_PROJECT_LIST_WIDTH, Math.max(MIN_PROJECT_LIST_WIDTH, rounded))
}

/**
 * 播放间隔：只认有限数值（数值字符串也认，库里存过 JSON 字符串的情况历史上出现过），
 * 四舍五入到 100 毫秒再夹进 [1000, 10000]；缺失 / 空串 / 布尔 / 乱码一律回默认 2000。
 */
export function normalizePlayIntervalMs(value: unknown): number {
  if (value === null || value === undefined || value === '') return DEFAULT_PLAY_INTERVAL_MS
  if (typeof value !== 'number' && typeof value !== 'string') return DEFAULT_PLAY_INTERVAL_MS
  if (typeof value === 'string' && value.trim() === '') return DEFAULT_PLAY_INTERVAL_MS
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_PLAY_INTERVAL_MS
  const rounded = Math.round(numeric / 100) * 100
  return Math.min(MAX_PLAY_INTERVAL_MS, Math.max(MIN_PLAY_INTERVAL_MS, rounded))
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    homeStyle: 'default' as 'default' | 'modern',
    savingHomeStyle: false,
    startupPage: 'home' as 'home' | 'project',
    savingStartupPage: false,
    enabledWorkModes: [...WORK_MODES] as WorkMode[],
    defaultImportDuties: ['typeset'] as WorkMode[],
    dutyModePriority: 'slower' as 'slower' | 'faster',
    /** Entry default for unassigned works, separate from each open chapter's mode. */
    activeWorkMode: 'typeset' as WorkMode,
    projectWorkModes: {} as Record<string, WorkMode>,
    pendingProjectWorkModes: {} as Record<string, { mode: WorkMode; request: number }>,
    savingWorkModes: false,
    thumbSize: DEFAULT_SIZE as ThumbSize,
    childSortOrder: DEFAULT_SORT_ORDER as ChildSortOrder,
    /**
     * 「进度」页的排序档位（`键:方向`，见 `@shared/progress` 的 PROGRESS_SORT_OPTIONS）。
     * 与 `childSortOrder` 同一条路：一个字符串、落库、读回时校验。
     */
    progressSort: DEFAULT_PROGRESS_SORT as string,
    /**
     * Width of the project list pane in the workbench, in percent. Persisted so
     * the divider stays where the user left it across launches (it used to be
     * hard-coded to 33.333% on every mount).
     */
    projectListWidth: DEFAULT_PROJECT_LIST_WIDTH,
    /**
     * 对照视图译文态里**原图那一栏**的宽度（百分比）。译文栏用不到一半宽，
     * 所以默认 66/34；用户拖过就记住。
     */
    viewerSplitWidth: DEFAULT_VIEWER_SPLIT_WIDTH,
    silentSelfCheck: false,
    /**
     * Absolute path of the external translation/proofreading editor (for
     * example LabelPlusFX.exe). Empty means "not configured" — the project
     * page then asks the user to configure it instead of opening anything.
     */
    labelPlusFxPath: '',
    /** Photoshop.exe — used by 监修 (open as-is) and by the 译文导入 flow. */
    photoshopPath: '',
    /**
     * The 译文导入 / PSD 生成 .jsx script. Run inside Photoshop when the 嵌字
     * action targets a chapter that has no PSD yet.
     */
    typesetImportScript: '',
    /**
     * Suppresses the "no import tool configured" confirmation. Editable both
     * from that dialog's checkbox and from the settings page, so it is never a
     * one-way door.
     */
    skipPsFallbackPrompt: false,
    /**
     * `ui.guideSeenVersion` —— 新手引导"看过哪一版"。
     *
     * 存**版本号**而不是 true/false：以后给引导加一页，只要把
     * `features/guide/guide-config.ts` 的 `GUIDE_VERSION` +1，
     * 老用户就会再看到一次更新后的引导；存布尔的话只能二选一
     * （要么老用户永远看不到新页，要么所有人都被重弹一次）。
     * 0 = 从没看过（也是缺失/非法值的回落）。
     */
    guideSeenVersion: 0,
    /**
     * `ui.playIntervalMs` —— 预览 / 对照状态自动播放的间隔（毫秒）。
     * 页脚那个 ▶ 用它当节拍；设置页给三档（1.5 / 2 / 3 秒）。
     */
    playIntervalMs: DEFAULT_PLAY_INTERVAL_MS,
    /**
     * `ui.advanceAfterMark` —— 对照 / 预览视图里「标记后自动翻下一张」（C3，第十六轮）。
     *
     * 默认**关**：这是个加速器，不该改变"点一下只标这一张"的默认语义；
     * 开关就放在对照视图页头（标记按钮旁边），因为你只有在那种"一张张过"的场合才想开它。
     */
    advanceAfterMark: false,
    anchorScale: 100,
    invertWheel: false,
    /**
     * `ui.autoBackup` —— 启动时若距最近一份备份超过 12 小时，就自动做一份（第十四轮）。
     * **默认开**：这个项目真的丢过标记，兜底不该要用户先去发现开关。
     * 主进程读的是同一格（见 `main/index.ts` 的 `maybeAutoBackup`），所以这里只是同一份设置的另一半。
     */
    autoBackup: true,
    autoIncrementalScan: false,
    /**
     * `loadSettings()` 是否已经跑完一轮。
     *
     * 启动时 settings 是**挂载之后**才异步加载的（`main.ts`），所以"没看过引导"
     * 和"还没读到"在值上分不出来 —— 直接判断就会每次启动都弹一下。
     * 宿主（`App.vue`）等这面旗子立起来再决定，不改启动顺序（§13.10）。
     */
    settingsLoaded: false
  }),

  getters: {
    /**
     * Returns the current thumbSize if valid, otherwise '中'.
     * Defensive: a tampered store state (e.g. devtools mutation) can't
     * produce an invalid size downstream.
     */
    thumbSizeValid(state): ThumbSize {
      return isValidSize(state.thumbSize) ? state.thumbSize : DEFAULT_SIZE
    },
    /** 播放间隔的只读安全版：store 被手改过也不会出现 1 毫秒的连环翻页。 */
    playIntervalMsValid(state): number {
      return normalizePlayIntervalMs(state.playIntervalMs)
    }
  },

  actions: {
    modeForProject(parent: ParentProject, duties = parent.duties ?? [], child?: ChildProject): WorkMode {
      const available = normalizeDuties(duties).filter(mode => this.enabledWorkModes.includes(mode))
      const fallback = this.enabledWorkModes.includes(this.activeWorkMode)
        ? this.activeWorkMode : this.enabledWorkModes[0]
      // Explicitly unassigned works follow the default, not an old saved role.
      if (!available.length) return fallback
      const remembered = this.pendingProjectWorkModes[parent.id]?.mode ?? this.projectWorkModes[parent.id]
      if (available.includes(remembered)) return remembered
      return (child
        ? pickChapterDutyMode(child, available, this.dutyModePriority)
        : pickParentDutyMode(parent, available, this.dutyModePriority)) ?? fallback
    },
    async setProjectWorkMode(parentId: string, mode: WorkMode): Promise<void> {
      if (!parentId || !this.enabledWorkModes.includes(mode)) return
      const request = ++projectModeRequest
      this.pendingProjectWorkModes = { ...this.pendingProjectWorkModes, [parentId]: { mode, request } }
      const write = (projectModeWrites.get(this) ?? Promise.resolve()).then(async () => {
        try {
          if (!this.enabledWorkModes.includes(mode) || this.projectWorkModes[parentId] === mode) return
          const next = { ...this.projectWorkModes, [parentId]: mode }
          await window.comicType.storeSet(PROJECT_WORK_MODES_STORAGE_KEY, next)
          this.projectWorkModes = next
        } catch {
          useToastStore().addToast({ type: 'error', message: '漫画工作模式保存失败，请重试' })
        } finally {
          if (this.pendingProjectWorkModes[parentId]?.request === request) {
            const pending = { ...this.pendingProjectWorkModes }
            delete pending[parentId]
            this.pendingProjectWorkModes = pending
          }
        }
      })
      projectModeWrites.set(this, write)
      await write
    },
    async setStartupPage(page: 'home' | 'project'): Promise<void> {
      if (this.savingStartupPage || !['home', 'project'].includes(page)) return
      this.savingStartupPage = true
      try {
        await window.comicType.storeSet('ui.startupPage', page)
        this.startupPage = page
      } catch { useToastStore().addToast({ type: 'error', message: '启动页面保存失败' }) }
      finally { this.savingStartupPage = false }
    },
    async setHomeStyle(style: 'default' | 'modern'): Promise<void> {
      if (this.savingHomeStyle || !['default', 'modern'].includes(style)) return
      this.savingHomeStyle = true
      try {
        await window.comicType.storeSet('ui.homeStyle', style)
        this.homeStyle = style
      } catch { useToastStore().addToast({ type: 'error', message: '首页样式保存失败' }) }
      finally { this.savingHomeStyle = false }
    },
    async saveImportDuties(duties: WorkMode[], priority?: 'slower' | 'faster'): Promise<void> {
      priority ??= this.dutyModePriority
      const clean = normalizeDuties(duties)
      try {
        await window.comicType.storeSet('ui.importDuties', { duties: clean, priority })
        this.defaultImportDuties = clean
        this.dutyModePriority = priority
      } catch { useToastStore().addToast({ type: 'error', message: '默认职责保存失败' }) }
    },
    async saveWorkModes(enabled: WorkMode[], active?: WorkMode): Promise<void> {
      if (this.savingWorkModes || enabled.length === 0) return
      const modes = normalizeEnabledModes(enabled)
      const requested = active ?? this.activeWorkMode
      const selected = modes.includes(requested) ? requested : modes[0]
      this.savingWorkModes = true
      try {
        await window.comicType.storeSet(WORK_MODES_STORAGE_KEY, { enabled: modes, active: selected })
        this.enabledWorkModes = modes
        this.activeWorkMode = selected
      } catch {
        useToastStore().addToast({ type: 'error', message: '工作模式保存失败，请重试' })
      } finally {
        this.savingWorkModes = false
      }
    },
    async setActiveWorkMode(mode: WorkMode): Promise<void> {
      if (!WORK_MODES.includes(mode)) return
      if (mode === this.activeWorkMode) return
      await this.saveWorkModes(this.enabledWorkModes, mode)
    },
    setAutoIncrementalScan(enabled: boolean): void {
      this.autoIncrementalScan = enabled
      void window.comicType.storeSet(AUTO_INCREMENTAL_SCAN_STORAGE_KEY, enabled)
    },
    /**
     * Persist the thumb size to electron-store and update state.
     * The IPC call is fire-and-forget (voided) — the state update is
     * synchronous so the UI reflects the change immediately.
     */
    setThumbSize(size: ThumbSize): void {
      this.thumbSize = size
      void window.comicType.storeSet(THUMB_SIZE_STORAGE_KEY, size)
    },

    setChildSortOrder(order: ChildSortOrder): void {
      this.childSortOrder = order
      void window.comicType.storeSet(CHILD_SORT_ORDER_STORAGE_KEY, order)
    },

    /**
     * 记住「进度」页选的排序档位。
     * **不认识的档位直接忽略**（不写库、不改内存）—— 库里存进去一个谁都解析不了的值，
     * 下次读回来还是垃圾，不如当场拒绝。
     */
    setProgressSort(value: string): void {
      if (!isProgressSortValue(value)) return
      this.progressSort = value
      void window.comicType.storeSet(PROGRESS_SORT_STORAGE_KEY, value)
    },

    /** Persist the project list pane width (percent). Called on divider release. */
    setProjectListWidth(percent: number): void {
      const normalized = normalizeProjectListWidth(percent)
      if (normalized === this.projectListWidth) return
      this.projectListWidth = normalized
      void window.comicType.storeSet(PROJECT_LIST_WIDTH_STORAGE_KEY, normalized)
    },

    /**
     * 对照视图译文态的左右分栏宽度（**原图那一栏的百分比**）。分隔条松手时调一次。
     */
    setViewerSplitWidth(percent: number): void {
      const normalized = normalizeViewerSplitWidth(percent)
      if (normalized === this.viewerSplitWidth) return
      this.viewerSplitWidth = normalized
      void window.comicType.storeSet(VIEWER_SPLIT_WIDTH_STORAGE_KEY, normalized)
    },

    setSilentSelfCheck(enabled: boolean): void {
      this.silentSelfCheck = enabled
      void window.comicType.storeSet(SILENT_SELF_CHECK_STORAGE_KEY, enabled)
    },

    /** Persist the external translation tool path; an empty string clears it. */
    setLabelPlusFxPath(path: string): void {
      const normalized = normalizeToolPath(path)
      this.labelPlusFxPath = normalized
      void window.comicType.storeSet(LABEL_PLUS_FX_PATH_STORAGE_KEY, normalized)
    },

    /** Persist the Photoshop executable path; an empty string clears it. */
    setPhotoshopPath(path: string): void {
      const normalized = normalizeToolPath(path)
      this.photoshopPath = normalized
      void window.comicType.storeSet(PHOTOSHOP_PATH_STORAGE_KEY, normalized)
    },

    /** Persist the 译文导入 .jsx path; an empty string clears it. */
    setTypesetImportScript(path: string): void {
      const normalized = normalizeToolPath(path)
      this.typesetImportScript = normalized
      void window.comicType.storeSet(TYPESET_IMPORT_SCRIPT_STORAGE_KEY, normalized)
    },

    setSkipPsFallbackPrompt(skip: boolean): void {
      this.skipPsFallbackPrompt = skip
      void window.comicType.storeSet(SKIP_PS_FALLBACK_STORAGE_KEY, skip)
    },

    setAnchorScale(value: number): void {
      this.anchorScale = Number.isFinite(value) ? Math.max(30, Math.min(200, Math.round(value))) : 100
      document.documentElement.style.setProperty('--translation-anchor-scale', String(this.anchorScale / 100))
      void window.comicType.storeSet('ui.anchorScale', this.anchorScale)
    },
    setInvertWheel(enabled: boolean): void {
      this.invertWheel = enabled
      void window.comicType.storeSet('ui.invertWheel', enabled)
    },

    setAdvanceAfterMark(enabled: boolean): void {
      this.advanceAfterMark = enabled
      void window.comicType.storeSet(ADVANCE_AFTER_MARK_STORAGE_KEY, enabled)
    },

    setAutoBackup(enabled: boolean): void {
      this.autoBackup = enabled
      void window.comicType.storeSet(AUTO_BACKUP_STORAGE_KEY, enabled)
    },

    /** 保存自动播放间隔（毫秒）。值没变就不写库，省一次 IPC。 */
    setPlayIntervalMs(ms: number): void {
      const normalized = normalizePlayIntervalMs(ms)
      if (normalized === this.playIntervalMs) return
      this.playIntervalMs = normalized
      void window.comicType.storeSet(PLAY_INTERVAL_STORAGE_KEY, normalized)
    },

    /**
     * 记住"引导看过到第几版"。由宿主（`App.vue`）在弹窗关闭时调用 ——
     * **跳过也算看过**，否则每次启动都会再弹一次。
     *
     * 版本号由调用方传入（`GUIDE_VERSION`），这样 store 不必反向依赖引导内容；
     * 值没变就不写库（省一次 IPC，也避免无意义的 updated_at 抖动）。
     */
    markGuideSeen(version: number): void {
      const normalized = normalizeGuideSeenVersion(version)
      if (normalized === this.guideSeenVersion) return
      this.guideSeenVersion = normalized
      void window.comicType.storeSet(GUIDE_SEEN_VERSION_STORAGE_KEY, normalized)
    },

    /**
     * 加载全部界面设置。校验过的非法/缺失值一律回落到默认值。幂等。
     *
     * 跑完（含异常路径）会把 `settingsLoaded` 立起来 —— 引导的"首次自动弹"
     * 就是等这面旗子，见 state 里的注释。
     */
    async loadSettings(): Promise<void> {
      try {
        const [
          rawThumbSize,
          rawSortOrder,
          rawListWidth,
          rawSilentSelfCheck,
          rawToolPath,
          rawPhotoshopPath,
          rawImportScript,
          rawSkipPsFallback,
          rawGuideSeenVersion,
          rawPlayIntervalMs,
          rawAutoBackup,
          rawAdvanceAfterMark,
          rawProgressSort,
          rawAutoIncrementalScan,
          rawWorkModes,
          rawProjectWorkModes,
          rawViewerSplitWidth,
          rawInvertWheel,
          rawHomeStyle,
          rawStartupPage,
          rawAnchorScale
        ] = await Promise.all([
          window.comicType.storeGet(THUMB_SIZE_STORAGE_KEY),
          window.comicType.storeGet(CHILD_SORT_ORDER_STORAGE_KEY),
          window.comicType.storeGet(PROJECT_LIST_WIDTH_STORAGE_KEY),
          window.comicType.storeGet(SILENT_SELF_CHECK_STORAGE_KEY),
          window.comicType.storeGet(LABEL_PLUS_FX_PATH_STORAGE_KEY),
          window.comicType.storeGet(PHOTOSHOP_PATH_STORAGE_KEY),
          window.comicType.storeGet(TYPESET_IMPORT_SCRIPT_STORAGE_KEY),
          window.comicType.storeGet(SKIP_PS_FALLBACK_STORAGE_KEY),
          window.comicType.storeGet(GUIDE_SEEN_VERSION_STORAGE_KEY),
          window.comicType.storeGet(PLAY_INTERVAL_STORAGE_KEY),
          window.comicType.storeGet(AUTO_BACKUP_STORAGE_KEY),
          window.comicType.storeGet(ADVANCE_AFTER_MARK_STORAGE_KEY),
          window.comicType.storeGet(PROGRESS_SORT_STORAGE_KEY),
          window.comicType.storeGet(AUTO_INCREMENTAL_SCAN_STORAGE_KEY),
          window.comicType.storeGet(WORK_MODES_STORAGE_KEY),
          window.comicType.storeGet(PROJECT_WORK_MODES_STORAGE_KEY),
          window.comicType.storeGet(VIEWER_SPLIT_WIDTH_STORAGE_KEY),
          window.comicType.storeGet('ui.invertWheel'),
          window.comicType.storeGet('ui.homeStyle'),
          window.comicType.storeGet('ui.startupPage'),
          window.comicType.storeGet('ui.anchorScale')
        ])
        this.anchorScale = typeof rawAnchorScale === 'number' && Number.isFinite(rawAnchorScale) ? Math.max(30, Math.min(200, Math.round(rawAnchorScale))) : 100
        document.documentElement.style.setProperty('--translation-anchor-scale', String(this.anchorScale / 100))
        this.startupPage = rawStartupPage === 'project' ? 'project' : 'home'
        this.homeStyle = rawHomeStyle === 'modern' ? 'modern' : 'default'
        this.invertWheel = rawInvertWheel === true
        this.thumbSize = isValidSize(rawThumbSize) ? rawThumbSize : DEFAULT_SIZE
        const workModes = rawWorkModes as { enabled?: unknown; active?: WorkMode } | null
        // Legacy enabled modes now describe import defaults, not access to work views.
        this.enabledWorkModes = [...WORK_MODES]
        this.projectWorkModes = normalizeProjectWorkModes(rawProjectWorkModes)
        const dutyDefaults = await window.comicType.storeGet('ui.importDuties') as { duties?: WorkMode[]; priority?: string } | null
        const storedDuties = dutyDefaults?.duties
        const hasImportDuties = Array.isArray(storedDuties) && storedDuties.every(mode => WORK_MODES.includes(mode))
        this.defaultImportDuties = normalizeDuties(hasImportDuties ? storedDuties : (workModes?.enabled ?? ['typeset']))
        this.dutyModePriority = dutyDefaults?.priority === 'faster' ? 'faster' : 'slower'
        if (!hasImportDuties && Array.isArray(workModes?.enabled)) {
          // Persist before a later default-mode save replaces the legacy enabled list.
          try {
            await window.comicType.storeSet('ui.importDuties', {
              duties: [...this.defaultImportDuties], priority: this.dutyModePriority
            })
          } catch {
            useToastStore().addToast({ type: 'error', message: '默认职责迁移保存失败，请在设置中重新保存' })
          }
        }
        this.activeWorkMode = workModes?.active && this.enabledWorkModes.includes(workModes.active)
          ? workModes.active : this.enabledWorkModes[0]
        this.autoIncrementalScan = rawAutoIncrementalScan === true
        this.childSortOrder = isValidSortOrder(rawSortOrder) ? rawSortOrder : DEFAULT_SORT_ORDER
        this.projectListWidth = normalizeProjectListWidth(rawListWidth)
        this.silentSelfCheck = rawSilentSelfCheck === true
        this.labelPlusFxPath = normalizeToolPath(rawToolPath)
        this.photoshopPath = normalizeToolPath(rawPhotoshopPath)
        this.typesetImportScript = normalizeToolPath(rawImportScript)
        this.skipPsFallbackPrompt = rawSkipPsFallback === true
        this.guideSeenVersion = normalizeGuideSeenVersion(rawGuideSeenVersion)
        this.playIntervalMs = normalizePlayIntervalMs(rawPlayIntervalMs)
        this.autoBackup = rawAutoBackup !== false
        this.advanceAfterMark = rawAdvanceAfterMark === true
        this.progressSort = isProgressSortValue(rawProgressSort)
          ? rawProgressSort
          : DEFAULT_PROGRESS_SORT
        this.viewerSplitWidth = normalizeViewerSplitWidth(rawViewerSplitWidth)
      } catch {
        this.invertWheel = false
        this.thumbSize = DEFAULT_SIZE
        this.childSortOrder = DEFAULT_SORT_ORDER
        this.progressSort = DEFAULT_PROGRESS_SORT
        this.projectListWidth = DEFAULT_PROJECT_LIST_WIDTH
        this.viewerSplitWidth = DEFAULT_VIEWER_SPLIT_WIDTH
        this.silentSelfCheck = false
        this.labelPlusFxPath = ''
        this.photoshopPath = ''
        this.typesetImportScript = ''
        this.skipPsFallbackPrompt = false
        this.guideSeenVersion = 0
        this.playIntervalMs = DEFAULT_PLAY_INTERVAL_MS
        this.autoBackup = true
        this.advanceAfterMark = false
      } finally {
        // 无论成功还是回落，都算"读过一轮" —— 引导的自动弹出必须有个确定的时刻。
        this.settingsLoaded = true
      }
    }
  }
})
